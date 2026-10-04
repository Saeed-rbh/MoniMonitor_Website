const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { acquireInstance, assertApiPortFree } = require('../src/services/instanceGuard');
const entry = path.join(__dirname, '..', process.argv.includes('--agent') ? 'email_agent.js' : 'index.js');
let child, timer, stopping = false;
let crashes = [];
let forceTimer, controlTimer;
let instanceGuard;
const controlFile = process.env.MONIMONITOR_CONTROL_FILE || path.join(require('node:os').tmpdir(), `monimonitor-${Number(process.env.PORT || 3001)}.stop`);
function stop() {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer); clearInterval(controlTimer);
    if (!child) { instanceGuard?.close(); return; }
    if (child.connected) child.send({ type: 'monimonitor:shutdown' });
    else child.kill('SIGTERM');
    forceTimer = setTimeout(() => child?.kill('SIGKILL'), 35000);
}
const minimumDelay = Math.max(250, Number(process.env.MONIMONITOR_RESTART_DELAY_MS) || 1000);
function launch() {
    if (stopping) return;
    child = spawn(process.execPath, [entry], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env: process.env, windowsHide: true });
    child.once('error', error => { console.error('[Supervisor] Could not start backend:', error.message); process.exitCode = 1; stopping = true; clearInterval(controlTimer); instanceGuard?.close(); });
    child.once('exit', (code, signal) => {
        child = null;
        if (stopping) { clearTimeout(forceTimer); instanceGuard?.close(); process.exitCode = code || 0; return; }
        crashes = crashes.filter(time => Date.now() - time < 60_000);
        crashes.push(Date.now());
        if (crashes.length >= 5) {
            console.error('[Supervisor] Five exits in one minute; stopping for operator intervention.');
            process.exitCode = 1; clearInterval(controlTimer); instanceGuard?.close(); return;
        }
        const delay = Math.min(30_000, minimumDelay * 2 ** (crashes.length - 1));
        console.error(`[Supervisor] Backend exited (${code ?? signal}); restarting in ${delay}ms.`);
        timer = setTimeout(launch, delay);
    });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
// Release controllers request a drain through a private local file rather than exposing an HTTP shutdown route.
async function start() {
    if (process.argv.includes('--agent')) { launch(); return; }
    const apiPort = Number(process.env.PORT || 3001);
    instanceGuard = await acquireInstance(Number(process.env.MONIMONITOR_INSTANCE_PORT || (apiPort + 10000)));
    await assertApiPortFree(apiPort);
    fs.rmSync(controlFile, { force: true });
    controlTimer = setInterval(() => { if (fs.existsSync(controlFile)) stop(); }, 250);
    controlTimer.unref();
    launch();
}
start().catch(error => { console.error('[Supervisor]', error.message); instanceGuard?.close(); clearInterval(controlTimer); process.exitCode = 1; });
