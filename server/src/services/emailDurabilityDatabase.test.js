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
    await dbService.upsertTransactionSource({
        userId,
        provider: 'email',
        externalId: transaction.SourceEmailKey,
        transactionId: id,
        ownsTransaction: true,
        rawPayload: { rawBody: 'Subject: Example Cafe\n\nPaid $12.34', parsed: transaction },
        contextPayload: { mailboxKey: 'owner@example.com:INBOX' },
    });
    const sources = await dbService.getTransactionSourcesForUser(id, userId);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].provider, 'email');
    assert.equal(sources[0].rawPayload.rawBody, 'Subject: Example Cafe\n\nPaid $12.34');
    assert.equal(sources[0].contextPayload.mailboxKey, 'owner@example.com:INBOX');
    await assert.rejects(() => dbService.addTransaction(transaction), /UNIQUE constraint failed/);
});

test('leases email work, uses retry backoff, and eventually dead-letters repeated failures', async () => {
    const mailboxKey = 'lease@example.com:INBOX';
    const uidValidity = 'lease-generation';
    await dbService.prepareEmailSync(mailboxKey, uidValidity);
    await dbService.enqueueDiscoveredEmails(mailboxKey, uidValidity, [800]);

    let now = new Date(Date.now() + 60 * 1000);
    let jobs = await dbService.claimPendingEmails(mailboxKey, uidValidity, 'worker-a', 1, now);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].attempts, 1);
    let outcome = await dbService.failEmailQueueItem(800, mailboxKey, uidValidity, 'worker-a', 'temporary outage', now);
    assert.equal(outcome.status, 'retry');
    assert.ok(outcome.nextAttemptAt > now.toISOString());

    for (let attempt = 2; attempt <= 8; attempt += 1) {
        now = new Date(now.getTime() + 2 * 60 * 60 * 1000);
        jobs = await dbService.claimPendingEmails(mailboxKey, uidValidity, 'worker-a', 1, now);
        assert.equal(jobs.length, 1);
        outcome = await dbService.failEmailQueueItem(800, mailboxKey, uidValidity, 'worker-a', 'still unavailable', now);
    }
    assert.equal(outcome.status, 'dead');
    const db = await dbService.getDb();
    const queueItem = await db.get('SELECT status, attempts, leaseOwner FROM email_ingestion_queue WHERE uid = ?', [800]);
    assert.deepEqual(queueItem, { status: 'dead', attempts: 8, leaseOwner: null });
});

test('leases Telegram notifications and records delivery atomically with the transaction message id', async () => {
    const db = await dbService.getDb();
    const userId = 'telegram-outbox-user';
    await db.run('INSERT INTO users (id, username, password, createdAt) VALUES (?, ?, ?, ?)', [
        userId, 'telegram-outbox', 'not-used', new Date().toISOString(),
    ]);
    const transactionId = await dbService.addTransaction({
        userId, Amount: 1, Category: 'Expense', Label: 'Test', Reason: 'Outbox test',
        Timestamp: new Date().toISOString(),
    });
    const outboxId = await dbService.enqueueTelegramOutbox('sendMessage', { text: 'queued' }, { transactionId });
    const jobs = await dbService.claimTelegramOutbox('telegram-worker');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, outboxId);
    assert.equal(await dbService.completeTelegramOutbox(outboxId, 'telegram-worker', 555), true);
    const result = await db.get('SELECT status FROM telegram_outbox WHERE id = ?', [outboxId]);
    const transaction = await db.get('SELECT TelegramMessageId FROM transactions WHERE id = ?', [transactionId]);
    assert.equal(result.status, 'processed');
    assert.equal(transaction.TelegramMessageId, 555);
});

test('commits new email transaction, source, balance event, and outbox intent together', async () => {
    const userId = 'atomic-email-user';
    const db = await dbService.getDb();
    await db.run('INSERT INTO users (id, username, password, createdAt) VALUES (?, ?, ?, ?)', [
        userId, 'atomic-email', 'not-used', new Date().toISOString(),
    ]);
    const account = await dbService.createInvestmentAccount(userId, {
        name: 'Atomic Chequing', institution: 'Example', accountType: 'Chequing',
        accountRef: '1234', currency: 'CAD', cashMinor: 1_000,
    });
    const transactionId = await dbService.commitEmailTransaction({
        transaction: {
            userId, Amount: 25, AmountMinor: 2_500, Category: 'Income', Label: 'Deposit',
            Reason: 'Atomic deposit', Timestamp: '2026-09-02T12:00:00.000Z', ReceivedAt: '2026-09-02T12:00:00.000Z',
            AccountFlow: 'IN', BalanceAccountId: account.id,
        },
        balance: { accountId: account.id },
        source: { externalId: 'atomic@example.com:1:1', rawPayload: { rawBody: 'deposit' } },
        outbox: { action: 'sendMessage', payload: { text: 'deposit alert' } },
    });
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 3_500);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transaction_sources WHERE transactionId = ?', [transactionId])).count, 1);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM account_balance_events WHERE sourceTransactionId = ?', [transactionId])).count, 1);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM telegram_outbox WHERE transactionId = ?', [transactionId])).count, 1);
});
