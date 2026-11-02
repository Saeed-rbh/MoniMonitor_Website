const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'moni-auto-care-'));
process.env.MONIMONITOR_DB_PATH=path.join(directory,'test.sqlite');
process.env.EMAIL_SOURCE_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64');
process.env.MARKET_QUOTES_ENABLED='false';
delete process.env.PLAID_CLIENT_ID;delete process.env.PLAID_SECRET;
const service=require('../database/dbService'),learning=require('./automaticLearning'),care=require('./automaticCare');
const {enqueueAttentionNotice,notifyBankAction}=require('./attentionNotices');
let db,account,other;const user='learner';
const body='From: Wealthsimple <notifications@o.wealthsimple.com>\nSubject: Your order has been filled\nAccount: TFSA\nSymbol: QQC';
const trade={Amount:10,Currency:'CAD',Category:'Investment',Label:'ETF & Stock Purchase',Reason:'QQC',Timestamp:'2026-10-20',Type:'TFSA',Account:'TFSA',BankName:'Wealthsimple',PortfolioAction:'BUY',PortfolioSymbol:'QQC',PortfolioQuantity:0.2,PortfolioPrice:50};
async function confirmed(index,target,{currency='CAD',removed=false}={}) {
 const id=await service.addTransaction({...trade,userId:user,Timestamp:`2026-10-${String(index+10).padStart(2,'0')}`,SourceEmailKey:`email-${index}`,PortfolioAccountId:target.id,BalanceAccountId:target.id,Account:target.accountRef});
 await service.upsertTransactionSource({userId:user,provider:'email',externalId:`email-${index}`,transactionId:id,rawPayload:{rawBody:body},ownsTransaction:true});
 await service.upsertTransactionSource({userId:user,provider:'plaid_investments',externalId:`bank-${index}`,transactionId:id,itemId:'learning-item',rawPayload:{amount:10,quantity:0.2,type:'buy',iso_currency_code:currency},contextPayload:{account:{appAccountId:target.id,currency:'CAD'},providerRemoved:removed}});
 return id;
}
test.before(async()=>{
 db=await service.getDb();await service.createUser(user,user,'unused');
 account=await service.createInvestmentAccount(user,{name:'TFSA A',institution:'Wealthsimple',accountType:'TFSA',currency:'CAD',accountRef:'A123',cashMinor:10000});
 other=await service.createInvestmentAccount(user,{name:'TFSA B',institution:'Wealthsimple',accountType:'TFSA',currency:'CAD',accountRef:'B123',cashMinor:10000});
});
test.after(async()=>{await db.close();fs.rmSync(directory,{recursive:true,force:true});});
test('learning requires two independent bank matches, resolves held aliases, and never estimates portfolio cash',async()=>{
 await confirmed(1,account);
 const copy=await confirmed(6,account);await service.updateTransactionForUser(copy,user,{Timestamp:'2026-10-11'});
 await learning.learnAccountMappings(user);
 assert.equal((await learning.applyLearnedAccount(user,trade,body)).PortfolioAccountId,undefined);
 assert.equal((await db.get('SELECT evidenceCount FROM learned_account_rules WHERE userId=?',[user])).evidenceCount,1);
 await confirmed(2,account);await learning.learnAccountMappings(user);
 const proposed=await learning.applyLearnedAccount(user,trade,body);
 assert.equal(proposed.PortfolioAccountId,account.id);assert.equal(proposed.BalanceAccountId,account.id);
 const id=await service.addTransaction({...trade,userId:user,SourceEmailKey:'held-email'});
 await service.upsertTransactionSource({userId:user,provider:'email',externalId:'held-email',transactionId:id,rawPayload:{rawBody:body}});
 await db.run("INSERT INTO transaction_ingestion_reviews(transactionId,reason,createdAt) VALUES(?,'ambiguous_account',?)",[id,new Date().toISOString()]);
 assert.equal(await care.resolveLearnedReviews(user),1);
 assert.equal((await service.getTransactionById(id,user)).PortfolioAccountId,account.id);
 assert.ok((await db.get('SELECT resolvedAt FROM transaction_ingestion_reviews WHERE transactionId=?',[id])).resolvedAt);
 assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[account.id])).cashMinor,10000);
 assert.equal((await db.get('SELECT COUNT(*) count FROM investment_holdings')).count,0);
 assert.equal(await care.resolveLearnedReviews(user),0);
});
test('conflicting, removed, foreign-currency or cross-user evidence cannot silently choose an account',async()=>{
 await confirmed(3,other);await learning.learnAccountMappings(user);
 assert.equal((await db.get('SELECT status FROM learned_account_rules WHERE userId=?',[user])).status,'conflict');
 assert.equal((await learning.applyLearnedAccount(user,trade,body)).PortfolioAccountId,undefined);
 const before=(await db.get('SELECT COUNT(*) n FROM account_learning_evidence')).n;
 await confirmed(4,other,{currency:'USD'});await learning.learnAccountMappings(user);
 assert.equal((await db.get('SELECT COUNT(*) n FROM account_learning_evidence')).n,before);
 assert.equal((await learning.applyLearnedAccount('different-user',trade,body)).PortfolioAccountId,undefined);
 const source=await db.get("SELECT contextPayloadJson FROM transaction_sources WHERE externalId='bank-3'");
 await db.run("UPDATE transaction_sources SET contextPayloadJson=? WHERE externalId='bank-3'",[JSON.stringify({...JSON.parse(source.contextPayloadJson),providerRemoved:true})]);
 await learning.learnAccountMappings(user);
 assert.equal((await learning.applyLearnedAccount(user,trade,body)).PortfolioAccountId,account.id);
 assert.equal((await db.get('SELECT COUNT(*) n FROM account_learning_evidence')).n,before);
 assert.equal((await db.get('SELECT active FROM account_learning_evidence WHERE sourceKey=?',['plaid_investments:bank-3'])).active,0);
});
test('reviewed merchant preferences survive future imports without changing amount, account, currency, or opposite flow',async()=>{
 const tx={userId:user,Amount:8,Currency:'CAD',Category:'Expense',Label:'Other Expense',Reason:'Coffee place',Timestamp:'2026-10-20',AccountFlow:'OUT'};
 const id=await service.addTransaction(tx);
 await service.updateTransactionForUser(id,user,{Label:'Dining'},{reviewed:true});
 const preferred=await learning.personalizeTransaction(user,{...tx,Amount:12});
 assert.equal(preferred.Label,'Dining');assert.equal(preferred.Amount,12);assert.equal(preferred.Currency,'CAD');
 assert.equal((await learning.personalizeTransaction(user,{...tx,Currency:'USD'})).Label,'Other Expense');
 assert.equal((await learning.personalizeTransaction(user,{...tx,Category:'Income',AccountFlow:'IN'})).Label,'Other Expense');
 assert.equal((await learning.personalizeTransaction(user,{...tx,Reason:'Coffee place extension'})).Label,'Other Expense');
 assert.equal((await learning.personalizeTransaction(user,{...tx,PortfolioAction:'BUY'})).Label,'Other Expense');
 await service.saveMerchantRule(user,'Bell','Expense','Digital Services');
 assert.equal(await service.getMerchantRuleForReason(user,'Taco Bell'),null);
});
test('snapshot and duplicate-effect checks report discrepancies without rewriting balances or deleting evidence',async()=>{
 await care.recordCheckpoint(user,account.id,'cash',{cashMinor:9000,currency:'CAD'});
 await care.recordCheckpoint(user,account.id,'cash',{cashMinor:9000,currency:'CAD'});
 assert.equal((await db.get('SELECT COUNT(*) n FROM financial_checkpoints')).n,1);
 await care.recordCheckpoint(user,account.id,'holdings',{positions:[{symbol:'QQC',quantity:3,currency:'CAD'}]});
 const checks=await care.consistencyChecks(user);
 assert.equal(checks.find(c=>c.kind==='cash_snapshot').status,'conflict');
 assert.equal(checks.find(c=>c.kind==='holdings_snapshot').status,'conflict');
 assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[account.id])).cashMinor,10000);
});
test('attention messages are persistent, quiet, scoped, and do not repeat an unchanged problem',async()=>{
 process.env.TELEGRAM_BOT_TOKEN='test';process.env.TELEGRAM_CHAT_ID='test';
 const item={itemId:'auth',institutionName:'Test Bank',status:'login_required',lastSyncedAt:'2026-10-01'};
 assert.equal(await notifyBankAction(user,item),true);assert.equal(await notifyBankAction(user,item),false);
 assert.equal((await db.get('SELECT COUNT(*) n FROM telegram_outbox')).n,1);
 assert.equal(await notifyBankAction(user,{...item,status:'sync_error'}),false);
 await db.run('INSERT INTO user_settings(userId,currency,notificationsEnabled,updatedAt) VALUES(?,\'CAD\',0,?)',[user,new Date().toISOString()]);
 assert.equal(await enqueueAttentionNotice(user,'disabled',['new'],'Do not send'),false);
 delete process.env.TELEGRAM_BOT_TOKEN;delete process.env.TELEGRAM_CHAT_ID;
});
test('missed webhooks and unfinished investments queue recovery without resetting pending retry backoff',async()=>{
 process.env.PLAID_CLIENT_ID='test';process.env.PLAID_SECRET='test';
 const now=new Date().toISOString();
 for(const [id,status,date,investment]of [['stale','active','2020-01-01','active'],['fresh','active',now,'active'],['invest','active',now,'pending'],['auth','login_required',now,'active']]) {
  await db.run(`INSERT INTO plaid_items(itemId,userId,accessTokenEncrypted,institutionName,status,lastSyncedAt,investmentTransactionsStatus,createdAt,updatedAt)
   VALUES(?,?,'unused','Wealthsimple',?,?,?,?,?)`,[id,user,status,date,investment,now,now]);
 }
 assert.equal(await care.scheduleRecovery(user,Date.now(),{kick:false}),2);
 const jobs=await db.all('SELECT * FROM plaid_webhook_events');assert.equal(jobs.length,2);
 await db.run("UPDATE plaid_webhook_events SET status='retry',nextAttemptAt='2099-01-01'");
 assert.equal(await care.scheduleRecovery(user,Date.now(),{kick:false}),0);
 assert.ok((await db.all('SELECT nextAttemptAt FROM plaid_webhook_events')).every(j=>j.nextAttemptAt==='2099-01-01'));
 delete process.env.PLAID_CLIENT_ID;delete process.env.PLAID_SECRET;
});

test('new exact bank evidence links existing email history without deleting either row or the prior source assignment',async()=>{
 const cash=await service.createInvestmentAccount(user,{name:'Chequing',institution:'CIBC',accountType:'Chequing',currency:'CAD',accountRef:'8237',cashMinor:50000});
 const tx={userId:user,Amount:7,Currency:'CAD',Category:'Expense',Label:'Shopping',Reason:'Merchant',Timestamp:'2026-10-25T12:00:00Z',Type:'Chequing',Account:'8237',BankName:'CIBC',BalanceAccountId:cash.id,AccountFlow:'OUT',ReferenceNumber:'ABCXYZ77'};
 const email=await service.addTransaction({...tx,SourceEmailKey:'late-email'});
 await service.upsertTransactionSource({provider:'email',externalId:'late-email',userId:user,transactionId:email,rawPayload:{rawBody:'Account: 8237'}});
 const duplicate=await service.addTransaction(tx);
 await service.upsertTransactionSource({provider:'plaid',externalId:'late-bank',userId:user,transactionId:duplicate,itemId:'cash-item',ownsTransaction:true,
  rawPayload:{transaction_id:'late-bank',amount:7,date:'2026-10-25',iso_currency_code:'CAD',name:'Merchant',payment_meta:{reference_number:'ABCXYZ77'}},
  contextPayload:{account:{appAccountId:cash.id,mask:'8237',type:'depository',subtype:'checking'},institutionName:'CIBC'}});
 const before=(await db.get('SELECT COUNT(*) n FROM transactions')).n;
 assert.equal(await care.reconcileExistingSources(user),1);
 assert.equal((await db.get('SELECT COUNT(*) n FROM transactions')).n,before);
 assert.equal((await service.getTransactionById(duplicate,user)).PostingStatus,'unposted');
 assert.equal((await db.get("SELECT transactionId FROM transaction_sources WHERE externalId='late-bank'")).transactionId,email);
 assert.ok(await db.get('SELECT id FROM transaction_source_history WHERE transactionId=?',[duplicate]));
 assert.equal(await care.reconcileExistingSources(user),0);
});
test('review fingerprints ignore reconnection IDs and worker metadata but reopen for changed financial evidence',()=>{
 const {fingerprint}=require('./reliabilityReview');
 const tx={id:12,AmountMinor:700,Currency:'CAD',Category:'Expense'};
 const raw={amount:7,iso_currency_code:'CAD',date:'2026-10-25'};
 const one={provider:'plaid',externalId:'old-id',rawPayloadJson:JSON.stringify(raw),contextPayloadJson:JSON.stringify({account:{appAccountId:1}})};
 const two={...one,externalId:'new-connection-id',updatedAt:'new timestamp',rawPayloadJson:JSON.stringify({date:raw.date,iso_currency_code:'CAD',amount:7})};
 assert.equal(fingerprint(tx,[one]),fingerprint(tx,[two]));
 assert.notEqual(fingerprint(tx,[one]),fingerprint(tx,[{...two,rawPayloadJson:JSON.stringify({...raw,amount:8})}]));
});
test('operational notification transitions survive restarts and transport failures without repeat delivery',async()=>{
 process.env.OPERATIONAL_ALERT_WEBHOOK_URL='https://alerts.example.com/monimonitor';
 const {persistIncidents}=require('./financialReliability');
 const {drainOperationalNotices}=require('./operationalHealth');
 const issues=[{id:'stalled-worker',action:'Inspect worker logs'}];
 await persistIncidents(db,user,'operations',issues);await persistIncidents(db,user,'operations',issues);
 assert.equal((await db.get('SELECT COUNT(*) n FROM operational_notice_outbox')).n,1);
 const failed=await drainOperationalNotices(async()=>{throw new Error('temporary failure');});assert.equal(failed.retried,1);
 await db.run("UPDATE operational_notice_outbox SET nextAttemptAt='2000-01-01'");
 let delivered=0;await drainOperationalNotices(async()=>{delivered++;return{ok:true};});
 await persistIncidents(db,user,'operations',issues);await drainOperationalNotices(async()=>{delivered++;return{ok:true};});
 assert.equal(delivered,1);
 await persistIncidents(db,user,'operations',[]);await drainOperationalNotices(async()=>{delivered++;return{ok:true};});
 assert.equal(delivered,2);
 delete process.env.OPERATIONAL_ALERT_WEBHOOK_URL;
});
test('a care pass persists its outcome and reuses it until new bank evidence forces a pass',async()=>{
 const report=await care.runAutomaticCare(user,{force:true});
 assert.ok(report.checkedAt);assert.ok(Array.isArray(report.checks));
 const cached=await care.runAutomaticCare(user);assert.equal(cached.checkedAt,report.checkedAt);
 assert.ok(await db.get('SELECT checkedAt FROM automatic_care_runs WHERE userId=?',[user]));
});

test('new and modified Plaid records apply remembered categories while retaining provider financial facts',async()=>{
 const cash=await db.get("SELECT * FROM investment_accounts WHERE userId=? AND accountRef='8237'",[user]);
 const plaid=require('./plaidService'),accounts=new Map([['a',{appAccountId:cash.id,mask:'8237',type:'depository',subtype:'checking'}]]);
 const input={transaction_id:'coffee-preference',account_id:'a',amount:9,date:'2026-10-26',merchant_name:'Coffee place',name:'Coffee place',iso_currency_code:'CAD',personal_finance_category:{primary:'GENERAL_MERCHANDISE'}};
 const result=await plaid.importAddedTransaction(user,{itemId:'cash-item',institutionName:'CIBC'},input,accounts);
 assert.equal((await service.getTransactionById(result.transactionId,user)).Label,'Dining');
 await plaid.applyModifiedTransaction(user,{itemId:'cash-item',institutionName:'CIBC'},{...input,amount:9.5},accounts);
 const modified=await service.getTransactionById(result.transactionId,user);
 assert.equal(modified.Label,'Dining');assert.equal(modified.AmountMinor,950);assert.equal(modified.Currency,'CAD');assert.equal(modified.BalanceAccountId,cash.id);
});

test('previous explicit user corrections bootstrap preferences without overriding newer choices',async()=>{
 const old=await service.addTransaction({userId:user,Amount:1,Currency:'CAD',Category:'Expense',Label:'Shopping',Reason:'Coffee place',AccountFlow:'OUT',Timestamp:'2020-01-01'});
 await db.run("INSERT INTO transaction_overrides VALUES(?,?,?,'User reviewed correction','2000-01-01')",[old,user,JSON.stringify({Label:'Shopping'})]);
 await learning.learnReviewedPreferences(user);
 assert.equal((await learning.personalizeTransaction(user,{Amount:12,Currency:'CAD',Category:'Expense',Label:'Other Expense',Reason:'Coffee place',AccountFlow:'OUT'})).Label,'Dining');
 assert.equal((await service.getTransactionById(old,user)).Label,'Shopping');
});

test('existing explicit corrections are not asked again, but changed bank facts reopen the question',async()=>{
 const id=await service.addTransaction({userId:user,Amount:20,Currency:'CAD',Category:'Expense',Label:'Shopping',Reason:'Reviewed store',AccountFlow:'OUT',Timestamp:'2026-10-20'});
 await service.updateTransactionForUser(id,user,{Currency:'CAD'},{reviewed:true});
 await service.upsertTransactionSource({userId:user,provider:'plaid',externalId:'known-currency-conflict',transactionId:id,rawPayload:{amount:20,iso_currency_code:'USD',date:'2026-10-20'}});
 assert.ok(await care.reuseReviewedCorrections(user));
 const {checkFinancialReliability}=require('./financialReliability');
 assert.ok(!(await checkFinancialReliability(user,{force:true})).issues.some(i=>i.transactionId===id && i.kind==='currency_conflict'));
 await service.upsertTransactionSource({userId:user,provider:'plaid',externalId:'known-currency-conflict',transactionId:id,rawPayload:{amount:21,iso_currency_code:'USD',date:'2026-10-20'}});
 await care.reuseReviewedCorrections(user);
 assert.ok((await checkFinancialReliability(user,{force:true})).issues.some(i=>i.transactionId===id && i.kind==='currency_conflict'));
});
