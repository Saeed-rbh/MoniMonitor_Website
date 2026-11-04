const { getDb } = require('../database/db');
const STALE_MS = 3 * 60 * 1000;
const BACKLOG_MS = 10 * 60 * 1000;
async function recordAgentState(patch, now = Date.now()) {
    const db = await getDb();
    for (const [key, value] of Object.entries({ ...patch, heartbeatAt: new Date(now).toISOString() })) {
        await db.run('INSERT INTO email_sync_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', ['runtime.' + key, JSON.stringify(value)]);
    }
}
async function getOperationalStatus({ enabled = process.env.AI_INGESTION_ENABLED === 'true', now = Date.now() } = {}) {
    const db = await getDb();
    await db.get('SELECT 1');
    const runtime = Object.fromEntries((await db.all("SELECT key,value FROM email_sync_state WHERE key LIKE 'runtime.%'"))
        .map(row => [row.key.slice(8), JSON.parse(row.value)]));
    const counts = await db.all('SELECT status, COUNT(*) count FROM email_ingestion GROUP BY status');
    const pending = await db.get("SELECT COUNT(*) count, MIN(receivedAt) oldestAt FROM email_ingestion WHERE status='pending'");
    const notifications = await db.get('SELECT COUNT(*) count, MIN(updatedAt) oldestAt FROM email_notifications');
    const review = counts.find(row => row.status === 'review_required')?.count || 0;
    const age = value => value && Number.isFinite(Date.parse(value)) ? Math.max(0, now - Date.parse(value)) : Infinity;
    const issues = [];
    if (enabled) {
        if (age(runtime.heartbeatAt) > STALE_MS) issues.push('agent_offline');
        if (!runtime.connected) issues.push('mail_disconnected');
        else if (runtime.lastError) issues.push('scan_error');
        if (age(runtime.lastScanAt) > STALE_MS) issues.push('scan_stalled');
        if (pending.count && age(pending.oldestAt) > BACKLOG_MS) issues.push('email_backlog');
        if (notifications.count && age(notifications.oldestAt) > BACKLOG_MS) issues.push('notification_backlog');
        if (review) issues.push('review_required');
    }
    return {
        status: !enabled ? 'disabled' : issues.length ? 'degraded' : 'ok',
        enabled, issues, checkedAt: new Date(now).toISOString(),
        agent: { heartbeatAt: runtime.heartbeatAt || null, connected: Boolean(runtime.connected), lastScanAt: runtime.lastScanAt || null, lastMessageAt: runtime.lastMessageAt || null, lastError: runtime.lastError || null },
        counts, pending, notifications, reviewCount: review,
    };
}
module.exports = { recordAgentState, getOperationalStatus, STALE_MS, BACKLOG_MS };
