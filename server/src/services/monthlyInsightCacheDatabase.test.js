const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-insight-cache-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
process.env.AI_API_KEY = '';
process.env.GEMINI_API_KEY = '';
const dbService = require('../database/dbService');
const modulePath = require.resolve('./monthlyInsightService');
let insights = require('./monthlyInsightService');
let db;
let transactionId;
test.before(async () => {
    db = await dbService.getDb();
    await dbService.createUser('cache-owner', 'cache-owner', 'unused');
    transactionId = await dbService.addTransaction({ userId: 'cache-owner', Amount: 25, Category: 'Expense',
        Label: 'Shopping', Reason: 'Example store', Timestamp: '2026-09-10T12:00:00.000Z' });
});
test.after(async () => { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('unchanged data reuses the brief while amount edits invalidate the memory cache', async () => {
    const first = await insights.getMonthlyInsightBrief('cache-owner', '2026-09');
    const cached = await insights.getMonthlyInsightBrief('cache-owner', '2026-09');
    assert.deepEqual(cached, first);
    await dbService.updateTransactionForUser(transactionId, 'cache-owner', { Amount: 30 });
    const updated = await insights.getMonthlyInsightBrief('cache-owner', '2026-09');
    assert.notEqual(updated.dataHash, first.dataHash);
    assert.equal(updated.summary.expenseMinor, 3000);
});

test('restart rejects stale persisted briefs after a transaction description changes', async () => {
    const previous = await insights.getMonthlyInsightBrief('cache-owner', '2026-09');
    await dbService.updateTransactionForUser(transactionId, 'cache-owner', { Reason: 'Corrected merchant' });
    delete require.cache[modulePath];
    insights = require('./monthlyInsightService');
    const updated = await insights.getMonthlyInsightBrief('cache-owner', '2026-09');
    assert.notEqual(updated.dataHash, previous.dataHash);
    assert.equal(updated.summary.expenseMinor, previous.summary.expenseMinor);
});

test('restoring earlier values and deleting transactions cannot reuse newer conclusions', async () => {
    const previous = await insights.getMonthlyInsightBrief('cache-owner', '2026-09');
    await dbService.updateTransactionForUser(transactionId, 'cache-owner', { Amount: 25, Reason: 'Example store' });
    const restored = await insights.getMonthlyInsightBrief('cache-owner', '2026-09');
    assert.notEqual(restored.dataHash, previous.dataHash);
    assert.equal(restored.summary.expenseMinor, 2500);
    await dbService.deleteTransaction(transactionId, 'cache-owner');
    const deleted = await insights.getMonthlyInsightBrief('cache-owner', '2026-09');
    assert.notEqual(deleted.dataHash, restored.dataHash);
    assert.equal(deleted.summary.transactionCount, 0);
});
