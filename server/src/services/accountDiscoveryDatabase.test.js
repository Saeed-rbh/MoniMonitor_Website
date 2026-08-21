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

    // An authoritative balance refresh can replace cashMinor while the event
    // remains recorded. Re-syncing an unchanged event must not apply it again.
    await db.run('UPDATE investment_accounts SET cashMinor = 0 WHERE id = ?', [firstResolution.account.id]);
    const resynced = await dbService.syncTransactionAccountBalance(userId, transactionId, {
        accountId: firstResolution.account.id,
        confidence: 'HIGH',
    });
    assert.equal(resynced.status, 'applied');
    assert.equal(resynced.cashMinor, 0);
    assert.equal(resynced.unchanged, true);
    assert.equal(
        (await db.get('SELECT COUNT(*) AS count FROM account_balance_events WHERE sourceTransactionId = ?', [transactionId])).count,
        1
    );
});

test('re-syncing large chequing transfers does not discard the prior balance', async () => {
    const userId = 'chequing-resync-test-user';
    const db = await dbService.getDb();
    await db.run(
        'INSERT INTO users (id, username, password, createdAt) VALUES (?, ?, ?, ?)',
        [userId, 'chequing-resync-test', 'not-used', new Date().toISOString()]
    );
    const account = await dbService.createInvestmentAccount(userId, {
        name: 'RBC Chequing', institution: 'RBC', accountType: 'Chequing',
        accountRef: '6554', currency: 'CAD', cashMinor: 73467,
    });

    const incomingId = await dbService.addTransaction({
        userId, Amount: 2000, AmountMinor: 200000, Category: 'Income', Label: 'Deposit',
        Reason: 'Deposit', Timestamp: '2026-08-21T12:00:00.000Z', Account: '6554',
        BankName: 'RBC', AccountFlow: 'IN',
    });
    await dbService.syncTransactionAccountBalance(userId, incomingId, {
        accountId: account.id, confidence: 'HIGH',
    });
    const outgoingId = await dbService.addTransaction({
        userId, Amount: 2001, AmountMinor: 200100, Category: 'Expense', Label: 'Withdrawal',
        Reason: 'Withdrawal', Timestamp: '2026-08-21T12:01:00.000Z', Account: '6554',
        BankName: 'RBC', AccountFlow: 'OUT',
    });
    await dbService.syncTransactionAccountBalance(userId, outgoingId, {
        accountId: account.id, confidence: 'HIGH',
    });

    for (const transactionId of [outgoingId, incomingId]) {
        const result = await dbService.syncTransactionAccountBalance(userId, transactionId, {
            accountId: account.id, confidence: 'HIGH',
        });
        assert.equal(result.unchanged, true);
    }

    const finalAccount = await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id]);
    assert.equal(finalAccount.cashMinor, 73367);
});
