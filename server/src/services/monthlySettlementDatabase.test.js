const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-settlement-'));process.env.MONIMONITOR_DB_PATH=path.join(directory,'test.sqlite');
const service=require('../database/dbService'),{applyPlan}=require('../../scripts/repair-retained-history'),{checkVerifiedLedgers}=require('./verifiedHistory');let db,account,trade;
const user='monthly';
test.before(async()=>{
 db=await service.getDb();await service.createUser(user,user,'unused');account=await service.createInvestmentAccount(user,{name:'TFSA',institution:'Wealthsimple',accountType:'TFSA',accountRef:'T123',currency:'CAD',cashMinor:9001});
 await service.addTransaction({userId:user,Amount:100,Currency:'CAD',Category:'Income',Label:'Other Income',Reason:'Opening deposit',Timestamp:'2026-07-01',AccountFlow:'IN',BalanceAccountId:account.id});
 trade=await service.addTransaction({userId:user,Amount:9.99,Currency:'CAD',Category:'Investment',Label:'ETF & Stock Purchase',Reason:'ETF',Timestamp:'2026-09-01T12:00:00.000Z',AccountFlow:'OUT',BalanceAccountId:account.id,PortfolioAccountId:account.id,PortfolioAction:'BUY',PortfolioSymbol:'ETF',PortfolioQuantity:0.2,PortfolioPrice:49.95});
 const row=await service.getTransactionById(trade,user);
 await db.run('INSERT INTO verified_history_entries VALUES(?,?,?,?,?,?)',[user,trade,account.id,JSON.stringify({...row,Amount:9.99}),JSON.stringify({checkpoint:'original'}),'2026-10-31']);
 await db.run('INSERT INTO verified_ledger_controls VALUES(?,?,?,?,?)',[user,account.id,'2026-10-31',9001,JSON.stringify({dateBasis:'transaction'})]);
});
test.after(async()=>{await db.close();fs.rmSync(directory,{recursive:true,force:true});});
function plan(){return {userId:user,cutoffDate:'2026-10-31',basis:{checkpointSha256:'c'.repeat(64)},entries:[],controls:[
 {accountId:account.id,cutoffDate:'2026-08-31',cashMinor:10000,basis:{dateBasis:'settlement'}},
 {accountId:account.id,cutoffDate:'2026-09-30',cashMinor:9001,basis:{dateBasis:'settlement'}}],updates:[{id:trade,expected:{Timestamp:'2026-09-01T12:00:00.000Z',CashDate:null},fields:{Timestamp:'2026-08-31T12:00:00.000Z',CashDate:'2026-09-01'},source:{provider:'bank_csv',externalId:'verified-trade-date',rawPayload:{effective_date:'2026-08-31',settlement_date:'2026-09-01',symbol:'ETF',quantity:0.2,net_cash_amount:-9.99}}}],requireControlAgreement:true};}
test('statement closing cash and execution date remain correct across a month boundary and source replay',async()=>{
 const before=(await db.get('SELECT COUNT(*) n FROM transactions')).n;
 assert.deepEqual(await db.withTransaction(()=>applyPlan(db,user,plan())),{restored:0,updated:1});
 const row=await service.getTransactionById(trade,user);assert.equal(row.Timestamp,'2026-08-31T12:00:00.000Z');assert.equal(row.CashDate,'2026-09-01');
 const checks=await checkVerifiedLedgers(user);assert.equal(checks.length,3);assert.ok(checks.every(c=>c.status==='agrees'));
 await service.updateTransactionForUser(trade,user,{Timestamp:'2026-09-01T12:00:00.000Z'});
 assert.equal((await service.getTransactionById(trade,user)).Timestamp,row.Timestamp);
 assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[account.id])).cashMinor,9001);
 assert.equal((await db.get('SELECT COUNT(*) n FROM transactions')).n,before);
 const verified=JSON.parse((await db.get('SELECT factsJson FROM verified_history_entries WHERE transactionId=?',[trade])).factsJson);assert.equal(verified.Timestamp,row.Timestamp);assert.equal(verified.CashDate,row.CashDate);
 assert.deepEqual(await db.withTransaction(()=>applyPlan(db,user,plan())),{restored:0,updated:0});
});
test('a failed monthly closing check rolls back the entire date repair and keeps prior proof',async()=>{
 const p=plan();p.controls=[{accountId:account.id,cutoffDate:'2026-08-30',cashMinor:12345,basis:{dateBasis:'settlement'}}];p.updates=[{id:trade,expected:{CashDate:'2026-09-01'},fields:{CashDate:'2026-09-02'}}];
 await assert.rejects(db.withTransaction(()=>applyPlan(db,user,p)),/Bank closing controls do not reconcile/);
 assert.equal((await service.getTransactionById(trade,user)).CashDate,'2026-09-01');assert.equal((await checkVerifiedLedgers(user)).length,3);
});
test('invalid settlement days and another tenant account cannot become verified controls',async()=>{
 await assert.rejects(service.updateTransactionForUser(trade,user,{CashDate:'2026-02-30'},{reviewed:true}),/Invalid cash settlement date/);
 const p=plan();p.controls=[{accountId:account.id,cutoffDate:'2026-06-30',cashMinor:0}];p.userId='another-user';
 await assert.rejects(db.withTransaction(()=>applyPlan(db,'another-user',p)),/Control account not found/);
});

test('equal third-party transfers on different owned accounts do not become a self-transfer',async()=>{
 const from=await service.createInvestmentAccount(user,{name:'Chequing',institution:'RBC',accountType:'Chequing',accountRef:'6554',currency:'CAD',cashMinor:5000});
 const to=await service.createInvestmentAccount(user,{name:'Other Chequing',institution:'CIBC',accountType:'Chequing',accountRef:'8237',currency:'CAD',cashMinor:10000});
 const a=await service.addTransaction({userId:user,Amount:20,Currency:'CAD',Category:'Expense',Label:'Personal Transfers',Reason:'E-Transfer sent to Behdad',Timestamp:'2024-12-30',Account:'6554',BankName:'RBC',BalanceAccountId:from.id,AccountFlow:'OUT'});
 const b=await service.addTransaction({userId:user,Amount:20,Currency:'CAD',Category:'Income',Label:'Personal Transfers Received',Reason:'Interac transfer from someone else',Timestamp:'2024-12-30',Account:'8237',BankName:'CIBC',BalanceAccountId:to.id,AccountFlow:'IN'});
 assert.deepEqual(await service.detectAndReclassifyInternalCounterparts(user,a),[]);
 assert.equal((await service.getTransactionById(a,user)).Category,'Expense');assert.equal((await service.getTransactionById(b,user)).Category,'Income');
 const card=await service.addTransaction({userId:user,Amount:20,Currency:'CAD',Category:'Internal',Label:'Internal Transfer',Reason:'Credit-card payment received',Timestamp:'2024-12-28',Account:'2379',BankName:'RBC',AccountFlow:'IN'});
 assert.deepEqual(await service.detectAndReclassifyInternalCounterparts(user,card),[]);
});

test('new bank ingestion persists posted cash date separately from authorization date',async()=>{
 const {toAppTransaction}=require('./plaidService');
 const row=toAppTransaction({amount:12,date:'2026-09-01',authorized_date:'2026-08-31',iso_currency_code:'CAD',name:'Store purchase',pending:false},{appAccountId:account.id,mask:'T123'},'Wealthsimple');
 assert.equal(row.Timestamp.slice(0,10),'2026-08-31');assert.equal(row.CashDate,'2026-09-01');
 const id=await service.addTransaction({...row,userId:user});assert.equal((await service.getTransactionById(id,user)).CashDate,'2026-09-01');
 await db.run("UPDATE investment_accounts SET balanceSource='plaid' WHERE id=?",[account.id]);
 await service.syncTransactionAccountBalance(user,id,{accountId:account.id,confidence:'HIGH'});
 assert.equal((await db.get('SELECT occurredAt FROM account_balance_events WHERE sourceTransactionId=?',[id])).occurredAt,'2026-09-01');
});
