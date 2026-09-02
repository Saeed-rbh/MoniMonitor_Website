const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-source-access-'));
process.env.MONIMONITOR_DB_PATH = path.join(testDirectory, 'test.sqlite');
process.env.BACKUP_OWNER_USER_ID = 'owner-user';

const dbService = require('../database/dbService');

test.after(async () => {
    await dbService.getDb().then((db) => db.close()).catch(() => {});
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('keeps an email source unavailable to a different authenticated user', async () => {
    await dbService.createUser('owner-user', 'owner', 'hash');
    await dbService.createUser('secondary-user', 'secondary', 'hash');
    assert.equal((await dbService.getUserById('owner-user')).role, 'owner');
    assert.equal((await dbService.getUserById('secondary-user')).role, 'user');
    const transactionId = await dbService.addTransaction({
        userId: 'owner-user', Amount: 12.34, Category: 'Expense', Label: 'Groceries',
        Reason: 'Market', Timestamp: '2026-09-02T12:00:00.000Z',
    });
    await dbService.upsertTransactionSource({
        userId: 'owner-user', provider: 'email', externalId: 'owner@example.com:INBOX:1:9',
        transactionId, ownsTransaction: true, rawPayload: { rawBody: 'sensitive source' },
    });

    const ownerSources = await dbService.getTransactionSourcesForUser(transactionId, 'owner-user');
    const secondarySources = await dbService.getTransactionSourcesForUser(transactionId, 'secondary-user');
    assert.equal(ownerSources.length, 1);
    assert.deepEqual(secondarySources, []);
});
