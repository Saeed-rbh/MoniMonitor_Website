const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-balance-provenance-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
const service = require('../database/dbService');
const mutations = require('./transactionMutations');
const { setAccountBalanceSnapshot } = require('./accountBalanceService');
const { applyInvestmentSnapshot } = require('./plaidService');
let db;
test.before(async () => { db = await service.getDb(); await service.createUser('owner', 'snapshot-owner', 'unused'); });
test.after(async () => { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
const input = { Amount: 100, Category: 'Income', Label: 'Deposit', Reason: 'Deposit',
    Timestamp: '2026-09-10T12:00:00Z', Type: 'Chequing', Currency: 'CAD' };
const account = () => service.createInvestmentAccount('owner', { name: 'Cash', accountType: 'Chequing', currency: 'CAD', cashMinor: 0 });
const cash = async (id) => (await db.get('SELECT * FROM investment_accounts WHERE id = ?', [id])).cashMinor;

test('unsafe deletion and editing leave the transaction and balance intact', async () => {
    const a = await account();
    const deposit = await mutations.createTransaction('owner', { ...input, BalanceAccountId: a.id });
    await mutations.createTransaction('owner', { ...input, Amount: 80, Category: 'Expense', Label: 'Shopping', BalanceAccountId: a.id });
    assert.equal(await cash(a.id), 2000);
    await assert.rejects(service.deleteTransaction(deposit.data.id, 'owner'), (e) => e.statusCode === 409);
    await assert.rejects(mutations.updateTransaction('owner', deposit.data.id, { Amount: 10 }), (e) => e.statusCode === 409);
    assert.equal((await service.getTransactionById(deposit.data.id, 'owner')).AmountMinor, 10000);
    assert.equal(await cash(a.id), 2000);
    assert.equal((await db.get('SELECT deltaMinor FROM account_balance_events WHERE sourceTransactionId = ?', [deposit.data.id])).deltaMinor, 10000);
});

test('an edit retains the explicit account even when the transaction has no account reference', async () => {
    const a = await account();
    const deposit = await mutations.createTransaction('owner', { ...input, BalanceAccountId: a.id });
    await mutations.updateTransaction('owner', deposit.data.id, { Amount: 120 });
    assert.equal(await cash(a.id), 12000);
    assert.equal((await db.get('SELECT accountId FROM account_balance_events WHERE sourceTransactionId = ?', [deposit.data.id])).accountId, a.id);
});

test('bank snapshots absorb old postings and reporting edits or deletes preserve cash', async () => {
    const a = await account();
    const deposit = await mutations.createTransaction('owner', { ...input, BalanceAccountId: a.id });
    await setAccountBalanceSnapshot('owner', a.id, 1000, 'CAD');
    assert.equal((await mutations.updateTransaction('owner', deposit.data.id, { Amount: 120 })).accountPosting.status, 'snapshot_preserved');
    await service.deleteTransaction(deposit.data.id, 'owner');
    const fresh = await mutations.createTransaction('owner', { ...input, BalanceAccountId: a.id });
    await mutations.updateTransaction('owner', fresh.data.id, { Amount: 150 });
    await service.deleteTransaction(fresh.data.id, 'owner');
    assert.equal(await cash(a.id), 1000);
});

test('manual replacement absorbs old events but new events post to the new baseline', async () => {
    const a = await account();
    const old = await mutations.createTransaction('owner', { ...input, BalanceAccountId: a.id });
    await service.updateInvestmentAccount('owner', a.id, { cashMinor: 1000 });
    await service.deleteTransaction(old.data.id, 'owner');
    assert.equal(await cash(a.id), 1000);
    const fresh = await mutations.createTransaction('owner', { ...input, Amount: 5, BalanceAccountId: a.id });
    assert.equal(await cash(a.id), 1500);
    await service.deleteTransaction(fresh.data.id, 'owner');
    assert.equal(await cash(a.id), 1000);
});

test('unsupported provider balances and currency changes preserve native money for review', async () => {
    const a = await account();
    await setAccountBalanceSnapshot('owner', a.id, 2000, 'CAD');
    assert.equal((await setAccountBalanceSnapshot('owner', a.id, -100, 'CAD')).status, 'review_required');
    assert.equal((await setAccountBalanceSnapshot('owner', a.id, 2000, 'USD')).status, 'review_required');
    assert.equal(await cash(a.id), 2000);
    await assert.rejects(service.updateInvestmentAccount('owner', a.id, { currency: 'USD' }), (e) => e.statusCode === 409);
    await applyInvestmentSnapshot('owner', new Map([['native', { appAccountId: a.id, type: 'investment' }]]), {
        accounts: [{ account_id: 'native', balances: { current: 20, available: -5, iso_currency_code: 'CAD' } }], holdings: [], securities: [],
    });
    assert.equal(await cash(a.id), 2000);
    assert.match((await db.get('SELECT balanceReviewReason FROM investment_accounts WHERE id = ?', [a.id])).balanceReviewReason, /unsupported/);
});

test('unchanged account metadata edits preserve bank provenance', async () => {
    const a = await account();
    await setAccountBalanceSnapshot('owner', a.id, 2000, 'CAD');
    const changed = await service.updateInvestmentAccount('owner', a.id, { name: 'Renamed', cashMinor: 2000 });
    assert.equal(changed.balanceSource, 'plaid');
    assert.equal(changed.balanceRevision, 1);
});

test('linked portfolio activity cannot be orphaned by source editing or deletion', async () => {
    const a = await account();
    const transaction = await mutations.createTransaction('owner', { ...input, BalanceAccountId: a.id });
    await db.run(`INSERT INTO portfolio_transactions (userId, accountId, sourceTransactionId, kind, amountMinor, occurredAt)
        VALUES (?, ?, ?, ?, ?, ?)`, ['owner', a.id, transaction.data.id, 'EMAIL_DEPOSIT', 10000, input.Timestamp]);
    await assert.rejects(service.deleteTransaction(transaction.data.id, 'owner'), (e) => e.statusCode === 409);
    await assert.rejects(mutations.updateTransaction('owner', transaction.data.id, { Amount: 20 }), (e) => e.statusCode === 409);
    assert.equal(await cash(a.id), 10000);
    assert.ok(await service.getTransactionById(transaction.data.id, 'owner'));
    assert.ok(await db.get('SELECT id FROM portfolio_transactions WHERE sourceTransactionId = ?', [transaction.data.id]));
});
