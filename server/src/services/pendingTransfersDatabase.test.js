const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-pending-transfers-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
const service = require('../database/dbService');
const mutations = require('./transactionMutations');
const { attachPendingTransfers } = require('./pendingTransferService');
const { setAccountBalanceSnapshot } = require('./accountBalanceService');
let db;
let sequence = 0;
test.before(async () => { db = await service.getDb(); });
test.after(async () => { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
async function fixture(currency = 'CAD') {
    const userId = 'pending-owner-' + (++sequence);
    await service.createUser(userId, userId, 'unused');
    const source = await service.createInvestmentAccount(userId, { name: 'Source', accountType: 'Savings', currency: 'CAD', cashMinor: 10000 });
    const destination = await service.createInvestmentAccount(userId, { name: 'Destination', accountType: 'TFSA', currency, cashMinor: 20000 });
    const now = new Date().toISOString();
    const id = await service.addTransaction({ userId, Amount: 25, Currency: 'CAD', Category: 'Internal', Label: 'Internal Transfer',
        Reason: 'Transfer', Timestamp: now, ReceivedAt: now, PortfolioAction: 'TRANSFER', PortfolioAccountId: destination.id,
        PortfolioConfidence: 'HIGH', BalanceAccountId: source.id, BalanceAccountConfidence: 'HIGH', AccountFlow: 'OUT' });
    await service.upsertTransactionSource({ userId, provider: 'email', externalId: userId + ':email', transactionId: id, ownsTransaction: true });
    return { userId, source, destination, id };
}
async function rawCash(f) { return (await db.all('SELECT cashMinor FROM investment_accounts WHERE userId = ? ORDER BY id', [f.userId])).map(a => a.cashMinor); }

test('repeated and concurrent reads keep confirmed balances unchanged and show pending estimates', async () => {
    const f = await fixture();
    const repeated = await Promise.all(Array.from({ length: 4 }, () => service.getInvestmentAccounts(f.userId)));
    for (const accounts of repeated) {
        assert.equal(accounts[0].cashMinor, 10000);
        assert.equal(accounts[0].pendingCashDeltaMinor, -2500);
        assert.equal(accounts[0].estimatedCashMinor, 7500);
        assert.equal(accounts[1].estimatedCashMinor, 22500);
    }
    assert.deepEqual(await rawCash(f), [10000, 20000]);
    const portfolio = await service.getPortfolioSummary(f.userId);
    assert.equal(portfolio.totalCashMinor, 30000);
    assert.equal(portfolio.totalValueMinor, 30000);
});

test('provider confirmation removes both estimates without altering confirmed cash', async () => {
    const f = await fixture();
    await service.upsertTransactionSource({ userId: f.userId, provider: 'plaid', externalId: 'confirmed', transactionId: f.id, ownsTransaction: false });
    const accounts = await service.getInvestmentAccounts(f.userId);
    assert.equal(accounts[0].pendingTransfers.length, 0);
    assert.equal(accounts[1].pendingCashDeltaMinor, 0);
    assert.deepEqual(await rawCash(f), [10000, 20000]);
});

test('editing, deletion and expiration remove stale estimates immediately', async () => {
    const f = await fixture();
    await mutations.updateTransaction(f.userId, f.id, { Amount: 30 });
    const accounts = await service.getInvestmentAccounts(f.userId);
    assert.equal(accounts[0].pendingTransfers[0].status, 'already_posted');
    assert.equal(accounts[0].estimatedCashMinor, 7000);
    assert.equal(accounts[1].estimatedCashMinor, 23000);
    const expired = await attachPendingTransfers(db, f.userId, accounts, Date.now() + 8 * 24 * 60 * 60 * 1000);
    assert.equal(expired.transferCount, 0);
    assert.equal(expired.accounts[1].estimatedCashMinor, 20000);
    await service.deleteTransaction(f.id, f.userId);
    assert.equal((await service.getInvestmentAccounts(f.userId))[1].pendingTransfers.length, 0);
    assert.deepEqual(await rawCash(f), [10000, 20000]);
});

test('fresh provider snapshots stay separate from pending transfers', async () => {
    const f = await fixture();
    await setAccountBalanceSnapshot(f.userId, f.source.id, 7500, 'CAD');
    await setAccountBalanceSnapshot(f.userId, f.destination.id, 22500, 'CAD');
    await mutations.updateTransaction(f.userId, f.id, { Amount: 20 });
    const accounts = await service.getInvestmentAccounts(f.userId);
    assert.deepEqual(await rawCash(f), [7500, 22500]);
    assert.equal(accounts[0].estimatedCashMinor, 5500);
    assert.equal(accounts[1].estimatedCashMinor, 24500);
});

test('cross-currency estimates require review and never move native cash', async () => {
    const f = await fixture('USD');
    const accounts = await service.getInvestmentAccounts(f.userId);
    assert.equal(accounts[0].estimatedCashMinor, null);
    assert.equal(accounts[1].estimatedCashMinor, null);
    assert.match(accounts[1].pendingTransfers[0].reason, /exchange rates/);
    assert.deepEqual(await rawCash(f), [10000, 20000]);
    const other = await fixture();
    assert.equal((await service.getInvestmentAccounts(other.userId))[0].pendingTransfers.length, 1);
});

test('overdrawn estimates and legacy balance uncertainty are visible without clamping', async () => {
    const f = await fixture();
    await setAccountBalanceSnapshot(f.userId, f.source.id, 100, 'CAD');
    let accounts = await service.getInvestmentAccounts(f.userId);
    assert.equal(accounts[0].estimatedCashMinor, -2400);
    assert.equal(accounts[0].pendingBalanceReviewRequired, true);
    await db.run('UPDATE investment_accounts SET balanceReviewReason = ? WHERE id = ?', ['Review possible legacy pending-transfer adjustments', f.source.id]);
    accounts = await service.getInvestmentAccounts(f.userId);
    assert.equal(accounts[0].estimatedCashMinor, null);
    assert.equal(accounts[0].pendingBalanceReviewRequired, true);
    assert.equal(accounts[0].cashMinor, 100);
});


test('migration flags legacy cash without guessing a reversal and reviewed balances can be reaffirmed', async () => {
    const f = await fixture();
    const { MIGRATIONS } = require('../database/migrations');
    await MIGRATIONS.find(m => m.version === 7).up(db);
    const accounts = await service.getInvestmentAccounts(f.userId);
    assert.equal(accounts[0].estimatedCashMinor, null);
    assert.deepEqual(await rawCash(f), [10000, 20000]);
    await service.updateInvestmentAccount(f.userId, f.source.id, { cashMinor: 10000 });
    const reviewed = (await service.getInvestmentAccounts(f.userId))[0];
    assert.equal(reviewed.balanceReviewReason, null);
    assert.equal(reviewed.estimatedCashMinor, 7500);
});

test('uncertain account assignments are shown for review instead of estimated', async () => {
    const f = await fixture();
    await db.run('UPDATE transactions SET PortfolioConfidence = ? WHERE id = ?', ['LOW', f.id]);
    const accounts = await service.getInvestmentAccounts(f.userId);
    assert.equal(accounts[0].estimatedCashMinor, null);
    assert.match(accounts[0].pendingTransfers[0].reason, /confirmation/);
    assert.deepEqual(await rawCash(f), [10000, 20000]);
});

test('an estimate beyond safe integer precision is unavailable and requires review', async () => {
    const f = await fixture();
    await setAccountBalanceSnapshot(f.userId, f.destination.id, Number.MAX_SAFE_INTEGER, 'CAD');
    const accounts = await service.getInvestmentAccounts(f.userId);
    assert.equal(accounts[1].estimatedCashMinor, null);
    assert.equal(accounts[1].pendingBalanceReviewRequired, true);
    assert.equal(accounts[1].cashMinor, Number.MAX_SAFE_INTEGER);
});
