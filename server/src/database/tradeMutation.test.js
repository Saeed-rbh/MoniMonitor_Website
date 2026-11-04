const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trade-mutation-'));
process.env.MONIMONITOR_DB_PATH = path.join(dir, 'test.sqlite');
const s = require('./dbService');
let db, account;
test.before(async () => { db = await s.getDb(); await s.createUser('u','u','unused'); });
test.beforeEach(async () => {
    account = await s.createInvestmentAccount('u', { name:'Broker', accountType:'TFSA', currency:'CAD', cashMinor:10000 });
});
test.after(async () => { await db.close(); fs.rmSync(dir, {recursive:true,force:true}); });
async function trade(action, quantity, price) {
    const id = await s.addTransaction({userId:'u', Amount:quantity*price, Currency:'CAD', Category:'Saving', Label:'Investment', Timestamp:'2026-11-01T12:00:00Z', PortfolioAction:action, PortfolioAccountId:account.id, PortfolioConfidence:'HIGH', PortfolioSymbol:'ABC', PortfolioQuantity:quantity, PortfolioPrice:price});
    assert.equal((await s.applyEmailPortfolioActivity('u',id,{accountId:account.id,confidence:'HIGH',action,symbol:'ABC',quantity,price})).status,'applied');
    return id;
}
async function state() { return { cash:(await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',account.id)).cashMinor, holding:await db.get('SELECT * FROM investment_holdings WHERE accountId=?',account.id) }; }
test('deleting a buy reverses cash, shares and portfolio entry exactly once', async () => {
 const id=await trade('BUY',0.5,20);
 assert.equal(await s.deleteTransaction(id,'other'),false);
 assert.equal((await state()).cash,9000);
 assert.equal(await s.deleteTransaction(id,'u'),true);
 assert.equal((await state()).cash,10000);
 assert.equal((await state()).holding,undefined);
 assert.equal(await s.deleteTransaction(id,'u'),false);
 assert.equal(await db.get('SELECT * FROM portfolio_transactions WHERE sourceTransactionId=?',id),undefined);
});
test('deleting a full sale restores fractional holdings and original cost basis', async () => {
 await trade('BUY',0.5,20); const before=await state(); const id=await trade('SELL',0.5,30);
 await s.deleteTransaction(id,'u'); assert.deepEqual(await state(),before);
});
test('deleting an earlier buy recalculates later buy cost basis', async () => {
 const first=await trade('BUY',1,10); const second=await trade('BUY',1,20);
 await s.deleteTransaction(first,'u');
 assert.equal((await state()).holding.quantity,1);
 assert.equal((await state()).holding.averageCostMicros,20000000);
 assert.equal((await state()).cash,8000);
 await s.deleteTransaction(second,'u'); assert.equal((await state()).cash,10000); assert.equal((await state()).holding,undefined);
});
test('dependent sales reject deletion and preserve all state', async () => {
 const id=await trade('BUY',1,10); await trade('SELL',1,20); const before=await state();
 await assert.rejects(s.deleteTransaction(id,'u'),/depend on these shares/);
 assert.deepEqual(await state(),before); assert.ok(await s.getTransactionById(id,'u'));
});
test('failed trade edit rolls back transaction, cash, holdings and ledger', async () => {
 const id=await trade('BUY',1,10); const before=await state(); const tx=await s.getTransactionById(id,'u');
 await assert.rejects(s.editTransaction('u',id,{Amount:90}),/does not match/);
 assert.deepEqual(await state(),before); assert.deepEqual(await s.getTransactionById(id,'u'),tx);
 assert.ok(await db.get('SELECT * FROM portfolio_transactions WHERE sourceTransactionId=?',id));
});
test('metadata edits preserve trade effects', async () => {
 const id=await trade('BUY',1,10); const before=await state();
 await s.editTransaction('u',id,{Reason:'Corrected merchant'}); assert.deepEqual(await state(),before);
});
test('cash transaction edits roll back when posting fails', async () => {
 const id=await s.addTransaction({userId:'u',Amount:10,Currency:'CAD',Category:'Expense',Label:'Food',Timestamp:'2026-11-01'});
 await s.syncTransactionAccountBalance('u',id,{accountId:account.id,confidence:'HIGH'});
 const before=await state(); const tx=await s.getTransactionById(id,'u');
 await assert.rejects(s.editTransaction('u',id,{Amount:1000}));
 assert.deepEqual(await state(),before); assert.deepEqual(await s.getTransactionById(id,'u'),tx);
 const result=await s.editTransaction('u',id,{Amount:20}); assert.equal(result.accountPosting.status,'applied'); assert.equal((await state()).cash,8000);
});
test('legacy buy reverses using stored quantity and execution price', async () => {
 const id=await trade('BUY',1,10);
 await db.run('UPDATE portfolio_transactions SET holdingBefore=NULL,holdingAfter=NULL WHERE sourceTransactionId=?',id);
 await s.deleteTransaction(id,'u'); assert.equal((await state()).cash,10000); assert.equal((await state()).holding,undefined);
});
test('manual holding changes block reversal without losing any data', async () => {
 const id=await trade('BUY',1,10);
 await db.run('UPDATE investment_holdings SET quantity=2 WHERE accountId=?',account.id);
 const before=await state(); await assert.rejects(s.deleteTransaction(id,'u'),/changed independently/);
 assert.deepEqual(await state(),before); assert.ok(await s.getTransactionById(id,'u'));
});
test('a successful trade timestamp edit preserves cash and holdings', async () => {
 const id=await trade('BUY',1,10);
 const result=await s.editTransaction('u',id,{Timestamp:'2026-11-02T12:00:00Z'});
 assert.equal(result.accountPosting.status,'applied'); assert.equal(result.data.Timestamp,'2026-11-02T12:00:00Z');
 assert.equal((await state()).cash,9000); assert.equal((await state()).holding.quantity,1);
});
test('database failure during deletion rolls back the reversal too', async () => {
 const id=await trade('BUY',1,10); const before=await state();
 // Persistent trigger also applies to the dedicated mutation connection.
 await db.exec(`CREATE TRIGGER fail_delete BEFORE DELETE ON transactions WHEN OLD.id = ${id} BEGIN SELECT RAISE(ABORT, 'simulated delete failure'); END`);
 try {
   await assert.rejects(s.deleteTransaction(id,'u'),/simulated delete failure/);
   assert.deepEqual(await state(),before); assert.ok(await s.getTransactionById(id,'u'));
   assert.ok(await db.get('SELECT * FROM portfolio_transactions WHERE sourceTransactionId=?',id));
 } finally { await db.exec('DROP TRIGGER fail_delete'); }
});
