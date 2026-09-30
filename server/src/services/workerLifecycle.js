const workers = new Map();
let paused = false;

function registerWorker(name, controls) {
    workers.set(name, controls || {});
    return () => workers.delete(name);
}

function workersPaused() {
    return paused;
}

async function pauseWorkers() {
    paused = true;
    const results = await Promise.allSettled([...workers.values()].map((worker) => Promise.resolve().then(() => worker.pause?.())));
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'One or more workers failed to drain');
}

async function resumeWorkers() {
    paused = false;
    await Promise.all([...workers.values()].map((worker) => worker.resume?.()).filter(Boolean));
}

module.exports = { registerWorker, workersPaused, pauseWorkers, resumeWorkers };
