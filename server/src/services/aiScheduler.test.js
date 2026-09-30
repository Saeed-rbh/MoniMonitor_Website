const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { protectConnection } = require('../database/transactionConnection');
const { createAIScheduler, reserveDailyUsage } = require('./aiScheduler');

test('a stalled provider is aborted and later ingestion progresses without retrying uncertain calls', async () => {
    let calls = 0, signal;
    const scheduler = createAIScheduler({ intervalMs: 0, callTimeoutMs: 15, deadlineMs: 100,
        generate: request => { calls += 1; if (calls === 1) { signal = request.config.abortSignal; return new Promise(() => {}); }
            assert.equal(request.config.maxOutputTokens, 2048);
            assert.equal(request.config.httpOptions.retryOptions.attempts, 1);
            return { text: 'ok' }; } });
    const first = scheduler.run({ contents: 'one' });
    const second = scheduler.run({ contents: 'two' });
    await assert.rejects(first, { code: 'AI_TIMEOUT' });
    assert.equal(signal.aborted, true);
    assert.equal((await second).text, 'ok');
    assert.equal(calls, 2);
    assert.equal(scheduler.status().pending, 0);
});

test('absolute deadlines include queueing and quota reservation; expired jobs never send later', async () => {
    let release, calls = 0;
    const scheduler = createAIScheduler({ intervalMs: 0, deadlineMs: 20, callTimeoutMs: 10,
        reserveUsage: () => new Promise(resolve => { release = resolve; }), generate: () => { calls += 1; } });
    await assert.rejects(scheduler.run({ contents: 'private email' }), { code: 'AI_DEADLINE' });
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 0);
    assert.equal(scheduler.status().pending, 0);
});

test('oversized input and queue saturation fail before provider usage', async () => {
    const scheduler = createAIScheduler({ intervalMs: 0, maxQueue: 1, maxInputBytes: 20,
        deadlineMs: 20, callTimeoutMs: 10, generate: () => new Promise(() => {}) });
    await assert.rejects(scheduler.run({ contents: 'x'.repeat(21) }), { code: 'AI_INPUT_LIMIT' });
    const first = scheduler.run({ contents: 'one' });
    await assert.rejects(scheduler.run({ contents: 'two' }), { code: 'AI_QUEUE_FULL' });
    await assert.rejects(first, { code: 'AI_TIMEOUT' });
});

test('a huge provider retry delay remains bounded by the total deadline', async () => {
    let calls = 0;
    const scheduler = createAIScheduler({ intervalMs: 0, deadlineMs: 20, callTimeoutMs: 10,
        generate: () => { calls += 1; throw Object.assign(new Error('retry in 999999s'), { status: 429 }); } });
    await assert.rejects(scheduler.run({ contents: 'one' }), { code: 'AI_DEADLINE' });
    assert.equal(calls, 1);
});

test('usage reservations are atomic, count failed attempts, and persist across scheduler recreation', async () => {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    protectConnection(db);
    try {
        await db.exec('CREATE TABLE ai_usage_daily (day TEXT PRIMARY KEY, requests INTEGER, inputBytes INTEGER)');
        const usage = { day: '2026-09-30', inputBytes: 40, requestLimit: 2, inputLimit: 90 };
        const results = await Promise.allSettled([reserveDailyUsage(db, usage), reserveDailyUsage(db, usage), reserveDailyUsage(db, usage)]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
        assert.equal(results.find(result => result.status === 'rejected').reason.code, 'AI_DAILY_LIMIT');
        const row = await db.get('SELECT * FROM ai_usage_daily');
        assert.equal(row.requests, 2);
        assert.equal(row.inputBytes, 80);
        const recreated = createAIScheduler({ reserveUsage: async input => reserveDailyUsage(db, { ...input, ...usage }),
            generate: () => assert.fail('Daily cap must prevent provider calls') });
        await assert.rejects(recreated.run({ contents: 'one' }), { code: 'AI_DAILY_LIMIT' });
        await reserveDailyUsage(db, { ...usage, day: '2026-10-01' });
        await assert.rejects(reserveDailyUsage(db, { ...usage, day: '2026-10-01', inputBytes: 51 }), { code: 'AI_DAILY_LIMIT' });
    } finally { await db.close(); }
});
