const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-api-auth-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
process.env.JWT_SECRET = 'phase3-api-test-secret-that-is-long-enough';
process.env.BACKUP_OWNER_USER_ID = 'api-owner';
process.env.SINGLE_TENANT_MODE = 'true';
process.env.BACKUP_PRIVATE_NETWORK_ONLY = 'false';

const app = require('../../index');
const dbService = require('../database/dbService');
let server;
let origin;

const tokenFor = (userId) => jwt.sign({ userId, username: userId }, process.env.JWT_SECRET, { expiresIn: '5m' });
const request = (pathname, token = null) => fetch(`${origin}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
});

test.before(async () => {
    await dbService.createUser('api-owner', 'api-owner', 'test-password-hash');
    await dbService.createUser('secondary-user', 'secondary-user', 'test-password-hash');
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    const db = await dbService.getDb();
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
});

test('API rejects missing sessions and secondary accounts while allowing the configured owner', async () => {
    const missingSession = await request('/transactions');
    assert.equal(missingSession.status, 401);

    const secondary = await request('/transactions', tokenFor('secondary-user'));
    assert.equal(secondary.status, 403);

    const owner = await request('/transactions/999/sources', tokenFor('api-owner'));
    assert.equal(owner.status, 404);
});

test('request logs receive a correlation ID without echoing authorization data', async () => {
    const response = await request('/transactions', tokenFor('api-owner'));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('x-request-id'), /^[A-Za-z0-9._-]{8,128}$/);
});
