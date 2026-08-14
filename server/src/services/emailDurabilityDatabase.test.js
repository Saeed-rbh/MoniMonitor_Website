const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-email-durability-'));
process.env.MONIMONITOR_DB_PATH = path.join(testDirectory, 'test.sqlite');
process.env.USER_ID = '';

const dbService = require('../database/dbService');

test.after(async () => {
    const db = await dbService.getDb();
    await db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('persists discovered and failed email UIDs across sync cycles', async () => {
    const mailboxKey = 'owner@example.com:INBOX';
    const uidValidity = '12345';
    const initial = await dbService.prepareEmailSync(mailboxKey, uidValidity);
    assert.equal(initial.initialSync, true);
    assert.equal(initial.lastDiscoveredUid, 0);

    await dbService.enqueueDiscoveredEmails(mailboxKey, uidValidity, [101, 102]);
    await dbService.markEmailFailed(101, mailboxKey, uidValidity, 'Temporary AI outage');
    await dbService.markEmailProcessed(102, mailboxKey, uidValidity);

    const resumed = await dbService.prepareEmailSync(mailboxKey, uidValidity);
    const pending = await dbService.getPendingEmails(mailboxKey, uidValidity);
    assert.equal(resumed.initialSync, false);
    assert.equal(resumed.lastDiscoveredUid, 102);
    assert.deepEqual(pending.map((item) => item.uid), [101]);
    assert.equal(pending[0].attempts, 1);
    assert.equal(await dbService.isEmailProcessed(102, mailboxKey, uidValidity), true);
});

test('resets the discovery cursor safely when IMAP UIDVALIDITY changes', async () => {
    const state = await dbService.prepareEmailSync('owner@example.com:INBOX', 'new-generation');
    assert.equal(state.initialSync, true);
    assert.equal(state.lastDiscoveredUid, 0);
    assert.equal(state.adoptLegacyProcessed, false);
});

test('adopts legacy processed UIDs only during the first durable mailbox migration', async () => {
    const mailboxKey = 'legacy-owner@example.com:INBOX';
    const uidValidity = 'legacy-generation';
    await dbService.markEmailProcessed(700);

    const initial = await dbService.prepareEmailSync(mailboxKey, uidValidity);
    assert.equal(initial.adoptLegacyProcessed, true);
    await dbService.enqueueDiscoveredEmails(mailboxKey, uidValidity, [700, 701], {
        adoptLegacyProcessed: initial.adoptLegacyProcessed,
    });

    const pending = await dbService.getPendingEmails(mailboxKey, uidValidity);
    assert.deepEqual(pending.map((item) => item.uid), [701]);
    assert.equal(await dbService.isEmailProcessed(700, mailboxKey, uidValidity), true);
});

test('prevents a crash retry from inserting the same source email twice', async () => {
    const db = await dbService.getDb();
    const userId = 'email-idempotency-user';
    await db.run(
        'INSERT INTO users (id, username, password, createdAt) VALUES (?, ?, ?, ?)',
        [userId, 'email-idempotency', 'not-used', new Date().toISOString()]
    );
    const transaction = {
        userId,
        Amount: 12.34,
        Category: 'Expense',
        Label: 'Dining',
        Reason: 'Example Cafe',
        Timestamp: '2026-08-13T12:00:00.000Z',
        Type: 'Credit Card',
        Account: '****1234',
        BankName: 'Example Bank',
        SourceEmailKey: 'owner@example.com:INBOX:123:900',
    };

    const id = await dbService.addTransaction(transaction);
    assert.equal((await dbService.getTransactionBySourceEmailKey(userId, transaction.SourceEmailKey)).id, id);
    await assert.rejects(() => dbService.addTransaction(transaction), /UNIQUE constraint failed/);
});
