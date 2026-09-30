const { spawn } = require('node:child_process');
const path = require('node:path');
const entry = path.join(__dirname, '..', process.argv.includes('--agent') ? 'email_agent.js' : 'index.js');
let child, timer, stopping = false;
let crashes = [];
const minimumDelay = Math.max(250, Number(process.env.MONIMONITOR_RESTART_DELAY_MS) || 1000);
function launch() {
    if (stopping) return;
    child = spawn(process.execPath, [entry], { stdio: 'inherit', env: process.env, windowsHide: true });
    child.once('error', error => { console.error('[Supervisor] Could not start backend:', error.message); process.exitCode = 1; stopping = true; });
    child.once('exit', (code, signal) => {
        child = null;
        if (stopping) { process.exitCode = code || 0; return; }
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
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    stopping = true; clearTimeout(timer); child?.kill(signal);
});
launch();
