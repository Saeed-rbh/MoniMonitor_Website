const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-key-rotation-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
process.env.PLAID_CLIENT_ID = 'test-client';
process.env.PLAID_SECRET = 'test-secret';
for (const name of ['EMAIL_SOURCE_ENCRYPTION_KEY', 'PLAID_TOKEN_ENCRYPTION_KEY']) {
  process.env[name] = crypto.randomBytes(32).toString('base64url'); process.env[`${name}_ID`] = 'old';
}
const service = require('../database/dbService');
const { encryptAccessToken, decryptAccessToken, migrateAccessTokenEncryption } = require('./plaidService');
const { decryptString } = require('./encryptionService');
let db;
test.before(async () => {
  db = await service.getDb(); await service.createUser('owner', 'rotation-owner', 'unused');
});
test.after(async () => { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('startup migrations rotate stored email evidence and Plaid tokens without changing their contents', async () => {
  const now = new Date().toISOString();
  const transactionId = await service.addTransaction({ userId: 'owner', Amount: 10, Category: 'Expense', Timestamp: now });
  await service.upsertTransactionSource({ userId: 'owner', transactionId, provider: 'email', externalId: 'source-1', rawPayload: { body: 'private email evidence' } });
  await db.run('INSERT INTO plaid_items (itemId, userId, accessTokenEncrypted, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
    ['item', 'owner', encryptAccessToken('private-access-token'), now, now]);
  for (const name of ['EMAIL_SOURCE_ENCRYPTION_KEY', 'PLAID_TOKEN_ENCRYPTION_KEY']) {
    process.env[`${name}_PREVIOUS_KEYS`] = JSON.stringify({ old: process.env[name] });
    process.env[name] = crypto.randomBytes(32).toString('base64url'); process.env[`${name}_ID`] = 'new';
  }
  assert.equal((await service.migrateAndPruneRawEmailSources()).encrypted, 1);
  assert.equal((await migrateAccessTokenEncryption()).migrated, 1);
  const email = await db.get("SELECT rawPayloadJson FROM transaction_sources WHERE externalId = 'source-1'");
  const token = await db.get("SELECT accessTokenEncrypted FROM plaid_items WHERE itemId = 'item'");
  assert.match(email.rawPayloadJson, /^enc:v2:new:/);
  assert.deepEqual(JSON.parse(decryptString(email.rawPayloadJson, 'EMAIL_SOURCE_ENCRYPTION_KEY')), { body: 'private email evidence' });
  assert.match(token.accessTokenEncrypted, /^enc:v2:new:/);
  assert.equal(decryptAccessToken(token.accessTokenEncrypted), 'private-access-token');
  assert.equal((await service.migrateAndPruneRawEmailSources()).encrypted, 0);
  assert.equal((await migrateAccessTokenEncryption()).migrated, 0);
});

test('unreadable evidence is preserved and expired evidence is pruned without its retired key', async () => {
  await db.run("UPDATE transaction_sources SET rawPayloadJson = 'enc:v2:missing:invalid', capturedAt = ? WHERE externalId = 'source-1'", [new Date().toISOString()]);
  await assert.rejects(service.migrateAndPruneRawEmailSources(), /Invalid encrypted payload/);
  assert.equal((await db.get("SELECT rawPayloadJson FROM transaction_sources WHERE externalId = 'source-1'")).rawPayloadJson, 'enc:v2:missing:invalid');
  await db.run("UPDATE transaction_sources SET capturedAt = '2000-01-01' WHERE externalId = 'source-1'");
  assert.equal((await service.migrateAndPruneRawEmailSources()).pruned, 1);
  assert.equal((await db.get("SELECT rawPayloadJson FROM transaction_sources WHERE externalId = 'source-1'")).rawPayloadJson, null);
});
