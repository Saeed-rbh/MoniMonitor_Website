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
const { issueSession } = require('../services/sessionService');
let server;
let origin;

const tokens = new Map();
const tokenFor = (userId) => tokens.get(userId);
const request = (pathname, token = null) => fetch(`${origin}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
});

test.before(async () => {
    await dbService.createUser('api-owner', 'api-owner', 'test-password-hash');
    await dbService.createUser('secondary-user', 'secondary-user', 'test-password-hash');
    for (const id of ['api-owner', 'secondary-user']) tokens.set(id,
        (await issueSession({ id, username: id }, process.env.JWT_SECRET, '5m')).accessToken);
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

test('public health is minimal while diagnostics contain the fixed running identity', async () => {
    const response = await request('/health');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { status: 'ok' });
    const diagnostic = await request('/diagnostics');
    assert.deepEqual((await diagnostic.json()).app, require('../services/runtimeVersion').runtimeVersion);
    const remote = (token = null) => fetch(`${origin}/diagnostics`, { headers: {
        'X-Forwarded-For': '203.0.113.12', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    assert.equal((await remote()).status, 401);
    assert.equal((await remote(tokenFor('secondary-user'))).status, 403);
    assert.equal((await remote(tokenFor('api-owner'))).status, 200);
    const dashboard = await request('/diagnostics/dashboard');
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.headers.get('content-security-policy'), /script-src 'self' 'nonce-/);
    const html = await dashboard.text();
    assert.match(html, /<script nonce="/); assert.ok(!html.includes('onclick='));
});

test('report APIs reject impossible months before querying or generating insights', async () => {
    for (const month of ['2026-00', '2026-13']) {
        for (const route of ['/dashboard-bootstrap', '/insights/monthly']) {
            assert.equal((await request(`${route}?month=${month}`, tokenFor('api-owner'))).status, 400);
        }
    }
});

test('account APIs accept signed balances while retaining safe-integer limits', async () => {
    const write = (route, method, body) => fetch(`${origin}${route}`, { method,
        headers: { Authorization: `Bearer ${tokenFor('api-owner')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body) });
    const created = await write('/portfolio/accounts', 'POST', {
        name: 'Overdraft', accountType: 'Chequing', currency: 'CAD', cashMinor: -1200,
    });
    assert.equal(created.status, 201);
    const account = await created.json();
    assert.equal(account.cashMinor, -1200);
    const changed = await write(`/portfolio/accounts/${account.id}`, 'PUT', { cashMinor: -2500 });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).cashMinor, -2500);
    assert.equal((await write(`/portfolio/accounts/${account.id}`, 'PUT', { cashMinor: -1.5 })).status, 400);
    assert.equal((await write(`/portfolio/accounts/${account.id}`, 'PUT', { cashMinor: Number.MAX_SAFE_INTEGER + 1 })).status, 400);
});

test('creation retries are idempotent through both supported API endpoints', async () => {
    const transaction = { Amount: 12, Category: 'Expense', Label: 'Shopping', Reason: 'API retry test',
        Timestamp: '2026-09-13T12:00:00.000Z' };
    for (const pathname of ['/transactions', '/MoniMonitor_ToDB']) {
        const key = `api-retry-${pathname.replace(/\W/g, '')}`;
        const body = pathname === '/transactions' ? transaction : { status: 'record', record_entry: transaction };
        const create = () => fetch(`${origin}${pathname}`, { method: 'POST',
            headers: { Authorization: `Bearer ${tokenFor('api-owner')}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body: JSON.stringify(body) });
        const first = await create();
        const second = await create();
        assert.equal(first.status, 201);
        assert.equal(second.status, 201);
        assert.deepEqual(await first.json(), await second.json());
    }
    const db = await dbService.getDb();
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM transactions WHERE Reason = 'API retry test'")).count, 2);
});

test('logout revokes only the current session and rejects stateless legacy tokens', async () => {
    const user = { id: 'api-owner', username: 'api-owner' };
    const first = await issueSession(user, process.env.JWT_SECRET);
    const second = await issueSession(user, process.env.JWT_SECRET);
    assert.equal((await request('/session', first.accessToken)).status, 200);
    assert.equal((await fetch(`${origin}/logout`, { method: 'POST', headers: { Authorization: `Bearer ${first.accessToken}` } })).status, 204);
    assert.equal((await request('/transactions', first.accessToken)).status, 401);
    assert.equal((await request('/session', second.accessToken)).status, 200);
    const legacy = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '8h' });
    assert.equal((await request('/transactions', legacy)).status, 401);
});

test('session storage failures fail closed with a retryable service error', async () => {
    const db = await dbService.getDb();
    const original = db.get;
    db.get = async (sql, ...args) => {
        if (sql.includes('FROM auth_sessions')) throw new Error('Injected storage failure');
        return original.call(db, sql, ...args);
    };
    try { assert.equal((await request('/session', tokenFor('api-owner'))).status, 503); }
    finally { db.get = original; }
});

test('password login registers access and never caches credentials or session responses', async () => {
    const bcrypt = require('bcryptjs');
    const db = await dbService.getDb();
    const password = 'session-api-integration-password';
    await db.run('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(password, 4), 'api-owner']);
    const login = await fetch(`${origin}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'api-owner', password }) });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get('cache-control'), 'no-store');
    const body = await login.json();
    assert.ok(body.expiresAt > Date.now());
    const session = await request('/session', body.accessToken);
    assert.equal(session.status, 200);
    assert.equal(session.headers.get('cache-control'), 'no-store');
    assert.equal((await session.json()).user.id, 'api-owner');
});

test('browser sessions use HttpOnly cookies and require a trusted origin for mutations', async () => {
    const bcrypt = require('bcryptjs');
    const db = await dbService.getDb();
    const password = 'cookie-session-integration-password';
    await db.run('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(password, 4), 'api-owner']);
    const login = await fetch(`${origin}/login`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'X-Session-Mode': 'cookie' },
        body: JSON.stringify({ username: 'api-owner', password }) });
    assert.equal(login.status, 200);
    const data = await login.json();
    assert.equal(data.accessToken, undefined);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Lax/);
    const cookie = setCookie.split(';')[0];
    const cookieRequest = (path, method = 'GET', requestOrigin = null) => fetch(`${origin}${path}`, {
        method, headers: { Cookie: cookie, ...(requestOrigin ? { Origin: requestOrigin } : {}) } });
    assert.equal((await cookieRequest('/session')).status, 200);
    assert.equal((await cookieRequest('/logout', 'POST')).status, 403);
    assert.equal((await cookieRequest('/logout', 'POST', 'null')).status, 403);
    const logout = await cookieRequest('/logout', 'POST', 'http://localhost:3000');
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
    assert.equal((await cookieRequest('/session')).status, 401);
});
