const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database/db');

const ISSUER = 'monimonitor-api';
const AUDIENCE = 'monimonitor-app';
class InvalidSessionError extends Error {}
const digest = (id) => crypto.createHash('sha256').update(id).digest('hex');

async function issueSession(user, secret, expiresIn = '8h', extraClaims = {}) {
    const id = crypto.randomBytes(32).toString('hex');
    const accessToken = jwt.sign({ ...extraClaims, userId: user.id, username: user.username }, secret,
        { algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, jwtid: id, expiresIn });
    const claims = jwt.decode(accessToken);
    if (!Number.isSafeInteger(claims.exp) || claims.exp <= claims.iat) throw new Error('Invalid session lifetime');
    const db = await getDb();
    await db.withTransaction(async () => {
        await db.run('DELETE FROM auth_sessions WHERE expiresAt <= ?', [Math.floor(Date.now() / 1000)]);
        await db.run('INSERT INTO auth_sessions (idHash, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
            [digest(id), user.id, claims.iat, claims.exp]);
    });
    return { accessToken, expiresAt: claims.exp * 1000 };
}

async function validateSession(token, secret) {
    let claims;
    try {
        claims = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
        if (typeof claims.userId !== 'string' || !/^[a-f0-9]{64}$/.test(claims.jti || '') ||
            !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat)) throw new Error('Invalid claims');
    } catch { throw new InvalidSessionError('Invalid or expired session'); }
    const db = await getDb();
    const session = await db.get(`SELECT s.expiresAt FROM auth_sessions s JOIN users u ON u.id = s.userId
        WHERE s.idHash = ? AND s.userId = ? AND s.revokedAt IS NULL AND s.expiresAt > ?`,
        [digest(claims.jti), claims.userId, Math.floor(Date.now() / 1000)]);
    if (!session || session.expiresAt !== claims.exp) throw new InvalidSessionError('Invalid or expired session');
    return claims;
}

async function revokeSession(claims) {
    const db = await getDb();
    await db.run('UPDATE auth_sessions SET revokedAt = ? WHERE idHash = ? AND userId = ?',
        [Math.floor(Date.now() / 1000), digest(claims.jti), claims.userId]);
}

module.exports = { issueSession, validateSession, revokeSession, InvalidSessionError };
