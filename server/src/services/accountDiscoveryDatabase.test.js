const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-account-discovery-'));
process.env.MONIMONITOR_DB_PATH = path.join(testDirectory, 'test.sqlite');
process.env.USER_ID = '';

const dbService = require('../database/dbService');

test.after(async () => {
    const db = await dbService.getDb();
    await db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('creates one account from a transaction and posts subsequent activity to it', async () => {
    const userId = 'automatic-account-test-user';
    const db = await dbService.getDb();
    await db.run(
        'INSERT INTO users (id, username, password, createdAt) VALUES (?, ?, ?, ?)',
        [userId, 'automatic-account-test', 'not-used', new Date().toISOString()]
    );
    await dbService.saveUserSettings(userId, {
        currency: 'CAD', timezone: 'America/Toronto', notificationsEnabled: true,
    });

    const transaction = {
        Amount: 12.50,
        AmountMinor: 1250,
        Category: 'Expense',
        Label: 'Shopping',
        Reason: 'Example Store',
        Timestamp: '2026-08-13T12:00:00.000Z',
        Type: 'Visa Credit Card',
        Account: '**** **** **** 7788',
        BankName: 'RBC Royal Bank',
        AccountFlow: 'OUT',
    };

    const firstResolution = await dbService.ensureTransactionAccount(userId, transaction);
    const secondResolution = await dbService.ensureTransactionAccount(userId, transaction);
    assert.equal(firstResolution.status, 'created');
    assert.equal(firstResolution.account.name, 'RBC Credit Card •7788');
    assert.equal(firstResolution.account.currency, 'CAD');
    assert.equal(secondResolution.account.id, firstResolution.account.id);
    assert.equal((await dbService.getInvestmentAccounts(userId)).length, 1);

    const transactionId = await dbService.addTransaction({ ...transaction, userId });
    const posting = await dbService.syncTransactionAccountBalance(userId, transactionId, {
        accountId: firstResolution.account.id,
        confidence: 'HIGH',
    });
    assert.equal(posting.status, 'applied');
    assert.equal(posting.cashMinor, 1250);

    // A Plaid refresh can replace cashMinor while the event remains recorded.
    // Re-syncing the transaction must reverse that stale event without hitting
    // the investment_accounts.cashMinor >= 0 constraint.
    await db.run('UPDATE investment_accounts SET cashMinor = 0 WHERE id = ?', [firstResolution.account.id]);
    const resynced = await dbService.syncTransactionAccountBalance(userId, transactionId, {
        accountId: firstResolution.account.id,
        confidence: 'HIGH',
    });
    assert.equal(resynced.status, 'applied');
    assert.equal(resynced.cashMinor, 1250);
});
