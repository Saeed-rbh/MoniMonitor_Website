const { AIProcessingError } = require('./aiScheduler');
function withFallback(primary, fallback, primaryTimeoutMs = 45000) {
    return {
        ...primary,
        identity: `${primary.identity}+fallback:${fallback.identity}`,
        async generate(request) {
            const controller = new AbortController();
            const signal = request.config?.abortSignal;
            const cancel = () => controller.abort();
            signal?.addEventListener('abort', cancel, { once: true });
            if (signal?.aborted) cancel();
            let timer;
            try {
                const timeout = new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        controller.abort();
                        reject(new AIProcessingError('AI_CODEX_TIMEOUT'));
                    }, primaryTimeoutMs);
                });
                return await Promise.race([primary.generate({ ...request,
                    config: { ...request.config, abortSignal: controller.signal } }), timeout]);
            } catch (error) {
                if (signal?.aborted || !fallback.enabled) throw error;
                console.warn('[AI] CLI failed; using configured API fallback.');
                return await fallback.generate(request);
            } finally {
                clearTimeout(timer);
                signal?.removeEventListener('abort', cancel);
            }
        },
    };
}
module.exports = { withFallback };
