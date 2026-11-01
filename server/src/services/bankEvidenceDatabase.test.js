const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(),'moni-bank-evidence-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory,'test.sqlite');
process.env.MARKET_QUOTES_ENABLED='false';
const service = require('../database/dbService');
const plaid = require('./plaidService');
const telegram = require('./telegramService');
const { deliver } = require('./telegramOutboxWorker');
let db, account;
test.before(async()=>{db=await service.getDb();await service.createUser('u','bank-evidence','unused');account=await service.createInvestmentAccount('u',{name:'TFSA',institution:'Wealthsimple',accountType:'TFSA',currency:'CAD',accountRef:'S0K7',cashMinor:0});});
test.after(async()=>{await db.close();fs.rmSync(directory,{recursive:true,force:true});});
const trade={Amount:10,Currency:'CAD',Category:'Investment',Label:'ETF & Stock Purchase',Reason:'VFV',Timestamp:'2026-10-13T12:00:00Z',PortfolioAction:'BUY',PortfolioSymbol:'VFV',PortfolioQuantity:0.05,PortfolioPrice:200,Account:'S0K7',BankName:'Wealthsimple',PortfolioAccountId:null};
test('conflicting OTC symbol/currency links to the existing trade rather than duplicating it',async()=>{
 const id=await service.addTransaction({...trade,userId:'u',PortfolioAccountId:account.id});
 const input={investment_transaction_id:'external',account_id:'a',security_id:'s',type:'buy',amount:10,quantity:0.05,price:200,date:'2026-10-13',iso_currency_code:'USD'};
 const accounts=new Map([['a',{appAccountId:account.id,currency:'CAD',mask:'S0K7',type:'investment',subtype:'tfsa'}]]);
 const securities=new Map([['s',{ticker_symbol:'VFVXF',name:'Vanguard S&P 500 Index ETF'}]]);
 const result=await plaid.importInvestmentTransaction('u',{itemId:'item',institutionName:'Wealthsimple'},input,accounts,securities);
 assert.equal(result.status,'review_required');assert.equal(result.transactionId,id);
 assert.equal((await db.get('SELECT COUNT(*) n FROM transactions')).n,1);
 const unrelated=await plaid.importInvestmentTransaction('u',{itemId:'item',institutionName:'Wealthsimple'},{...input,investment_transaction_id:'other',date:'2026-10-14'},accounts,securities);
 assert.equal(unrelated.status,'review_required');assert.equal((await db.get('SELECT COUNT(*) n FROM transactions')).n,1);
});
test('queued notifications use corrected amounts/currency and investment headers at delivery time',async()=>{
 const id=await service.addTransaction({...trade,userId:'u',Amount:12.34,PortfolioAction:'TRANSFER',AccountFlow:'NONE',TelegramMessageId:99});
 let sent;
 const original=telegram.sendTelegramMessage;
 telegram.sendTelegramMessage=async(text)=>{sent=text;return{ok:true}};
 try {await deliver({action:'sendMessage',transactionId:id,payload:{text:'Old expense $1'}});}finally{telegram.sendTelegramMessage=original;}
 assert.match(sent,/Investment Activity/);assert.match(sent,/12\\\.34 CAD/);assert.doesNotMatch(sent,/Expense Detected/);
 await service.updateTransactionForUser(id,'u',{Amount:13.45});
 const edit=await db.get("SELECT * FROM telegram_outbox WHERE action='editMessage' AND transactionId=?",[id]);
 assert.ok(edit);assert.equal(JSON.parse(edit.payloadJson).messageId,99);
});
test('unreviewed evidence holds notification jobs instead of claiming them for delivery',async()=>{
 const id=await service.addTransaction({...trade,userId:'u'});
 await db.run("INSERT INTO transaction_ingestion_reviews(transactionId,reason,createdAt) VALUES(?,'unconfirmed_currency',?)",[id,new Date().toISOString()]);
 const job=await service.enqueueTelegramOutbox('sendMessage',{text:'Do not send'}, {transactionId:id});
 const claimed=await service.claimTelegramOutbox('test',50);
 assert.ok(!claimed.some(x=>x.id===job));
});

test('reviewed bank imports are idempotent and preserve the existing cash baseline',async()=>{
 const { repair }=require('../../scripts/apply-bank-evidence');
 const before=await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[account.id]);
 const plan={updates:[],merges:[],imports:[{key:'fixture-bank-row',fields:{userId:'u',Amount:25,AmountMinor:2500,Currency:'CAD',Category:'Income',Label:'Other Income',Reason:'Bank confirmed deposit',Timestamp:'2026-10-30',BankName:'Example Bank',Account:'1234',BalanceAccountId:account.id},evidence:{amount:25,currency:'CAD'}}]};
 const changes=await db.withTransaction(()=>repair(db,plan,'u'));
 assert.equal(changes.length,1);
 assert.equal((await db.withTransaction(()=>repair(db,plan,'u'))).length,0);
 assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[account.id])).cashMinor,before.cashMinor);
 assert.ok((await db.get('SELECT balanceReviewReason FROM investment_accounts WHERE id=?',[account.id])).balanceReviewReason);
});

test('statement dates retain their calendar day without inventing a transaction time',()=>{
 const text=telegram.formatTransactionMessage({...trade,Amount:9.99,Timestamp:'2026-07-31'});
 assert.match(text,/Jul 31, 2026/);assert.doesNotMatch(text,/Jul 30|a\\.m|p\\.m/);
});

test('distinct equal-value card purchases keep their own email evidence',async()=>{
 const {repair}=require('../../scripts/apply-bank-evidence');
 const base={userId:'u',Amount:8,AmountMinor:800,Currency:'CAD',Category:'Expense',Label:'Digital Services',Reason:'GOOGLE CLOUD',Timestamp:'2026-09-23',BankName:'RBC',Account:'2379',AccountFlow:'OUT',ReferenceNumber:'QKPJ7J',SourceEmailKey:'mail-one'};
 const original=await service.addTransaction(base);
 await service.upsertTransactionSource({provider:'email',externalId:'mail-two',userId:'u',transactionId:original,rawPayload:{body:'Separate N5F9NN purchase'}});
 const plan={updates:[],merges:[],imports:[{key:'card-second-reference',fields:{...base,ReferenceNumber:'N5F9NN',SourceEmailKey:'mail-two'},evidence:'Two posted bank references',relinkSources:[{provider:'email',externalId:'mail-two',expectedTransactionId:original}]}]};
 const changes=await db.withTransaction(()=>repair(db,plan,'u'));
 const added=changes.find(c=>c.importedId).importedId;
 assert.notEqual(added,original);
 assert.equal((await db.get("SELECT transactionId FROM transaction_sources WHERE provider='email' AND externalId='mail-two'")).transactionId,added);
 assert.equal((await db.withTransaction(()=>repair(db,plan,'u'))).length,0);
});
test('merging an unsupported duplicate account preserves activity and verifies the actual bank balance',async()=>{
 const {repair}=require('../../scripts/apply-bank-evidence');
 const real=await service.createInvestmentAccount('u',{name:'Earnings',accountRef:'1832',institution:'Wealthsimple',accountType:'Chequing',currency:'CAD',cashMinor:14172});
 const fake=await service.createInvestmentAccount('u',{name:'Unsupported account',accountRef:'1371',institution:'Wealthsimple',accountType:'Chequing',currency:'CAD',cashMinor:70879});
 const id=await service.addTransaction({...trade,userId:'u',Amount:708.79,Category:'Income',Label:'Employment Income',PortfolioAction:null,PortfolioSymbol:null,BalanceAccountId:fake.id,Account:'1371'});
 const asOf='2026-10-31T23:00:00.000Z';
 const plan={updates:[],merges:[],accountMerges:[{from:fake.id,to:real.id,expectedRef:'1371',expectedCashMinor:70879,expectedTransactionIds:[id],evidence:'Verified one bank account'}],accountSnapshots:[{id:real.id,expectedRef:'1832',expectedCashMinor:14172,currency:'CAD',cashMinor:50731,asOf,evidence:'Bank reported cash after all three missing legs'}]};
 await db.withTransaction(()=>repair(db,plan,'u'));
 assert.equal(await db.get('SELECT * FROM investment_accounts WHERE id=?',[fake.id]),undefined);
 assert.equal((await service.getTransactionById(id,'u')).BalanceAccountId,real.id);
 assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[real.id])).cashMinor,50731);
 assert.equal((await db.withTransaction(()=>repair(db,plan,'u'))).length,0);
 const historical=await service.addTransaction({...trade,userId:'u',Amount:25,Category:'Income',PortfolioAction:null,AccountFlow:'IN',BalanceAccountId:real.id});
 assert.equal((await service.syncTransactionAccountBalance('u',historical,{accountId:real.id,confidence:'HIGH'})).status,'snapshot_preserved');
 const future=await service.addTransaction({...trade,userId:'u',Amount:2,Category:'Expense',PortfolioAction:null,AccountFlow:'OUT',Timestamp:'2026-11-02T12:00:00Z',BalanceAccountId:real.id});
 await service.syncTransactionAccountBalance('u',future,{accountId:real.id,confidence:'HIGH'});
 assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[real.id])).cashMinor,50531);
});
test('a stale provider snapshot cannot undo verified bank cash or positions',async()=>{
 const {setAccountBalanceSnapshot}=require('./accountBalanceService');
 const account=await service.createInvestmentAccount('u',{name:'Verified TFSA',accountType:'TFSA',currency:'CAD',cashMinor:500});
 await service.upsertInvestmentHolding('u',account.id,{symbol:'TEST',quantity:2,currency:'CAD',priceMinor:5000,averageCostMinor:4000});
 await db.run("UPDATE investment_accounts SET balanceSource='bank_ui',holdingsSource='bank_ui',balanceAsOf='2026-10-31T23:00:00Z' WHERE id=?",[account.id]);
 assert.equal((await setAccountBalanceSnapshot('u',account.id,999,'CAD')).status,'review_required');
 const map=new Map([['bank-account',{appAccountId:account.id,type:'investment',currency:'CAD'}]]);
 const snapshot={accounts:[{account_id:'bank-account',balances:{available:0,current:50,iso_currency_code:'CAD'}}],securities:[{security_id:'stock',ticker_symbol:'TEST',type:'equity'}],holdings:[{account_id:'bank-account',security_id:'stock',quantity:1,institution_price:50,institution_value:50,iso_currency_code:'CAD'}]};
 await plaid.applyInvestmentSnapshot('u',map,snapshot);
 assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[account.id])).cashMinor,500);
 assert.equal((await db.get('SELECT quantity FROM investment_holdings WHERE accountId=?',[account.id])).quantity,2);
 snapshot.accounts[0].balances.available=5;snapshot.accounts[0].balances.current=105;
 snapshot.holdings[0].quantity=2;snapshot.holdings[0].institution_value=100;
 await plaid.applyInvestmentSnapshot('u',map,snapshot);
 assert.equal((await db.get('SELECT balanceSource FROM investment_accounts WHERE id=?',[account.id])).balanceSource,'plaid');
});

test('verified previously untracked accounts add a bank balance without invented income',async()=>{
 const {repair}=require('../../scripts/apply-bank-evidence');
 const count=(await db.get('SELECT COUNT(*) n FROM transactions')).n;
 const plan={updates:[],merges:[],accountCreations:[{fields:{name:'RBC FHSA',institution:'RBC',accountType:'FHSA',currency:'CAD',accountRef:'example-fhsa',cashMinor:200100},asOf:'2026-10-31T23:21:49.000Z',evidence:'Authenticated bank page says cash is the entire balance'}]};
 const changes=await db.withTransaction(()=>repair(db,plan,'u'));assert.equal(changes.length,1);
 assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[changes[0].accountCreated])).cashMinor,200100);
 assert.equal((await db.get('SELECT COUNT(*) n FROM transactions')).n,count);
 assert.equal((await db.withTransaction(()=>repair(db,plan,'u'))).length,0);
});

test('a concrete unknown bank reference cannot fall back to the unique symbol holder',async()=>{
 await service.upsertInvestmentHolding('u',account.id,{symbol:'IDENTITY',quantity:1,currency:'CAD',priceMinor:100,averageCostMinor:100});
 const result=await service.resolvePortfolioActivityAccount('u',{BankName:'Wealthsimple',Account:'TFSA',PortfolioAccountNumber:'WK4J413K3CAD'},{action:'BUY',symbol:'IDENTITY'});
 assert.equal(result.account,null);assert.equal(result.reason,'unmatched_account_reference');
 const known=await service.resolvePortfolioActivityAccount('u',{BankName:'Wealthsimple',Account:'TFSA',PortfolioAccountNumber:'HQ656S0K7CAD'},{action:'BUY',symbol:'IDENTITY'});
 assert.equal(known.account.id,account.id);
});
test('reviewed historical account assignments preserve cash, reject wrong identities, and are idempotent',async()=>{
 const {repair}=require('../../scripts/apply-bank-evidence');
 await db.run("UPDATE investment_accounts SET balanceSource='bank_ui',balanceAsOf='2026-10-31T23:00:00Z' WHERE id=?",[account.id]);
 const id=await service.addTransaction({...trade,userId:'u',Account:null,PortfolioAccountId:null,BalanceAccountId:null});
 await db.run("INSERT INTO transaction_ingestion_reviews(transactionId,reason,createdAt) VALUES(?,'ambiguous_account',?)",[id,new Date().toISOString()]);
 const before=(await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[account.id])).cashMinor;
 const assignment={transactionId:id,accountId:account.id,bankAccountRef:'HQ656S0K7CAD',institution:'Wealthsimple',balance:true,portfolio:true,resolveReviewReason:'ambiguous_account',expected:{Account:null,PortfolioAccountId:null,BalanceAccountId:null},evidence:'Bank execution date, symbol, amount and precise quantity identify this account'};
 await assert.rejects(()=>db.withTransaction(()=>repair(db,{updates:[],merges:[],transactionAccountAssignments:[{...assignment,bankAccountRef:'WK4J413K3CAD'}]},'u')),/verified identity/);
 const plan={updates:[],merges:[],transactionAccountAssignments:[assignment]};
 assert.equal((await db.withTransaction(()=>repair(db,plan,'u'))).length,1);
 assert.equal((await service.getTransactionById(id,'u')).BalanceAccountId,account.id);
 assert.ok((await db.get('SELECT resolvedAt FROM transaction_ingestion_reviews WHERE transactionId=?',[id])).resolvedAt);
 assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[account.id])).cashMinor,before);
 assert.equal((await db.withTransaction(()=>repair(db,plan,'u'))).length,0);
});
