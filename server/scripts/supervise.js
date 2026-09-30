const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const entry = path.join(__dirname, '..', process.argv.includes('--agent') ? 'email_agent.js' : 'index.js');
let child, timer, stopping = false;
let crashes = [];
let forceTimer, controlTimer;
function stop() {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer); clearInterval(controlTimer);
    if (!child) return;
    if (child.connected) child.send({ type: 'monimonitor:shutdown' });
    else child.kill('SIGTERM');
    forceTimer = setTimeout(() => child?.kill('SIGKILL'), 35000);
}
const minimumDelay = Math.max(250, Number(process.env.MONIMONITOR_RESTART_DELAY_MS) || 1000);
function launch() {
    if (stopping) return;
    child = spawn(process.execPath, [entry], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env: process.env, windowsHide: true });
    child.once('error', error => { console.error('[Supervisor] Could not start backend:', error.message); process.exitCode = 1; stopping = true; });
    child.once('exit', (code, signal) => {
        child = null;
        if (stopping) { clearTimeout(forceTimer); process.exitCode = code || 0; return; }
        crashes = crashes.filter(time => Date.now() - time < 60_000);
        crashes.push(Date.now());
        if (crashes.length >= 5) {
            console.error('[Supervisor] Five exits in one minute; stopping for operator intervention.');
            process.exitCode = 1; return;
        }
        const delay = Math.min(30_000, minimumDelay * 2 ** (crashes.length - 1));
        console.error(`[Supervisor] Backend exited (${code ?? signal}); restarting in ${delay}ms.`);
        timer = setTimeout(launch, delay);
    });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
// Release controllers request a drain through a private local file rather than exposing an HTTP shutdown route.
if (process.env.MONIMONITOR_CONTROL_FILE) {
    controlTimer = setInterval(() => { if (fs.existsSync(process.env.MONIMONITOR_CONTROL_FILE)) stop(); }, 250);
    controlTimer.unref();
}
launch();
