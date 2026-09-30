const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-sessions-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
process.env.MONIMONITOR_BACKUP_DIR = path.join(directory, 'backups');
process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const { getDb } = require('../database/db');
const { issueSession, validateSession, revokeSession, InvalidSessionError } = require('./sessionService');
const { createBackup, restoreBackup } = require('./backupService');
const { resumeWorkers, workersPaused } = require('./workerLifecycle');
const secret = crypto.randomBytes(32).toString('hex');
const user = { id: 'session-owner', username: 'session-owner' };
let db;
test.before(async () => {
    db = await getDb();
    await db.run('INSERT INTO users (id, username, password) VALUES (?, ?, ?)', [user.id, user.username, 'unused']);
});
test.after(async () => { await resumeWorkers(); await db?.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('registered sessions survive service reload, reject forged claims, and expire in storage', async () => {
    const session = await issueSession(user, secret);
    const claims = await validateSession(session.accessToken, secret);
    delete require.cache[require.resolve('./sessionService')];
    await require('./sessionService').validateSession(session.accessToken, secret);
    for (const overrides of [{ exp: undefined }, { aud: 'another-app' }, { iss: 'another-api' }, { exp: Math.floor(Date.now() / 1000) - 1 }]) {
        const forged = jwt.sign(JSON.parse(JSON.stringify({ ...claims, ...overrides })), secret);
        await assert.rejects(validateSession(forged, secret), InvalidSessionError);
    }
    await db.run('UPDATE auth_sessions SET expiresAt = createdAt + 1');
    await assert.rejects(validateSession(session.accessToken, secret), InvalidSessionError);
});

test('successful restore cannot resurrect revoked or current access', async () => {
    const saved = await issueSession(user, secret);
    const backup = await createBackup('manual');
    await revokeSession(await validateSession(saved.accessToken, secret));
    const current = await issueSession(user, secret);
    await restoreBackup(backup.fileName, user.id);
    assert.equal(workersPaused(), true);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM auth_sessions')).count, 0);
    await assert.rejects(validateSession(saved.accessToken, secret), InvalidSessionError);
    await assert.rejects(validateSession(current.accessToken, secret), InvalidSessionError);
    await validateSession((await issueSession(user, secret)).accessToken, secret);
    await resumeWorkers();
});

test('a failed restore rolls back session invalidation', async () => {
    const session = await issueSession(user, secret);
    const backup = await createBackup('manual');
    await db.exec("CREATE TRIGGER reject_restore BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'Injected restore failure'); END");
    try { await assert.rejects(restoreBackup(backup.fileName, user.id), /Injected restore failure/); }
    finally { await db.exec('DROP TRIGGER reject_restore'); }
    await validateSession(session.accessToken, secret);
    assert.equal(workersPaused(), false);
});
