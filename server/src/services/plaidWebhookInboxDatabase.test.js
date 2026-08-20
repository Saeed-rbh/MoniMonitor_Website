const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-plaid-webhooks-'));
process.env.MONIMONITOR_DB_PATH = path.join(testDirectory, 'test.sqlite');

const dbService = require('../database/dbService');
const {
    enqueuePlaidWebhook,
    processPendingPlaidWebhooks,
    webhookRetryDelayMs,
} = require('./plaidService');

test.after(async () => {
    const db = await dbService.getDb();
    await db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('persists a verified webhook once before processing it', async () => {
    const rawBody = Buffer.from(JSON.stringify({
        webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-1',
    }));
    const first = await enqueuePlaidWebhook(rawBody, 'signed-delivery-1');
    const duplicate = await enqueuePlaidWebhook(rawBody, 'signed-delivery-1');
    assert.equal(first.inserted, true);
    assert.equal(duplicate.inserted, false);
    assert.equal(duplicate.id, first.id);

    const result = await processPendingPlaidWebhooks({
        processor: async () => ({ handled: true, action: 'synced' }),
    });
    assert.deepEqual(result, { selected: 1, processed: 1, retried: 0 });
    const db = await dbService.getDb();
    const event = await db.get('SELECT status, attempts, processedAt FROM plaid_webhook_events WHERE id = ?', [first.id]);
    assert.equal(event.status, 'processed');
    assert.equal(event.attempts, 1);
    assert.ok(event.processedAt);
});

test('retries failed and crash-interrupted webhook processing', async () => {
    const rawBody = Buffer.from(JSON.stringify({
        webhook_type: 'HOLDINGS', webhook_code: 'DEFAULT_UPDATE', item_id: 'item-2',
    }));
    const queued = await enqueuePlaidWebhook(rawBody, 'signed-delivery-2');
    const failed = await processPendingPlaidWebhooks({
        processor: async () => { throw new Error('temporary failure'); },
    });
    assert.equal(failed.retried, 1);

    const db = await dbService.getDb();
    let event = await db.get('SELECT * FROM plaid_webhook_events WHERE id = ?', [queued.id]);
    assert.equal(event.status, 'retry');
    assert.equal(event.attempts, 1);
    assert.equal(event.lastError, 'temporary failure');
    assert.equal(webhookRetryDelayMs(1), 30000);

    await db.run(
        "UPDATE plaid_webhook_events SET status = 'processing', lastAttemptAt = ?, nextAttemptAt = ? WHERE id = ?",
        ['2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', queued.id]
    );
    const recovered = await processPendingPlaidWebhooks({
        processor: async () => ({ handled: true, action: 'synced' }),
    });
    assert.equal(recovered.processed, 1);
    event = await db.get('SELECT status, attempts FROM plaid_webhook_events WHERE id = ?', [queued.id]);
    assert.equal(event.status, 'processed');
    assert.equal(event.attempts, 2);
});
