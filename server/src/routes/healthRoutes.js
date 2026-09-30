const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isLoopbackAddress } = require('../middleware/privateNetwork');
const { operationalAlerts } = require('../services/operationalHealth');

function registerHealthRoutes(app, { dbService, backupService, getAllSubsystemHealth,
    getTelegramOutboxWorkerHealth, runtimeVersion, agentStatus, authenticateToken, requireConfiguredOwner }) {
    const authorize = (req, res, next) => {
        if (isLoopbackAddress(req.ip || req.socket?.remoteAddress)) return next();
        return authenticateToken(req, res, () => requireConfiguredOwner(req, res, next));
    };
    async function diagnostics() {
        const db = await dbService.getDb();
        await db.get('SELECT 1 AS ready');
        const integrations = (await db.all('SELECT itemId, institutionName, status, lastSyncedAt FROM plaid_items')).map(({ itemId, ...item }) => ({
            ...item, id: crypto.createHash('sha256').update(itemId).digest('hex').slice(0, 12) }));
        const health = { app: runtimeVersion, database: { state: 'ready' }, agent: agentStatus,
            telegramOutbox: getTelegramOutboxWorkerHealth(), queues: await dbService.getQueueHealth(),
            backup: await backupService.getBackupHealth(), subsystems: getAllSubsystemHealth(), integrations };
        health.plaid = { connected: integrations.length > 0, items: integrations,
            accountsCount: (await db.get('SELECT COUNT(*) AS count FROM plaid_accounts')).count };
        health.alerts = operationalAlerts(health);
        health.status = agentStatus.enabled && agentStatus.state === 'failed' ? 'unavailable' : health.alerts.length ? 'degraded' : 'ok';
        return health;
    }
    app.get('/health', async (_req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            await (await dbService.getDb()).get('SELECT 1 AS ready');
            if (agentStatus.enabled && agentStatus.state === 'failed') return res.status(503).json({ status: 'unavailable' });
            return res.json({ status: 'ok' });
        } catch { return res.status(503).json({ status: 'unavailable' }); }
    });
    app.get('/diagnostics', authorize, async (_req, res) => {
        res.set('Cache-Control', 'no-store');
        try { return res.json(await diagnostics()); }
        catch { return res.status(503).json({ status: 'unavailable', app: runtimeVersion }); }
    });
    app.get('/diagnostics/dashboard', authorize, async (_req, res) => {
        try {
        const nonce = crypto.randomBytes(24).toString('base64');
        res.set('Cache-Control', 'no-store');
        res.set('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:3000 https://monimonitor.saeedarabha.com; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'`);
        const source = await fs.readFile(path.join(__dirname, '..', '..', '..', 'MoniMonitor_HealthDashboard.html'), 'utf8');
        return res.type('html').send(source.replaceAll('<script>', `<script nonce="${nonce}">`));
        } catch { return res.status(503).send('Diagnostics dashboard unavailable'); }
    });
    return diagnostics;
}
module.exports = { registerHealthRoutes };
