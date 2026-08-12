const assert = require('node:assert/strict');
const test = require('node:test');
const { ImapService } = require('./imapService');

test('schedules failed unread emails for another scan every minute', async (t) => {
    const originalSetInterval = global.setInterval;
    let scheduledCallback = null;
    let scheduledDelay = null;
    let unrefCalled = false;

    global.setInterval = (callback, delay) => {
        scheduledCallback = callback;
        scheduledDelay = delay;
        return { unref: () => { unrefCalled = true; } };
    };
    t.after(() => { global.setInterval = originalSetInterval; });

    const service = Object.create(ImapService.prototype);
    service.retryUnseenInterval = null;
    let scans = 0;
    service.processUnseen = async () => { scans += 1; };

    service.startRetryPolling();

    assert.equal(scheduledDelay, 60_000);
    assert.equal(unrefCalled, true);
    assert.equal(typeof scheduledCallback, 'function');

    scheduledCallback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(scans, 1);
});

test('coalesces overlapping unread-email scans', async () => {
    const service = Object.create(ImapService.prototype);
    service.processingUnseen = null;
    let scans = 0;
    let releaseScan;
    service.processUnseenBatch = async () => {
        scans += 1;
        await new Promise((resolve) => { releaseScan = resolve; });
    };

    const firstScan = service.processUnseen();
    const secondScan = service.processUnseen();

    assert.equal(scans, 1);
    releaseScan();
    await Promise.all([firstScan, secondScan]);
    assert.equal(service.processingUnseen, null);
});
