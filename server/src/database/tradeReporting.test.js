const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trade-reporting-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
const s = require('./dbService');
let db, account;
test.before(async () => {
 db=await s.getDb(); await s.createUser('u','u','unused');
 account=await s.createInvestmentAccount('u',{name:'Broker',currency:'CAD',accountType:'TFSA',cashMinor:10000});
});
test.after(async()=>{await db.close();fs.rmSync(directory,{recursive:true,force:true});});
async function trade(action, price, saveAction=true) {
 const id=await s.addTransaction({userId:'u',Amount:price,Currency:'CAD',Category:'Saving',Label:'Investment',Timestamp:'2026-10-02T12:00:00Z',PortfolioAction:saveAction?action:null});
 assert.equal((await s.applyEmailPortfolioActivity('u',id,{action,accountId:account.id,confidence:'HIGH',symbol:'ABC',quantity:1,price})).status,'applied');
 return id;
}
test('buy 10 and sell 15 change account cash to 105 without creating savings or household cash flow',async()=>{
 await trade('BUY',10);await trade('SELL',15);
 const summary=await s.getSummaryForUser('u','CAD');
 assert.equal(summary.totalSavings,0);assert.equal(summary.totalIncome,0);assert.equal(summary.totalExpenses,0);assert.equal(summary.balance,0);
 assert.deepEqual(summary.byLabel,[]);assert.deepEqual(summary.byMonth,[]);
 assert.equal((await s.getInvestmentAccounts('u'))[0].cashMinor,10500);
 assert.equal((await s.getAllTransactionsForUser('u')).length,2);
});
test('older trades with ledger evidence but no action field are excluded too',async()=>{
 const id=await trade('BUY',15,false);
 assert.equal((await s.getSummaryForUser('u','CAD')).totalSavings,0);
 const rows=await s.getAllTransactionsForUser('u');
 assert.equal(rows.find(row=>row.id===id).PortfolioPostingKind,'EMAIL_BUY');
});
test('real contributions and ordinary savings remain in reporting',async()=>{
 for(const [Amount,PortfolioAction] of [[50,'CONTRIBUTION'],[20,null]])await s.addTransaction({userId:'u',Amount,PortfolioAction,Currency:'CAD',Category:'Saving',Label:'Investment',Timestamp:'2026-10-02T12:00:00Z'});
 const summary=await s.getSummaryForUser('u','CAD');
 assert.equal(summary.totalSavings,70);assert.equal(summary.balance,-70);
 assert.equal(summary.byMonth[0].savings,70);assert.equal(summary.byMonth[0].count,2);assert.equal(summary.byLabel[0].total,70);
});
