const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-atomic-mutations-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
const dbService = require('../database/dbService');
const mutations = require('./transactionMutations');
let db;
let account;
const input = { Amount: 25, Category: 'Expense', Label: 'Shopping', Reason: 'Example store',
    Timestamp: '2026-09-10T12:00:00.000Z', Type: 'Chequing', Account: 'test-1234', BankName: 'Example' };
test.before(async () => {
    db = await dbService.getDb();
    await dbService.createUser('owner', 'mutation-owner', 'unused');
    account = await dbService.createInvestmentAccount('owner', {
        name: 'Example chequing', institution: 'Example', accountType: 'Chequing', currency: 'CAD', cashMinor: 10000,
    });
});
test.after(async () => { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

async function failStatement(pattern, action) {
    const original = db.run;
    db.run = (...args) => pattern.test(String(args[0])) ? Promise.reject(new Error('injected failure')) : original(...args);
    try { await assert.rejects(action(), /injected failure/); }
    finally { db.run = original; }
}

test('failure during posting rolls back the transaction, balance and monthly summary', async () => {
    await failStatement(/INSERT INTO account_balance_events/, () => mutations.createTransaction('owner', { ...input, BalanceAccountId: account.id }));
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 0);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 10000);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM monthly_transaction_summaries')).count, 0);
});

test('concurrent retries with the same key create and post exactly once', async () => {
    const request = { ...input, BalanceAccountId: account.id };
    const results = await Promise.all([
        mutations.createTransaction('owner', request, 'request-key-123'),
        mutations.createTransaction('owner', request, 'request-key-123'),
    ]);
    assert.deepEqual(results[0], results[1]);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 1);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 7500);
    await assert.rejects(mutations.createTransaction('owner', { ...request, Amount: 30 }, 'request-key-123'), (error) => error.statusCode === 409);
});

test('editing failure rolls back changes to amount and account balance', async () => {
    const transaction = await db.get('SELECT id FROM transactions');
    await failStatement(/UPDATE account_balance_events/, () => mutations.updateTransaction('owner', transaction.id, { Amount: 30, BalanceAccountId: account.id }));
    assert.equal((await db.get('SELECT AmountMinor FROM transactions WHERE id = ?', [transaction.id])).AmountMinor, 2500);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 7500);
});

test('deletion failure rolls back the preceding balance reversal', async () => {
    const transaction = await db.get('SELECT id FROM transactions');
    await failStatement(/DELETE FROM transactions WHERE/, () => dbService.deleteTransaction(transaction.id, 'owner'));
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM account_balance_events')).count, 1);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 7500);
    assert.equal(await dbService.deleteTransaction(transaction.id, 'owner'), true);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 10000);
});

test('invalid explicit account is rejected without creating a record', async () => {
    await assert.rejects(mutations.createTransaction('owner', { ...input, BalanceAccountId: 999999 }), /Invalid balance account/);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 0);
});
