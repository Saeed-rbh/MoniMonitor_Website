const { logger } = require('./logger');
const { registerWorker } = require('./workerLifecycle');

function operationalAlerts(health, now = Date.now()) {
    const alerts = [];
    const add = (id, reason, action) => alerts.push({ id, reason, action });
    if (health.agent?.enabled && health.agent.state === 'failed') add('email_agent_failed', 'Email agent startup failed', 'Inspect the supervisor log and verify integration credentials, then restart the service.');
    if (health.financialChecks && (health.financialChecks.missing > 0 || now - Date.parse(health.financialChecks.oldestCheckAt) > 60 * 60000)) add('financial_checks_stale', 'Financial evidence checks are overdue', 'Inspect the operational monitor and its database errors; restart the worker after correcting the cause.');
    for (const [name, state] of Object.entries(health.subsystems || {})) {
        if (!state.configured) continue;
        if (['failed', 'degraded', 'paused'].includes(state.state)) add(`${name}_failed`, `${name} is ${state.state}`, 'Inspect protected diagnostics and integration configuration; retry the failed jobs after correcting the cause.');
        const heartbeat = Date.parse(state.lastHeartbeatAt || state.updatedAt || '');
        const budget = name === 'imap' ? 10 * 60_000 : name === 'telegramOutbox' ? 2 * 60_000 : 24 * 60 * 60_000;
        if (!Number.isFinite(heartbeat) || now - heartbeat > budget) add(`${name}_stale`, `${name} has no recent worker heartbeat`, 'Inspect the worker and restart it if it is stalled; queued jobs are retained.');
    }
    for (const [name, queue] of Object.entries(health.queues || {})) {
        if (queue.dead > 0) add(`${name}_dead_letters`, `${queue.dead} ${name} jobs require review`, 'Open the review queue, inspect the failure evidence, and explicitly retry or resolve each job.');
        if (queue.depth > 500 || queue.retryAgeSeconds > 3600) add(`${name}_backlog`, `${name} ingestion is behind`, 'Check provider availability and processing errors before retrying the backlog.');
    }
    if (health.backup?.stale) add('backup_stale', 'No recent verified backup', 'Create a backup and inspect encryption keys and backup storage.');
    if (!health.backup?.offsiteConfigured) add('backup_offsite_missing', 'Offsite backup copying is not configured', 'Set BACKUP_OFFSITE_DIRECTORY to a separate synchronized or mounted storage location.');
    if (health.backup?.offsiteConfigured && health.backup.offsiteVerified === false) add('backup_offsite_unverified', 'Offsite backup has not passed readback verification', 'Check backup storage connectivity and create another verified backup.');
    if (health.backup?.restoreDrill?.lastError || (health.backup?.restoreDrill?.lastSuccessAt && now - Date.parse(health.backup.restoreDrill.lastSuccessAt) > 35 * 86400000)) add('restore_drill_failed', 'Backup restore test needs attention', 'Run a restore drill and inspect storage and encryption configuration.');
    for (const item of health.integrations || []) {
        const lastSync = Date.parse(item.lastSyncedAt || '');
        if (item.status !== 'active' || !Number.isFinite(lastSync) || now - lastSync > 48 * 60 * 60_000) {
            add(`bank_${item.id}`, `Bank integration ${item.institutionName || item.id} needs attention`, 'Open Profile → Bank fallback to reconnect or sync the institution and review stale balances.');
        }
    }
    return alerts;
}

async function deliverOperationalAlert(alert, fetchImpl = globalThis.fetch) {
    const destination = process.env.OPERATIONAL_ALERT_WEBHOOK_URL;
    if (!destination) return;
    const url = new URL(destination);
    if (url.protocol !== 'https:') throw new Error('Operational alert webhook must use HTTPS');
    const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Only bounded operational identifiers and actions; no raw emails, tokens, account balances or exception text.
        body: JSON.stringify({ application: 'MoniMonitor', incident: alert.id, state: alert.state, action: alert.action }),
        signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Operational alert delivery failed');
}

function startOperationalMonitor(readDiagnostics) {
    let previous = new Map(), inFlight = null, timer;
    const tick = () => {
        if (inFlight) return inFlight;
        inFlight = (async () => {
            const health = await readDiagnostics();
            const db = await require('../database/db').getDb();
            const users = await db.all('SELECT id FROM users');
            for (const user of users) await require('./financialReliability').checkFinancialReliability(user.id);
            const owner = process.env.BACKUP_OWNER_USER_ID;
            if (owner && await db.get('SELECT id FROM users WHERE id=?', [owner])) await require('./financialReliability').persistIncidents(db, owner, 'operations', health.alerts);
            const next = new Map(health.alerts.map(alert => [alert.id, alert]));
            for (const [id, alert] of next) if (!previous.has(id)) {
                logger.warn('operations.incident.open', alert);
                await deliverOperationalAlert({ ...alert, state: 'open' });
            }
            for (const [id, alert] of previous) if (!next.has(id)) {
                logger.info('operations.incident.resolved', { incident: id });
                await deliverOperationalAlert({ ...alert, state: 'resolved' });
            }
            previous = next;
        })().catch(error => logger.error('operations.monitor.failed', { error: error.message })).finally(() => { inFlight = null; });
        return inFlight;
    };
    const start = () => { if (!timer) { timer = setInterval(tick, 60_000); timer.unref?.(); tick(); } };
    registerWorker('operationalMonitor', { pause: async () => { clearInterval(timer); timer = null; await inFlight; }, resume: start });
    start();
}

module.exports = { operationalAlerts, deliverOperationalAlert, startOperationalMonitor };
