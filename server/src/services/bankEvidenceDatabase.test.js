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
