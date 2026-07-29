function createRateLimit({ windowMs, max, key = (req) => req.ip }) {
    const buckets = new Map();

    return (req, res, next) => {
        const now = Date.now();
        const bucketKey = key(req) || "anonymous";
        const current = buckets.get(bucketKey);
        const active = !current || now - current.startedAt >= windowMs
            ? { startedAt: now, count: 0 }
            : current;

        active.count += 1;
        buckets.set(bucketKey, active);

        if (active.count > max) {
            const retryAfter = Math.ceil((windowMs - (now - active.startedAt)) / 1000);
            res.set("Retry-After", String(Math.max(1, retryAfter)));
            return res.status(429).json({ error: "Too many requests. Please try again later." });
        }

        next();
    };
}

module.exports = { createRateLimit };
