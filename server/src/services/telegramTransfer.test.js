const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-telegram-transfer-'));
process.env.MONIMONITOR_DB_PATH = path.join(testDirectory, 'test.sqlite');
process.env.USER_ID = 'test-user-transfer';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_ID = '123456';

const dbService = require('../database/dbService');
const { formatTransactionMessage, transactionActionKeyboard } = require('./telegramService');
const { onTelegramUpdate } = require('../../email_agent');

test.after(async () => {
    const db = await dbService.getDb();
    await db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('formatTransactionMessage formats internal transfer cleanly', () => {
    const tx = {
        id: 1,
        Amount: 75.0,
        Category: 'Internal',
        Label: 'Internal Transfer',
        Reason: 'Internal transfer: RBC Chequing -> Temporary',
        Account: 'RBC Chequing',
        BankName: 'RBC',
        Timestamp: '2026-08-21T10:00:00Z'
    };
    const message = formatTransactionMessage(tx);
    assert.match(message, /Internal Transfer/);
    assert.match(message, /75/);
    assert.match(message, /RBC Chequing/);
});

test('transactionActionKeyboard preserves the familiar two-action layout', () => {
    const keyboard = transactionActionKeyboard({
        id: 42,
    });
    assert.equal(keyboard.inline_keyboard.length, 1);
    assert.equal(keyboard.inline_keyboard[0][0].callback_data, 'recat:42');
    assert.equal(keyboard.inline_keyboard[0][1].callback_data, 'transfer:42');
    assert.doesNotMatch(JSON.stringify(keyboard), /Open dashboard/);
});

test('handles Telegram transfer callback: sets Internal and Temporary route', async () => {
    const txId = await dbService.addTransaction({
        userId: 'test-user-transfer',
        Amount: 50.0,
        AmountMinor: 5000,
        Currency: 'CAD',
        Category: 'Expense',
        Label: 'Other Expense',
        Reason: 'Interac e-Transfer sent to Friend',
        Timestamp: '2026-08-21T10:00:00Z',
        ReceivedAt: '2026-08-21T10:00:00Z',
        Account: 'RBC Chequing',
        BankName: 'RBC',
        AccountFlow: 'OUT'
    });

    const update = {
        callback_query: {
            id: 'cq-1',
            data: `transfer:${txId}`,
            message: {
                message_id: 999,
                chat: { id: 123456 },
                text: 'Old message'
            }
        }
    };

    await onTelegramUpdate(update);

    const db = await dbService.getDb();
    const updated = await db.get('SELECT * FROM transactions WHERE id = ?', [txId]);
    assert.equal(updated.Category, 'Internal');
    assert.equal(updated.Label, 'Internal Transfer');
    assert.equal(updated.AccountFlow, 'OUT');
    assert.match(updated.Reason, /Internal transfer: RBC Chequing -> Temporary/);
});

test('pairs an outgoing Temporary transfer with an incoming deposit on different accounts', async () => {
    const tx1Id = await dbService.addTransaction({
        userId: 'test-user-transfer',
        Amount: 120.0,
        AmountMinor: 12000,
        Currency: 'CAD',
        Category: 'Internal',
        Label: 'Internal Transfer',
        Reason: 'Internal transfer: RBC Chequing -> Temporary',
        Timestamp: '2026-08-21T10:00:00Z',
        ReceivedAt: '2026-08-21T10:00:00Z',
        Account: 'RBC Chequing',
        BankName: 'RBC',
        AccountFlow: 'OUT'
    });

    const tx2Id = await dbService.addTransaction({
        userId: 'test-user-transfer',
        Amount: 120.0,
        AmountMinor: 12000,
        Currency: 'CAD',
        Category: 'Income',
        Label: 'Deposit',
        Reason: 'Deposit to Tangerine',
        Timestamp: '2026-08-22T11:00:00Z',
        ReceivedAt: '2026-08-22T11:00:00Z',
        Account: 'Tangerine Savings',
        BankName: 'Tangerine',
        AccountFlow: 'IN'
    });

    const reclassified = await dbService.detectAndReclassifyInternalCounterparts('test-user-transfer', tx2Id);
    assert.equal(reclassified.length, 2);

    const db = await dbService.getDb();
    const leg1 = await db.get('SELECT * FROM transactions WHERE id = ?', [tx1Id]);
    const leg2 = await db.get('SELECT * FROM transactions WHERE id = ?', [tx2Id]);

    assert.equal(leg1.Category, 'Internal');
    assert.equal(leg2.Category, 'Internal');
    assert.equal(leg1.Label, 'Internal Transfer');
    assert.equal(leg2.Label, 'Internal Transfer');
    assert.match(leg1.Reason, /Internal transfer: RBC Chequing -> Tangerine Savings/);
    assert.match(leg2.Reason, /Internal transfer: RBC Chequing -> Tangerine Savings/);
    assert.ok(leg1.ReferenceNumber.startsWith('XFER-'));
    assert.equal(leg1.ReferenceNumber, leg2.ReferenceNumber);
});

test('pairs an outgoing Temporary transfer with money transferred back into the SAME account', async () => {
    const tx1Id = await dbService.addTransaction({
        userId: 'test-user-transfer',
        Amount: 200.0,
        AmountMinor: 20000,
        Currency: 'CAD',
        Category: 'Internal',
        Label: 'Internal Transfer',
        Reason: 'Internal transfer: RBC Chequing -> Temporary',
        Timestamp: '2026-08-21T10:00:00Z',
        ReceivedAt: '2026-08-21T10:00:00Z',
        Account: 'RBC Chequing',
        BankName: 'RBC',
        AccountFlow: 'OUT'
    });

    const tx2Id = await dbService.addTransaction({
        userId: 'test-user-transfer',
        Amount: 200.0,
        AmountMinor: 20000,
        Currency: 'CAD',
        Category: 'Income',
        Label: 'Deposit',
        Reason: 'Deposit into RBC Chequing',
        Timestamp: '2026-08-23T15:00:00Z',
        ReceivedAt: '2026-08-23T15:00:00Z',
        Account: 'RBC Chequing',
        BankName: 'RBC',
        AccountFlow: 'IN'
    });

    const reclassified = await dbService.detectAndReclassifyInternalCounterparts('test-user-transfer', tx2Id);
    assert.equal(reclassified.length, 2);

    const db = await dbService.getDb();
    const leg1 = await db.get('SELECT * FROM transactions WHERE id = ?', [tx1Id]);
    const leg2 = await db.get('SELECT * FROM transactions WHERE id = ?', [tx2Id]);

    assert.equal(leg1.Category, 'Internal');
    assert.equal(leg2.Category, 'Internal');
    assert.match(leg1.Reason, /Internal transfer: RBC Chequing -> Temporary -> RBC Chequing/);
    assert.match(leg2.Reason, /Internal transfer: RBC Chequing -> Temporary -> RBC Chequing/);
    assert.ok(leg1.ReferenceNumber.startsWith('XFER-'));
    assert.equal(leg1.ReferenceNumber, leg2.ReferenceNumber);
});
