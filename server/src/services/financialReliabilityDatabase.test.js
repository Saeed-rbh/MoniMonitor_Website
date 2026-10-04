const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-reliability-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
const dbService = require('../database/dbService');
const { persistIncidents } = require('./financialReliability');
let db, id;
test.before(async () => {
    db = await dbService.getDb();
    await dbService.createUser('owner', 'reliability-owner', 'unused');
    id = await dbService.addTransaction({ userId: 'owner', Amount: 19.96, Currency: 'CAD', Category: 'Expense', Label: 'Other Expense', Reason: 'Google', AccountFlow: 'OUT', Timestamp: new Date().toISOString() });
});
test.after(async () => { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
test('manual corrections survive provider reclassification while raw evidence is preserved', async () => {
    await dbService.updateTransactionForUser(id, 'owner', { Category: 'Income', Label: 'Refunds & Reversals', AccountFlow: 'IN' }, { reviewed: true });
    await dbService.updateTransactionForUser(id, 'owner', { Category: 'Expense', AccountFlow: 'OUT', Reason: 'Updated bank name' });
    const tx = await dbService.getTransactionById(id, 'owner');
    assert.equal(tx.Category, 'Income'); assert.equal(tx.AccountFlow, 'IN'); assert.equal(tx.Reason, 'Updated bank name');
    await dbService.upsertTransactionSource({ userId: 'owner', provider: 'plaid', externalId: 'bank-id', transactionId: id, ownsTransaction: true, rawPayload: { amount: 19.96 } });
    await dbService.upsertTransactionSource({ userId: 'owner', provider: 'plaid', externalId: 'bank-id', transactionId: id, ownsTransaction: true, rawPayload: { amount: -19.96 } });
    const archived = await db.get('SELECT rawPayloadJson FROM transaction_source_history WHERE transactionId=?', [id]);
    assert.equal(JSON.parse(archived.rawPayloadJson).amount, 19.96);
});
test('incident transitions and queued notices are atomic and restart-safe without flooding', async () => {
    const previousToken = process.env.TELEGRAM_BOT_TOKEN, previousChat = process.env.TELEGRAM_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = 'test'; process.env.TELEGRAM_CHAT_ID = 'test';
    try {
        const issues = [{ key: 'refund:1', action: 'Review refund' }, { key: 'refund:2', action: 'Review refund' }];
        await persistIncidents(db, 'owner', 'financial', issues);
        await persistIncidents(db, 'owner', 'financial', issues);
        assert.equal((await db.get('SELECT COUNT(*) AS n FROM telegram_outbox')).n, 1);
        await persistIncidents(db, 'owner', 'financial', []);
        await persistIncidents(db, 'owner', 'financial', []);
        assert.equal((await db.get('SELECT COUNT(*) AS n FROM telegram_outbox')).n, 2);
        assert.equal((await db.get('SELECT COUNT(*) AS n FROM reliability_incidents WHERE resolvedAt IS NULL')).n, 0);
    } finally {
        if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = previousToken;
        if (previousChat === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = previousChat;
    }
});
