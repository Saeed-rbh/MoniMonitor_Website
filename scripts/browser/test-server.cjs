// Isolated fixture API: no .env, external integrations, or background workers.
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-browser-'));
for (const key of Object.keys(process.env)) {
 if (!['PATH', 'HOME', 'TMPDIR'].includes(key)) delete process.env[key];
}
Object.assign(process.env, { NODE_ENV: 'test', DOTENV_CONFIG_PATH: '/dev/null',
 MONIMONITOR_DB_PATH: path.join(dir, 'test.sqlite'), MONIMONITOR_BACKUP_DIR: path.join(dir, 'backups'),
 FRONTEND_URL: 'http://localhost:4173', JWT_SECRET: 'synthetic-browser-test-secret-not-for-production',
 AI_INGESTION_ENABLED: 'false', SINGLE_TENANT_MODE: 'false' });
const dotenv = require('../../server/node_modules/dotenv');
dotenv.config = () => ({});
const app = require('../../server/index.js');
app.get('/__browser_fixture', (_req, res) => res.json({ isolatedBrowserFixture: true }));
const server = app.listen(4174, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
