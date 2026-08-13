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
});
