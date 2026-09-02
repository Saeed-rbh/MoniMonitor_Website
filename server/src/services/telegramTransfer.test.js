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
process.env.TELEGRAM_DISABLE_NETWORK = 'true';

const dbService = require('../database/dbService');
const { formatTransactionMessage, transactionActionKeyboard } = require('./telegramService');
const { onTelegramUpdate, resolveEmailTimestamp, isAuthorizedTelegramUpdate } = require('../../email_agent');

test.before(async () => {
    await dbService.createUser(process.env.USER_ID, 'telegram-transfer-owner', 'test-password-hash');
});

test('uses the email received time when the parser returns a date-only timestamp', () => {
    assert.equal(
        resolveEmailTimestamp('2026-09-02T00:00:00.000Z', '2026-09-02T17:36:41.000Z'),
        '2026-09-02T17:36:41.000Z'
    );
    assert.equal(
        resolveEmailTimestamp('2026-09-02T15:30:00.000Z', '2026-09-02T17:36:41.000Z'),
        '2026-09-02T15:30:00.000Z'
    );
});

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

test('authorizes Telegram chat and sender together, with sender-only inline fallback', () => {
    assert.equal(isAuthorizedTelegramUpdate({ message: { chat: { id: 123456 }, from: { id: 123456 } } }), true);
    assert.equal(isAuthorizedTelegramUpdate({ message: { chat: { id: 123456 }, from: { id: 7 } } }), false);
    assert.equal(isAuthorizedTelegramUpdate({ message: { chat: { id: 7 }, from: { id: 123456 } } }), false);
    assert.equal(isAuthorizedTelegramUpdate({ inline_query: { from: { id: 123456 } } }), true);
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
            from: { id: 123456 },
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

test('pairs a near-simultaneous outgoing e-transfer with its credit-card payment email', async () => {
    const outgoingId = await dbService.addTransaction({
        userId: 'test-user-transfer', Amount: 449.17, AmountMinor: 44917, Currency: 'CAD',
        Category: 'Expense', Label: 'Other Expense',
        Reason: 'E-Transfer sent from RBC Royal Bank e-Transfer ••••6554',
        Type: 'e-Transfer', BankName: 'RBC Royal Bank', Account: '********6554',
        AccountFlow: 'OUT', Timestamp: '2026-08-26T00:00:00.000Z',
        ReceivedAt: '2026-08-27T11:45:27.000Z', SourceEmailKey: 'mailbox:589',
    });
    const cardId = await dbService.addTransaction({
        userId: 'test-user-transfer', Amount: 449.17, AmountMinor: 44917, Currency: 'CAD',
        Category: 'Internal', Label: 'Internal Transfer', Reason: 'Credit Card Payment',
        Type: 'Credit Card', BankName: 'RBC Royal Bank', Account: '************2379',
        // Deliberately far from the other provider timestamp: receipt time is
        // the reliable evidence for these adjacent notification emails.
        AccountFlow: 'OUT', Timestamp: '2026-08-27T20:00:00.000Z',
        ReceivedAt: '2026-08-27T11:45:33.000Z', SourceEmailKey: 'mailbox:590',
    });

    const changes = await dbService.detectAndReclassifyInternalCounterparts('test-user-transfer', cardId);
    assert.deepEqual(new Set(changes.map(change => change.id)), new Set([outgoingId, cardId]));

    const db = await dbService.getDb();
    const outgoing = await db.get('SELECT * FROM transactions WHERE id = ?', [outgoingId]);
    const card = await db.get('SELECT * FROM transactions WHERE id = ?', [cardId]);
    assert.equal(outgoing.Category, 'Internal');
    assert.equal(outgoing.AccountFlow, 'OUT');
    assert.equal(card.Category, 'Internal');
    assert.equal(card.AccountFlow, 'IN');
    assert.equal(outgoing.ReferenceNumber, card.ReferenceNumber);
    assert.match(outgoing.ReferenceNumber, /^XFER-CARD-/);
});

test('pairs a near-simultaneous chequing withdrawal with a payment-made card email', async () => {
    const withdrawalId = await dbService.addTransaction({
        userId: 'test-user-transfer', Amount: 306.05, AmountMinor: 30605, Currency: 'CAD',
        Category: 'Expense', Label: 'Other Expense',
        Reason: 'Withdrawal from RBC Royal Bank Checking Account ••••6554',
        Type: 'Checking Account', BankName: 'RBC Royal Bank', Account: '********6554',
        AccountFlow: 'OUT', Timestamp: '2026-09-02T00:00:00.000Z',
        ReceivedAt: '2026-09-02T17:36:33.000Z', SourceEmailKey: 'mailbox:631',
    });
    const paymentId = await dbService.addTransaction({
        userId: 'test-user-transfer', Amount: 306.05, AmountMinor: 30605, Currency: 'CAD',
        Category: 'Internal', Label: 'Internal Transfer', Reason: 'Payment Made',
        Type: 'Credit Card', BankName: 'RBC Royal Bank', Account: '************2379',
        AccountFlow: 'NONE', Timestamp: '2026-09-02T00:00:00.000Z',
        ReceivedAt: '2026-09-02T17:36:41.000Z', SourceEmailKey: 'mailbox:632',
    });

    const changes = await dbService.detectAndReclassifyInternalCounterparts('test-user-transfer', paymentId);
    assert.deepEqual(new Set(changes.map(change => change.id)), new Set([withdrawalId, paymentId]));

    const db = await dbService.getDb();
    const withdrawal = await db.get('SELECT * FROM transactions WHERE id = ?', [withdrawalId]);
    const payment = await db.get('SELECT * FROM transactions WHERE id = ?', [paymentId]);
    assert.equal(withdrawal.Category, 'Internal');
    assert.equal(withdrawal.AccountFlow, 'OUT');
    assert.equal(payment.Category, 'Internal');
    assert.equal(payment.AccountFlow, 'IN');
    assert.match(withdrawal.ReferenceNumber, /^XFER-CARD-/);
    assert.equal(withdrawal.ReferenceNumber, payment.ReferenceNumber);
});

test('does not pair same-amount card activity without all conservative evidence', async () => {
    const base = {
        userId: 'test-user-transfer', Amount: 88.88, AmountMinor: 8888, Currency: 'CAD',
        Timestamp: '2026-08-27T00:00:00.000Z', ReceivedAt: '2026-08-27T12:00:00.000Z',
    };
    const transferId = await dbService.addTransaction({
        ...base, Category: 'Expense', Label: 'Other Expense',
        Reason: 'E-Transfer sent from RBC account', Type: 'e-Transfer',
        BankName: 'RBC', Account: '1111', AccountFlow: 'OUT',
    });
    const unrelatedCardId = await dbService.addTransaction({
        ...base, Category: 'Expense', Label: 'Shopping', Reason: 'Retail purchase',
        Type: 'Credit Card', BankName: 'RBC', Account: '2222', AccountFlow: 'OUT',
        ReceivedAt: '2026-08-27T12:00:05.000Z',
    });

    const changes = await dbService.detectAndReclassifyInternalCounterparts(
        'test-user-transfer', unrelatedCardId
    );
    assert.equal(changes.length, 0);
    assert.equal((await dbService.getTransactionById(transferId, 'test-user-transfer')).Category, 'Expense');
    assert.equal((await dbService.getTransactionById(unrelatedCardId, 'test-user-transfer')).Category, 'Expense');
});

test('does not pair credit-card payment emails across banks', async () => {
    const base = {
        userId: 'test-user-transfer', Amount: 77.77, AmountMinor: 7777, Currency: 'CAD',
        Timestamp: '2026-08-28T00:00:00.000Z',
    };
    await dbService.addTransaction({
        ...base, Category: 'Expense', Label: 'Other Expense',
        Reason: 'E-Transfer sent from RBC account', Type: 'e-Transfer',
        BankName: 'RBC', Account: '3333', AccountFlow: 'OUT',
        ReceivedAt: '2026-08-28T12:00:00.000Z',
    });
    const otherBankCardId = await dbService.addTransaction({
        ...base, Category: 'Internal', Label: 'Internal Transfer', Reason: 'Credit Card Payment',
        Type: 'Credit Card', BankName: 'TD', Account: '4444', AccountFlow: 'OUT',
        ReceivedAt: '2026-08-28T12:00:05.000Z',
    });
    const changes = await dbService.detectAndReclassifyInternalCounterparts(
        'test-user-transfer', otherBankCardId
    );
    assert.equal(changes.length, 0);
});
