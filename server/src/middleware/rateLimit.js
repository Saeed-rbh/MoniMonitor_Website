const { getDb } = require("../database/db");

function createRateLimit({ windowMs, max, key = (req) => req.ip }) {
    return async (req, res, next) => {
        const now = Date.now();
        const rawKey = key(req) || "anonymous";
        const bucketKey = `${windowMs}_${max}_${rawKey}`;

        try {
            const db = await getDb();
            let record = await db.get("SELECT count, startedAt FROM rate_limits WHERE bucketKey = ?", [bucketKey]);

            if (!record || (now - record.startedAt >= windowMs)) {
                await db.run(
                    `INSERT INTO rate_limits (bucketKey, count, startedAt)
                     VALUES (?, 1, ?)
                     ON CONFLICT(bucketKey) DO UPDATE SET count = 1, startedAt = ?`,
                    [bucketKey, now, now]
                );
                record = { count: 1, startedAt: now };
            } else {
                const newCount = record.count + 1;
                await db.run("UPDATE rate_limits SET count = ? WHERE bucketKey = ?", [newCount, bucketKey]);
                record.count = newCount;
            }

            if (record.count > max) {
                const retryAfter = Math.ceil((windowMs - (now - record.startedAt)) / 1000);
                res.set("Retry-After", String(Math.max(1, retryAfter)));
                return res.status(429).json({ error: "Too many requests. Please try again later." });
            }

            next();
        } catch (error) {
            console.error("Rate limit database check error:", error);
            // Fallback gracefully on database error to avoid blocking legitimate traffic
            next();
        }
    };
}

module.exports = { createRateLimit };
