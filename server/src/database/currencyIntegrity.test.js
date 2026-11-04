const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'currency-integrity-'));
process.env.MONIMONITOR_DB_PATH=path.join(dir,'test.sqlite');
const s=require('./dbService');
const {parseTransaction}=require('../validation/transaction');
let db,cad,usd;
test.before(async()=>{
 db=await s.getDb(); await s.createUser('u','u','unused');
 cad=await s.createInvestmentAccount('u',{name:'CAD',currency:'CAD',accountType:'Savings',cashMinor:10000});
 usd=await s.createInvestmentAccount('u',{name:'USD',currency:'USD',accountType:'Savings',cashMinor:10000});
});
test.after(async()=>{await db.close();fs.rmSync(dir,{recursive:true,force:true});});
const input=(extra={})=>parseTransaction({Amount:10,Category:'Expense',Timestamp:'2026-10-02T12:00:00Z',...extra});
test('manual entry derives CAD from selected account and posts atomically',async()=>{
 const result=await s.createManualTransaction('u',input(),cad.id);
 assert.equal(result.data.Currency,'CAD');assert.equal(result.accountPosting.status,'applied');
 assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',cad.id)).cashMinor,9000);
});
test('explicit currency accepted and normalized; invalid currency rejected',async()=>{
 assert.equal(input({Currency:' cad '}).Currency,'CAD');
 assert.throws(()=>input({Currency:'US'}));assert.throws(()=>input({Currency:'123'}));
 const result=await s.createManualTransaction('u',input({Currency:'USD'}),usd.id);assert.equal(result.data.Currency,'USD');
});
test('currency mismatch, foreign account, and insufficient funds do not save a transaction',async()=>{
 const before=await db.get('SELECT COUNT(*) n FROM transactions');
 await assert.rejects(s.createManualTransaction('u',input({Currency:'USD'}),cad.id),/must match/);
 await assert.rejects(s.createManualTransaction('other',input(),cad.id),/does not belong/);
 await assert.rejects(s.createManualTransaction('u',input({Amount:99999}),cad.id),/negative/);
 assert.deepEqual(await db.get('SELECT COUNT(*) n FROM transactions'),before);
});
test('manual entry without selected account uses explicit currency or user preference',async()=>{
 await s.saveUserSettings('u',{currency:'CAD',notificationsEnabled:true});
 assert.equal((await s.createManualTransaction('u',input())).data.Currency,'CAD');
 assert.equal((await s.createManualTransaction('u',input({Currency:'USD'}))).data.Currency,'USD');
});
test('summary, categories and monthly totals remain separate for CAD and USD',async()=>{
 await s.createUser('report','report','unused');
 for(const Currency of ['CAD','USD'])for(const [Category,Amount] of [['Income',100],['Expense',20],['Saving',10]])await s.addTransaction({userId:'report',Currency,Category,Amount,Label:'Test',Timestamp:'2026-10-02'});
 const mixed=await s.getSummaryForUser('report');assert.equal(mixed.totalIncome,null);assert.equal(mixed.balance,null);assert.deepEqual(mixed.byMonth,[]);
 assert.deepEqual(mixed.totalsByCurrency.map(x=>x.currency),['CAD','USD']);
 for(const currency of ['CAD','USD']){
  const summary=await s.getSummaryForUser('report',currency);assert.equal(summary.totalIncome,100);assert.equal(summary.totalExpenses,20);assert.equal(summary.balance,70);assert.equal(summary.byMonth[0].income,100);assert.equal(summary.byLabel.find(x=>x.Category==='Income').total,100);
 }
});
test('holding currency mismatch is rejected and funded accounts cannot be relabelled',async()=>{
 await assert.rejects(s.upsertInvestmentHolding('u',cad.id,{symbol:'ABC',quantity:1,priceMinor:10000,averageCostMinor:10000,currency:'USD'}),/must match/);
 await assert.rejects(s.updateInvestmentAccount('u',cad.id,{currency:'USD'}),/Cannot change currency/);
 assert.equal(await db.get('SELECT * FROM investment_holdings WHERE accountId=?',cad.id),undefined);
});
test('pre-existing mismatched holding is never silently added to account valuation',async()=>{
 await db.run("INSERT INTO investment_holdings(userId,accountId,symbol,quantity,currency,updatedAt) VALUES('u',?,'BAD',1,'USD','2026-11-01')",cad.id);
 try { await assert.rejects(s.getPortfolioSummary('u'),/Holdings currency does not match/); }
 finally{await db.run("DELETE FROM investment_holdings WHERE symbol='BAD'");}
});
test('both manual-entry API routes derive currency from the selected account',async()=>{
 const app=require('../../index');
 for(const route of ['/transactions','/MoniMonitor_ToDB']){
  const handler=app._router.stack.find(layer=>layer.route?.path===route && layer.route.methods.post).route.stack.at(-1).handle;
  const record={Amount:1,Category:'Expense',Timestamp:'2026-10-02',BalanceAccountId:cad.id};
  let status=200,result;
  await handler({user:{userId:'u'},body:route==='/transactions'?record:{status:'record',record_entry:record}}, {status(code){status=code;return this;},json(value){result=value;}});
  assert.equal(status,201);assert.equal(result.data.Currency,'CAD');assert.equal(result.accountPosting.status,'applied');
 }
});
