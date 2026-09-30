const { pauseWorkers } = require('./workerLifecycle');

function installRuntimeLifecycle({ processRef = process, server = null, drain = pauseWorkers,
    timeoutMs = 30_000, log = console.error, onFatal = async () => {} } = {}) {
    let shuttingDown = false;
    let exitCode = 0;
    let shutdownPromise;
    let fatalWork = Promise.resolve();
    const fatal = kind => {
        fatalWork = Promise.resolve().then(() => onFatal(kind)).catch(error => log('[Runtime] Fatal alert failed:', error.message));
        return shutdown(kind, 1);
    };
    function shutdown(reason, code = 0) {
        exitCode = Math.max(exitCode, code);
        if (shutdownPromise) return shutdownPromise;
        shuttingDown = true;
        log(`[Runtime] Controlled shutdown: ${reason}`);
        const deadline = setTimeout(() => {
            log('[Runtime] Shutdown deadline exceeded; durable queues will recover on restart.');
            server?.closeAllConnections?.();
            processRef.exit(Math.max(1, exitCode));
        }, timeoutMs);
        shutdownPromise = (async () => {
            try {
                const requestsClosed = server ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
                server?.closeIdleConnections?.();
                await Promise.all([requestsClosed, drain()]);
                await fatalWork;
            } catch (error) {
                exitCode = 1;
                log('[Runtime] Worker drain failed:', error.message);
            } finally {
                clearTimeout(deadline);
                processRef.exit(exitCode);
            }
        })();
        return shutdownPromise;
    }
    const handlers = {
        SIGINT: () => shutdown('SIGINT'), SIGTERM: () => shutdown('SIGTERM'),
        uncaughtException: error => { log('[Runtime] Fatal exception:', error); fatal('uncaughtException'); },
        unhandledRejection: error => { log('[Runtime] Fatal rejection:', error); fatal('unhandledRejection'); },
    };
    for (const [event, handler] of Object.entries(handlers)) processRef.on(event, handler);
    return { shutdown, isShuttingDown: () => shuttingDown,
        dispose: () => { for (const [event, handler] of Object.entries(handlers)) processRef.removeListener(event, handler); } };
}

module.exports = { installRuntimeLifecycle };
