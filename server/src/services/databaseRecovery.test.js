const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-recovery-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
process.env.MONIMONITOR_BACKUP_DIR = path.join(directory, 'backups');
process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const service = require('../database/dbService');
const { createBackup, restoreBackup, runRestoreDrill } = require('./backupService');
const { resumeWorkers } = require('./workerLifecycle');
let db, backup, transactionId;
test.before(async () => {
    db = await service.getDb();
    await service.createUser('recovery-owner', 'recovery-owner', 'unused');
    await service.createInvestmentAccount('recovery-owner', { name: 'Margin', accountType: 'TFSA', currency: 'CAD', cashMinor: -5000 });
    transactionId = await service.addTransaction({ userId: 'recovery-owner', AmountMinor: 1234, Currency: 'CAD',
        Category: 'Expense', Label: 'Groceries', Timestamp: '2026-08-10T10:00:00Z', SourceEmailKey: 'mail:1:11' });
    await service.upsertTransactionSource({ userId: 'recovery-owner', provider: 'email', externalId: 'mail:1:11', transactionId, ownsTransaction: true });
    await service.prepareEmailSync('mail', '1');
    await service.enqueueDiscoveredEmails('mail', '1', [11, 12]);
    await service.claimPendingEmails('mail', '1', 'old-worker');
    await service.completeEmailQueueItem(11, 'mail', '1', 'old-worker');
    backup = await createBackup('manual');
});
test.after(async () => { await resumeWorkers(); await db?.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('restore rebuilds reports, invalidates derived caches, and restores cursor and source identities', async () => {
    await service.addTransaction({ userId: 'recovery-owner', AmountMinor: 9000, Currency: 'CAD', Category: 'Income', Label: 'Salary', Timestamp: '2026-09-01T10:00:00Z' });
    await db.run("INSERT INTO monthly_ai_briefs (userId, month, briefJson, createdAt) VALUES ('recovery-owner', '2026-09', '{}', CURRENT_TIMESTAMP)");
    const version = await db.get('SELECT MAX(version) AS version FROM schema_migrations');
    await db.run("INSERT INTO ai_usage_daily VALUES ('2026-09-30', 7, 1000)");
    await restoreBackup(backup.fileName, 'recovery-owner');
    const report = await service.getSummaryForUser('recovery-owner');
    assert.equal(report.totalExpenses, 12.34); assert.equal(report.totalIncome, 0);
    assert.deepEqual(report.byMonth.map(row => row.month), ['2026-08']);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM monthly_ai_briefs')).count, 0);
    assert.deepEqual(await db.get('SELECT MAX(version) AS version FROM schema_migrations'), version);
    assert.deepEqual(await db.get('SELECT requests, inputBytes FROM ai_usage_daily'), { requests: 7, inputBytes: 1000 });
    assert.equal((await service.getInvestmentAccounts('recovery-owner'))[0].cashMinor, -5000);
    await resumeWorkers();
    await service.enqueueDiscoveredEmails('mail', '1', [11, 12]);
    const pending = await service.claimPendingEmails('mail', '1', 'new-worker');
    assert.deepEqual(pending.map(row => row.uid), [12]);
    await assert.rejects(service.addTransaction({ userId: 'recovery-owner', AmountMinor: 1234, Category: 'Expense',
        Label: 'Groceries', Timestamp: '2026-08-10T10:00:00Z', SourceEmailKey: 'mail:1:11' }), /UNIQUE/);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 1);
});

test('the isolated restore drill exercises recovered accounts and application reports', async () => {
    const result = await runRestoreDrill();
    assert.equal(result.verified, true);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 1);
});

test('restore clears newly introduced tables missing from an older recovery point', async () => {
    await db.exec('CREATE TABLE future_records (id INTEGER PRIMARY KEY, userId TEXT REFERENCES users(id), value TEXT)');
    await db.run("INSERT INTO future_records VALUES (1, 'recovery-owner', 'must not survive restore')");
    try {
        await restoreBackup(backup.fileName, 'recovery-owner');
        assert.equal((await db.get('SELECT COUNT(*) AS count FROM future_records')).count, 0);
    } finally { await resumeWorkers(); await db.exec('DROP TABLE future_records'); }
});
