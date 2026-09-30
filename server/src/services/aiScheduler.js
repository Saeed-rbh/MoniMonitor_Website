class AIProcessingError extends Error {
    constructor(code) { super(code); this.name = 'AIProcessingError'; this.code = code; }
}

function boundedInteger(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

async function reserveDailyUsage(db, { day, inputBytes, requestLimit, inputLimit }) {
    return db.withTransaction(async () => {
        const usage = await db.get('SELECT requests, inputBytes FROM ai_usage_daily WHERE day = ?', [day]);
        if ((usage?.requests || 0) >= requestLimit || (usage?.inputBytes || 0) + inputBytes > inputLimit) {
            throw new AIProcessingError('AI_DAILY_LIMIT');
        }
        // Charge every attempt before sending. Failed/aborted calls may still be billed by the provider.
        await db.run(`INSERT INTO ai_usage_daily(day, requests, inputBytes) VALUES (?, 1, ?)
            ON CONFLICT(day) DO UPDATE SET requests = requests + 1, inputBytes = ai_usage_daily.inputBytes + excluded.inputBytes`, [day, inputBytes]);
        await db.run('DELETE FROM ai_usage_daily WHERE day < ?', [new Date(Date.parse(day) - 32 * 86400000).toISOString().slice(0, 10)]);
    });
}

function createAIScheduler({ generate, reserveUsage = async () => {}, intervalMs = 4200,
    deadlineMs = 45000, callTimeoutMs = 15000, maxQueue = 8, maxRetries = 3,
    maxInputBytes = 128000, maxOutputTokens = 2048, now = Date.now } = {}) {
    let tail = Promise.resolve(), pending = 0, nextAllowedAt = 0;
    const run = request => {
        const inputBytes = Buffer.byteLength(JSON.stringify(request.contents || ''), 'utf8');
        if (inputBytes > maxInputBytes) return Promise.reject(new AIProcessingError('AI_INPUT_LIMIT'));
        if (pending >= maxQueue) return Promise.reject(new AIProcessingError('AI_QUEUE_FULL'));
        pending += 1;
        const controller = new AbortController();
        let deadlineTimer;
        const expiration = new Promise((_, reject) => {
            deadlineTimer = setTimeout(() => { controller.abort(); reject(new AIProcessingError('AI_DEADLINE')); }, deadlineMs);
        });
        const check = () => { if (controller.signal.aborted) throw new AIProcessingError('AI_DEADLINE'); };
        const wait = ms => new Promise((resolve, reject) => {
            check();
            const abort = () => { clearTimeout(timer); reject(new AIProcessingError('AI_DEADLINE')); };
            const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, ms);
            controller.signal.addEventListener('abort', abort, { once: true });
        });
        const work = tail.then(async () => {
            for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
                check();
                const delay = Math.max(0, nextAllowedAt - now());
                if (delay) await wait(delay);
                check();
                await reserveUsage({ day: new Date(now()).toISOString().slice(0, 10), inputBytes });
                check();
                nextAllowedAt = now() + intervalMs;
                const callController = new AbortController();
                const abort = () => callController.abort();
                controller.signal.addEventListener('abort', abort, { once: true });
                let callTimer;
                try {
                    const timedOut = new Promise((_, reject) => {
                        callTimer = setTimeout(() => { callController.abort(); reject(new AIProcessingError('AI_TIMEOUT')); }, callTimeoutMs);
                    });
                    const response = await Promise.race([Promise.resolve().then(() => generate({ ...request, config: { ...request.config,
                        maxOutputTokens, abortSignal: callController.signal,
                        httpOptions: { ...request.config?.httpOptions, timeout: callTimeoutMs, retryOptions: { attempts: 1 } },
                    } })), timedOut]);
                    check();
                    return response;
                } catch (error) {
                    clearTimeout(callTimer);
                    const message = String(error?.message || '');
                    const rateLimited = error?.status === 429 || message.includes('RESOURCE_EXHAUSTED');
                    if (!rateLimited || attempt === maxRetries) throw error;
                    const seconds = Number(message.match(/(?:retryDelay["']?\s*:\s*["']?|retry in )([\d.]+)s/i)?.[1]);
                    const retryMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 + 750 : 5000 * 2 ** attempt;
                    await wait(Math.min(10000, retryMs));
                } finally {
                    clearTimeout(callTimer);
                    controller.signal.removeEventListener('abort', abort);
                }
            }
            throw new AIProcessingError('AI_RETRIES_EXHAUSTED');
        });
        // Race the queue as well as the SDK: an expired queued request cannot retain the queue forever.
        const result = Promise.race([work, expiration]);
        tail = result.catch(() => undefined);
        return result.finally(() => { clearTimeout(deadlineTimer); pending -= 1; });
    };
    return { run, status: () => ({ pending, maxQueue, deadlineMs, callTimeoutMs, maxInputBytes, maxOutputTokens }) };
}

module.exports = { createAIScheduler, reserveDailyUsage, boundedInteger, AIProcessingError };
