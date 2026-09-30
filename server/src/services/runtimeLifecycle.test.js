const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { installRuntimeLifecycle } = require('./runtimeLifecycle');
const { registerWorker, pauseWorkers, resumeWorkers } = require('./workerLifecycle');

test('fatal exceptions and rejected promises exit after registered workers drain', () => {
    for (const failure of ["setImmediate(() => { throw new Error('injected fatal'); })", "Promise.reject(new Error('injected rejection'))"]) {
        const code = `const { installRuntimeLifecycle } = require(${JSON.stringify(require.resolve('./runtimeLifecycle'))});
            const { registerWorker } = require(${JSON.stringify(require.resolve('./workerLifecycle'))});
            registerWorker('injected', { pause: () => new Promise(resolve => setTimeout(() => { console.log('worker-drained'); resolve(); }, 25)) });
            installRuntimeLifecycle({ timeoutMs: 2000 }); ${failure};`;
        const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 5000 });
        assert.equal(child.status, 1, child.stderr);
        assert.match(child.stdout, /worker-drained/);
        assert.match(child.stderr, /Controlled shutdown/);
    }
});

test('a stalled drain reaches its deadline and exits unsuccessfully', () => {
    const code = `require(${JSON.stringify(require.resolve('./runtimeLifecycle'))}).installRuntimeLifecycle({
        timeoutMs: 25, drain: () => new Promise(() => {}) }); process.emit('SIGTERM');`;
    const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /deadline exceeded/);
});

test('repeated signals drain once and a fatal error upgrades the pending exit status', async () => {
    const processRef = new EventEmitter();
    let exitCode, drains = 0, finish;
    processRef.exit = code => { exitCode = code; };
    const lifecycle = installRuntimeLifecycle({ processRef, log: () => {}, drain: () => { drains++; return new Promise(resolve => { finish = resolve; }); } });
    processRef.emit('SIGTERM');
    processRef.emit('uncaughtException', new Error('injected'));
    finish(); await lifecycle.shutdown('again');
    assert.equal(drains, 1); assert.equal(exitCode, 1);
    assert.equal(lifecycle.isShuttingDown(), true);
    lifecycle.dispose();
});

test('one failed worker does not prevent other workers from finishing their drains', async () => {
    let drained = false;
    const removeA = registerWorker('test-failing', { pause: () => { throw new Error('injected'); } });
    const removeB = registerWorker('test-draining', { pause: async () => { await new Promise(resolve => setTimeout(resolve, 15)); drained = true; } });
    try { await assert.rejects(pauseWorkers(), AggregateError); assert.equal(drained, true); }
    finally { removeA(); removeB(); await resumeWorkers(); }
});
