const test = require('node:test');
const assert = require('node:assert/strict');
const { operationalAlerts, deliverOperationalAlert } = require('./operationalHealth');
test('diagnostics identify stale integration heartbeats, backlog and backup risks with actions', () => {
    const now = Date.now();
    const alerts = operationalAlerts({ agent: { enabled: true, state: 'failed' },
        subsystems: { imap: { configured: true, state: 'connected', lastHeartbeatAt: new Date(now - 11 * 60_000).toISOString() } },
        queues: { email: { dead: 2, depth: 600, retryAgeSeconds: 4000 } }, backup: { stale: true, offsiteConfigured: false },
        integrations: [{ id: 'bank1', institutionName: 'Bank', status: 'login_required' }] }, now);
    assert.deepEqual(alerts.map(alert => alert.id), ['email_agent_failed', 'imap_stale', 'email_dead_letters', 'email_backlog',
        'backup_stale', 'backup_offsite_missing', 'bank_bank1']);
    assert.ok(alerts.every(alert => alert.action.length > 20));
});
test('idle workers with recent heartbeats are healthy without requiring new transactions', () => {
    const alerts = operationalAlerts({ subsystems: { imap: { configured: true, state: 'connected', lastHeartbeatAt: new Date().toISOString() } },
        backup: { stale: false, offsiteConfigured: true } });
    assert.deepEqual(alerts, []);
});
test('optional webhook payload omits financial details and sensitive exception text', async () => {
    const previous = process.env.OPERATIONAL_ALERT_WEBHOOK_URL;
    process.env.OPERATIONAL_ALERT_WEBHOOK_URL = 'https://alerts.example.com/monimonitor';
    let payload;
    try {
        await deliverOperationalAlert({ id: 'worker_failed', state: 'open', action: 'Inspect worker logs',
            reason: 'private raw email', token: 'secret', cashMinor: 100 }, async (_url, options) => { payload = JSON.parse(options.body); return { ok: true }; });
        assert.deepEqual(payload, { application: 'MoniMonitor', incident: 'worker_failed', state: 'open', action: 'Inspect worker logs' });
    } finally { if (previous === undefined) delete process.env.OPERATIONAL_ALERT_WEBHOOK_URL; else process.env.OPERATIONAL_ALERT_WEBHOOK_URL = previous; }
});
