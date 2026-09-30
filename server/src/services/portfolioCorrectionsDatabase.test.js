const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-corrections-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
const service = require('../database/dbService');
const corrections = require('./portfolioCorrections');
const mutations = require('./transactionMutations');
const { setAccountBalanceSnapshot } = require('./accountBalanceService');
let db, sequence = 0;
test.before(async () => { db = await service.getDb(); });
test.after(async () => { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

async function fixture(action = 'BUY', quantity = 2) {
    const userId = `correction-${++sequence}`;
    await service.createUser(userId, userId, 'unused');
    const account = await service.createInvestmentAccount(userId, { name: 'TFSA', accountType: 'TFSA', currency: 'CAD', cashMinor: 10000 });
    await service.upsertInvestmentHolding(userId, account.id, { symbol: 'ABC', quantity: 5, averageCostMinor: 700,
        averageCostMicros: 7000000, priceMinor: 1000, priceMicros: 10000000, currency: 'CAD' });
    const transactionId = await service.addTransaction({ userId, Amount: quantity * 10, AmountMinor: quantity * 1000,
        Category: 'Investment', Label: 'Investment', Timestamp: new Date().toISOString(), ReceivedAt: new Date().toISOString(),
        PortfolioAction: action, PortfolioAccountId: account.id, PortfolioConfidence: 'HIGH',
        PortfolioSymbol: 'ABC', PortfolioQuantity: quantity, PortfolioPrice: 10 });
    await service.upsertTransactionSource({ userId, provider: 'email', externalId: userId, transactionId, ownsTransaction: true });
    assert.equal((await service.applyEmailPortfolioActivity(userId, transactionId, { accountId: account.id,
        confidence: 'HIGH', action, symbol: 'ABC', quantity, price: 10 })).status, 'applied');
    return { userId, account, transactionId };
}
const holding = f => db.get('SELECT * FROM investment_holdings WHERE accountId = ?', [f.account.id]);
const cash = async f => (await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [f.account.id])).cashMinor;
const preview = f => corrections.getPortfolioCorrection(f.userId, f.transactionId);
const reverse = async (f, extra = {}) => corrections.reversePortfolioActivity(f.userId, f.transactionId,
    { token: (await preview(f)).token, reason: 'Duplicate trade entry', ...extra });

test('reversing a buy restores exact original shares and cost basis, retains evidence, and permits edits', async () => {
    const f = await fixture();
    assert.equal(await cash(f), 8000);
    await reverse(f);
    assert.equal(await cash(f), 10000);
    assert.equal((await holding(f)).quantity, 5);
    assert.equal((await holding(f)).averageCostMicros, 7000000);
    assert.ok(await db.get('SELECT externalId FROM transaction_sources WHERE transactionId = ?', [f.transactionId]));
    assert.ok((await db.get('SELECT reversedAt FROM portfolio_transactions WHERE sourceTransactionId = ?', [f.transactionId])).reversedAt);
    await mutations.updateTransaction(f.userId, f.transactionId, { Reason: 'Corrected history' });
    assert.equal((await service.reconcileEmailPortfolioActivities(f.userId)).length, 0);
    assert.equal((await service.getInvestmentAccounts(f.userId))[0].pendingTrades.length, 0);
    assert.equal((await reverse(f)).alreadyReversed, true);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM agent_audit_log WHERE userId = ? AND action = 'portfolio_reversal'", [f.userId])).count, 1);
});

test('reversing a complete sell recreates the original holding and its cost basis', async () => {
    const f = await fixture('SELL', 5);
    assert.equal(await holding(f), undefined);
    await reverse(f);
    assert.equal(await cash(f), 10000);
    assert.equal((await holding(f)).quantity, 5);
    assert.equal((await holding(f)).averageCostMicros, 7000000);
});

test('correcting trade details reverses and reapplies atomically with one active history record', async () => {
    const f = await fixture();
    const result = await corrections.correctPortfolioTrade(f.userId, f.transactionId, {
        token: (await preview(f)).token, reason: 'Correct execution quantity',
        correction: { action: 'BUY', symbol: 'ABC', quantity: 1, price: 12, amountMinor: 1200 },
    });
    assert.equal(result.corrected, true);
    assert.equal(await cash(f), 8800);
    assert.equal((await holding(f)).quantity, 6);
    assert.equal((await holding(f)).averageCostMicros, 7833333);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM portfolio_transactions WHERE sourceTransactionId = ?', [f.transactionId])).count, 2);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM portfolio_transactions WHERE sourceTransactionId = ? AND reversedAt IS NULL', [f.transactionId])).count, 1);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM agent_audit_log WHERE userId = ? AND action = 'portfolio_correction'", [f.userId])).count, 1);
});

test('invalid corrected sell rolls back reversal, source edits, shares, cash and audit', async () => {
    const f = await fixture();
    await assert.rejects(corrections.correctPortfolioTrade(f.userId, f.transactionId, {
        token: (await preview(f)).token, reason: 'Correct action',
        correction: { action: 'SELL', symbol: 'ABC', quantity: 100, price: 10, amountMinor: 100000 },
    }), /Sell exceeds/);
    assert.equal(await cash(f), 8000);
    assert.equal((await holding(f)).quantity, 7);
    assert.equal((await service.getTransactionById(f.transactionId, f.userId)).PortfolioAction, 'BUY');
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM agent_audit_log WHERE userId = ?', [f.userId])).count, 0);
});

test('stale previews and foreign owners cannot reverse activity', async () => {
    const f = await fixture();
    const old = await preview(f);
    await db.run('UPDATE investment_accounts SET cashMinor = cashMinor + 1 WHERE id = ?', [f.account.id]);
    await assert.rejects(corrections.reversePortfolioActivity(f.userId, f.transactionId, { token: old.token, reason: 'Correct trade' }), /Refresh/);
    await assert.rejects(corrections.getPortfolioCorrection('other-user', f.transactionId), e => e.statusCode === 404);
    assert.equal(await cash(f), 8001);
});

test('a later bank cash snapshot is preserved when reversing holding activity', async () => {
    const f = await fixture();
    await setAccountBalanceSnapshot(f.userId, f.account.id, 15000, 'CAD');
    assert.equal((await preview(f)).cashAbsorbed, true);
    await reverse(f);
    assert.equal(await cash(f), 15000);
    assert.equal((await holding(f)).quantity, 5);
});

test('later bank holdings and cash are retained while history is reversed', async () => {
    const f = await fixture();
    await db.run("UPDATE investment_holdings SET quantity = 20, averageCostMicros = 4000000 WHERE accountId = ?", [f.account.id]);
    await db.run("UPDATE investment_accounts SET holdingsSource = 'plaid', holdingsAsOf = '2030-01-01' WHERE id = ?", [f.account.id]);
    await setAccountBalanceSnapshot(f.userId, f.account.id, 3000, 'CAD');
    await reverse(f);
    assert.equal(await cash(f), 3000);
    assert.equal((await holding(f)).quantity, 20);
});

test('legacy activity and independently edited cost basis require explicitly verified baseline', async () => {
    const f = await fixture();
    await db.run('UPDATE portfolio_transactions SET reversalState = NULL WHERE sourceTransactionId = ?', [f.transactionId]);
    assert.equal((await preview(f)).requiresBaselineReview, true);
    await assert.rejects(reverse(f), /older activity/);
    await reverse(f, { verifiedBaseline: true });
    assert.equal(await cash(f), 8000);
    assert.equal((await holding(f)).quantity, 7);
    const edited = await fixture();
    await db.run('UPDATE investment_holdings SET averageCostMicros = 12340000 WHERE accountId = ?', [edited.account.id]);
    await assert.rejects(reverse(edited), /cost basis has changed/);
});

test('reversing later activity first allows dependent trades to be reversed in order', async () => {
    const f = await fixture();
    const id = await service.addTransaction({ userId: f.userId, AmountMinor: 1000, Category: 'Investment', Label: 'Investment',
        Timestamp: new Date().toISOString(), PortfolioAction: 'BUY', PortfolioAccountId: f.account.id,
        PortfolioConfidence: 'HIGH', PortfolioSymbol: 'ABC', PortfolioQuantity: 1, PortfolioPrice: 10 });
    await service.applyEmailPortfolioActivity(f.userId, id, { accountId: f.account.id, confidence: 'HIGH', action: 'BUY', symbol: 'ABC', quantity: 1, price: 10 });
    await assert.rejects(reverse(f), /later portfolio activity/);
    await reverse({ ...f, transactionId: id });
    await reverse(f);
    assert.equal((await holding(f)).quantity, 5);
    assert.equal(await cash(f), 10000);
});

test('malformed saved reversal state requires reviewed baseline instead of crashing or guessing', async () => {
    const f = await fixture();
    await db.run('UPDATE portfolio_transactions SET reversalState = ? WHERE sourceTransactionId = ?', ['{"before":{}}', f.transactionId]);
    assert.equal((await preview(f)).requiresBaselineReview, true);
    await assert.rejects(reverse(f), /older activity/);
    assert.equal(await cash(f), 8000);
});

test('bank cash with manually maintained holdings does not receive a second email posting', async () => {
    const f = await fixture();
    await setAccountBalanceSnapshot(f.userId, f.account.id, 15000, 'CAD');
    const id = await service.addTransaction({ userId: f.userId, AmountMinor: 1000, Category: 'Investment', Label: 'Investment',
        Timestamp: new Date().toISOString(), PortfolioAction: 'BUY', PortfolioAccountId: f.account.id,
        PortfolioConfidence: 'HIGH', PortfolioSymbol: 'ABC', PortfolioQuantity: 1, PortfolioPrice: 10 });
    assert.equal((await service.applyEmailPortfolioActivity(f.userId, id, { accountId: f.account.id,
        confidence: 'HIGH', action: 'BUY', symbol: 'ABC', quantity: 1, price: 10 })).status, 'pending_bank_confirmation');
    assert.equal(await cash(f), 15000);
    assert.equal((await holding(f)).quantity, 7);
});
