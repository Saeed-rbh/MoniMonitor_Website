const crypto = require('node:crypto');
const { getDb } = require('../database/db');
const { logger } = require('../services/logger');
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

function createRateLimit({ windowMs, max, namespace = 'requests', key = (req) => req.ip },
    { database = getDb, clock = Date.now } = {}) {
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0 || windowMs > MAX_WINDOW_MS ||
        !Number.isSafeInteger(max) || max <= 0 || max > 1_000_000) throw new Error('Invalid rate limit policy');
    let lastCleanupAt = -Infinity;
    return async (req, res, next) => {
        const now = clock();
        try {
            const identity = String(key(req) || 'anonymous');
            const digest = crypto.createHash('sha256').update(identity).digest('hex');
            const bucketKey = `${namespace}:${windowMs}:${max}:${digest}`;
            const db = await database();
            // A single statement keeps expiry and increments atomic across connections.
            const record = await db.get(`INSERT INTO rate_limits (bucketKey, count, startedAt)
                VALUES (?, 1, ?)
                ON CONFLICT(bucketKey) DO UPDATE SET
                    count = CASE WHEN startedAt <= ? THEN 1 ELSE MIN(count + 1, ?) END,
                    startedAt = CASE WHEN startedAt <= ? THEN excluded.startedAt ELSE startedAt END
                RETURNING count, startedAt`, [bucketKey, now, now - windowMs, max + 1, now - windowMs]);
            if (now - lastCleanupAt >= 60 * 60 * 1000) {
                await db.run('DELETE FROM rate_limits WHERE startedAt < ?', [now - MAX_WINDOW_MS]);
                lastCleanupAt = now;
            }
            const resetSeconds = Math.max(1, Math.ceil((windowMs - (now - record.startedAt)) / 1000));
            res.set('RateLimit-Limit', String(max));
            res.set('RateLimit-Remaining', String(Math.max(0, max - record.count)));
            res.set('RateLimit-Reset', String(resetSeconds));
            if (record.count > max) {
                res.set("Retry-After", String(resetSeconds));
                return res.status(429).json({ error: "Too many requests. Please try again later." });
            }

            return next();
        } catch (error) {
            logger.error('http.rate_limit.unavailable', { correlationId: req.requestId, error: error.message });
            res.set('Retry-After', '5');
            return res.status(503).json({ error: 'Request protection is temporarily unavailable. Please retry shortly.' });
        }
    };
}

module.exports = { createRateLimit };
