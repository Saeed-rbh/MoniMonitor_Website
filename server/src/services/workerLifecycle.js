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
    await Promise.all([...workers.values()].map((worker) => worker.pause?.()).filter(Boolean));
}

async function resumeWorkers() {
    paused = false;
    await Promise.all([...workers.values()].map((worker) => worker.resume?.()).filter(Boolean));
}

module.exports = { registerWorker, workersPaused, pauseWorkers, resumeWorkers };
