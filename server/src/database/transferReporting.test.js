const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-reporting-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
const s = require('./dbService');
let db;
test.before(async () => { db=await s.getDb(); await s.createUser('u','u','unused'); });
test.after(async () => { await db.close(); fs.rmSync(directory,{recursive:true,force:true}); });
test('summary excludes internal transfers from every reporting aggregate while preserving history', async () => {
 for (const [Amount,Category,extra] of [[100,'Income',{}],[20,'Expense',{}],[10,'Saving',{}],[500,'Saving',{PortfolioAction:'TRANSFER'}],[600,'Expense',{TransferFromAccountId:1,TransferToAccountId:2}],[5,'Income',{Type:'Transfer'}]]) {
  await s.addTransaction({userId:'u',Amount,Category,Label:'Test',Timestamp:'2026-10-02T12:00:00Z',...extra});
 }
 const summary=await s.getSummaryForUser('u');
 assert.equal(summary.totalIncome,105); assert.equal(summary.totalExpenses,20); assert.equal(summary.totalSavings,10); assert.equal(summary.balance,75);
 assert.equal(summary.byMonth[0].savings,10); assert.equal(summary.byMonth[0].count,4);
 assert.equal(summary.byLabel.find(x=>x.Category==='Expense').total,20);
 assert.equal((await db.get("SELECT COUNT(*) n FROM transactions WHERE userId='u'")).n,6);
 assert.equal((await s.getSummaryForUser('other')).balance,0);
});
