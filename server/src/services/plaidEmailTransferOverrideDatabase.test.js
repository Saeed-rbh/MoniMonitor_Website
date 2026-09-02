const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-email-transfer-'));
process.env.MONIMONITOR_DB_PATH = path.join(testDirectory, 'test.sqlite');

const dbService = require('../database/dbService');
const { applyRecentUnconfirmedEmailTransferOverrides } = require('./plaidService');

test.after(async () => {
    const db = await dbService.getDb();
    await db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('temporarily reflects an email-confirmed internal transfer until Plaid links it', async () => {
    const db = await dbService.getDb();
    const userId = 'email-transfer-user';
    const now = new Date().toISOString();
    await db.run('INSERT INTO users (id, username, password, createdAt) VALUES (?, ?, ?, ?)', [
        userId, 'email-transfer-user', 'not-used', now,
    ]);
    const source = await db.run(
        `INSERT INTO investment_accounts
            (userId, name, institution, accountType, accountRef, currency, cashMinor, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, 'Future', 'Wealthsimple', 'Savings', '1234', 'CAD', 4289, now, now]
    );
    const destination = await db.run(
        `INSERT INTO investment_accounts
            (userId, name, institution, accountType, accountRef, currency, cashMinor, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, 'TFSA', 'Wealthsimple', 'TFSA', 'S0K7', 'CAD', 10000, now, now]
    );
    const transactionId = await dbService.addTransaction({
        userId,
        Amount: 42.89,
        Category: 'Internal',
        Label: 'Internal Transfer',
        Reason: 'Transfer from Future to TFSA',
        Timestamp: now,
        ReceivedAt: now,
        PortfolioAction: 'TRANSFER',
        PortfolioAccountId: destination.lastID,
        PortfolioConfidence: 'HIGH',
        BalanceAccountId: source.lastID,
        BalanceAccountConfidence: 'HIGH',
        AccountFlow: 'OUT',
        SourceEmailKey: 'owner@example.com:INBOX:1:1',
    });
    await dbService.upsertTransactionSource({
        userId,
        provider: 'email',
        externalId: 'owner@example.com:INBOX:1:1',
        transactionId,
        ownsTransaction: true,
    });

    assert.equal(await applyRecentUnconfirmedEmailTransferOverrides(userId), 1);
    const balances = await db.all(
        'SELECT id, cashMinor FROM investment_accounts WHERE userId = ? ORDER BY id',
        [userId]
    );
    assert.deepEqual(balances, [
        { id: source.lastID, cashMinor: 0 },
        { id: destination.lastID, cashMinor: 14289 },
    ]);

    await dbService.upsertTransactionSource({
        userId,
        provider: 'plaid',
        externalId: 'plaid-transfer-1',
        transactionId,
        ownsTransaction: false,
    });
    assert.equal(await applyRecentUnconfirmedEmailTransferOverrides(userId), 0);
});
