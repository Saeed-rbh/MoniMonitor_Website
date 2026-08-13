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

test('discovers every UID after the durable cursor without filtering for unread mail', async () => {
    const queued = [];
    const searches = [];
    const service = Object.create(ImapService.prototype);
    service.mailboxKey = 'owner@example.com:INBOX';
    service.initialSyncSince = new Date('2026-08-11T00:00:00.000Z');
    service.database = {
        prepareEmailSync: async () => ({ lastDiscoveredUid: 41 }),
        enqueueDiscoveredEmails: async (_mailboxKey, _uidValidity, uids) => queued.push(...uids),
    };
    service.client = {
        mailbox: { uidValidity: 123n },
        search: async (query, options) => {
            searches.push({ query, options });
            return [41, 42, 43];
        },
    };

    assert.equal(await service.discoverMessages(), '123');
    assert.deepEqual(searches, [{ query: { uid: '42:*' }, options: { uid: true } }]);
    assert.deepEqual(queued, [42, 43]);
});

test('initial durable sync includes messages already marked read', async () => {
    let searchQuery = null;
    const service = Object.create(ImapService.prototype);
    service.mailboxKey = 'owner@example.com:INBOX';
    service.initialSyncSince = new Date('2026-08-11T00:00:00.000Z');
    service.database = {
        prepareEmailSync: async () => ({ lastDiscoveredUid: 0 }),
        enqueueDiscoveredEmails: async () => {},
    };
    service.client = {
        mailbox: { uidValidity: '456' },
        search: async (query) => { searchQuery = query; return [9]; },
    };

    await service.discoverMessages();
    assert.deepEqual(searchQuery, { since: service.initialSyncSince });
    assert.equal(Object.hasOwn(searchQuery, 'unseen'), false);
});

test('keeps unsuccessful analysis in the durable retry queue', async () => {
    const failures = [];
    let markedProcessed = false;
    const service = Object.create(ImapService.prototype);
    service.mailboxKey = 'owner@example.com:INBOX';
    service.database = {
        isEmailProcessed: async () => false,
        markEmailProcessed: async () => { markedProcessed = true; },
        markEmailFailed: async (uid, mailboxKey, uidValidity, error) => {
            failures.push({ uid, mailboxKey, uidValidity, error });
        },
    };
    service.client = {
        fetchOne: async () => ({
            source: Buffer.from('Date: Thu, 13 Aug 2026 12:00:00 -0400\r\nSubject: Test\r\n\r\nTransaction'),
        }),
        messageFlagsAdd: async () => assert.fail('failed email must not be marked seen'),
    };
    service.onNewEmail = async () => false;

    await service.processOne(77, '456');
    assert.equal(markedProcessed, false);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].uid, 77);
});
