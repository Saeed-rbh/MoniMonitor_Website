const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseSnapshot, importSnapshot } = require('./financialSnapshotImport');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-startup-safety-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
process.env.USER_ID = 'startup-owner';
process.env.BACKUP_OWNER_USER_ID = 'startup-owner';
const modulePath = require.resolve('../database/db');
let db;
test.after(async () => {
    await db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
});

const snapshot = {
    id: 'test-import', capturedAt: '2026-09-01T12:00:00.000Z',
    accounts: [{ name: 'Example savings', institution: 'Example bank', accountType: 'Savings',
        accountRef: 'example-1234', currency: 'CAD', cashMinor: 12500 }],
    holdings: [],
};

test('restart preserves existing financial history without a legacy snapshot marker', async () => {
    db = await require('../database/db').getDb();
    await db.run("INSERT INTO users (id, username, password) VALUES ('startup-owner', 'startup-owner', 'unused')");
    await db.run(`INSERT INTO transactions (userId, Amount, AmountMinor, Currency, Category, Timestamp)
        VALUES ('startup-owner', 12.50, 1250, 'CAD', 'Expense', '2026-09-12T12:00:00.000Z')`);
    await db.close();
    db = null;
    delete require.cache[modulePath];
    db = await require('../database/db').getDb();
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM transactions WHERE userId = 'startup-owner'")).count, 1);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM investment_accounts WHERE userId = 'startup-owner'")).count, 0);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM agent_audit_log WHERE action = 'financial_snapshot_reset'")).count, 0);
});

test('explicit snapshot import refuses to replace existing history', async () => {
    let backupCalled = false;
    await assert.rejects(importSnapshot(db, 'startup-owner', snapshot, async () => {
        backupCalled = true;
        return { fileName: 'safety' };
    }), /empty financial account/);
    assert.equal(backupCalled, false);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM transactions WHERE userId = 'startup-owner'")).count, 1);
});

test('explicit import requires a successful backup and imports only the selected empty user', async () => {
    await db.run("INSERT INTO users (id, username, password) VALUES ('empty-owner', 'empty-owner', 'unused')");
    await assert.rejects(importSnapshot(db, 'empty-owner', snapshot, async () => { throw new Error('backup failed'); }), /backup failed/);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM accounts WHERE userId = 'empty-owner'")).count, 0);
    const result = await importSnapshot(db, 'empty-owner', snapshot, async () => ({ fileName: 'verified-safety-backup' }));
    assert.equal(result.accounts, 1);
    assert.equal((await db.get("SELECT cashMinor FROM investment_accounts WHERE userId = 'empty-owner'")).cashMinor, 12500);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM transactions WHERE userId = 'startup-owner'")).count, 1);
    await assert.rejects(importSnapshot(db, 'empty-owner', snapshot, async () => ({ fileName: 'safety' })), /empty financial account/);
});

test('snapshot validation rejects unsupported currency, invalid dates and dangling holdings', () => {
    assert.throws(() => parseSnapshot({ ...snapshot, capturedAt: 'not-a-date' }));
    assert.throws(() => parseSnapshot({ ...snapshot, accounts: [{ ...snapshot.accounts[0], currency: 'USD' }] }));
    assert.throws(() => parseSnapshot({ ...snapshot, holdings: [{ accountRef: 'missing', symbol: 'EXAMPLE',
        quantity: 1, averageCostMicros: 1000000, priceMicros: 1000000 }] }), /unknown snapshot account/);
});
