const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli || !fs.existsSync(npmCli)) {
    console.error('Run this verifier with npm run check.');
    process.exit(1);
}

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-check-'));
const checks = [
    { name: 'Frontend types', args: ['run', 'typecheck'] },
    { name: 'Frontend tests', args: ['test', '--', '--run'], env: { NODE_ENV: 'test' } },
    { name: 'Production build', args: ['run', 'build'], env: { NODE_ENV: 'production' } },
    { name: 'Backend tests', args: ['test'], cwd: path.join(root, 'server'), env: {
        NODE_ENV: 'test', AI_INGESTION_ENABLED: 'false',
        MONIMONITOR_DB_PATH: path.join(testDirectory, 'fallback.sqlite'),
        MONIMONITOR_BACKUP_DIR: path.join(testDirectory, 'backups'),
    } },
    { name: 'Frontend dependency audit', args: ['audit', '--include=dev'] },
    { name: 'Backend dependency audit', args: ['audit', '--include=dev'], cwd: path.join(root, 'server') },
];

let exitCode = 0;
try {
    for (const check of checks) {
        console.log(`\nChecking: ${check.name}`);
        const result = spawnSync(process.execPath, [npmCli, ...check.args], {
            cwd: check.cwd || root, stdio: 'inherit',
            env: { ...process.env, ...check.env },
        });
        if (result.error || result.signal || result.status !== 0) {
            console.error(`${check.name} failed${result.error ? `: ${result.error.message}` : ''}.`);
            exitCode = result.status || 1;
            break;
        }
    }
} finally {
    fs.rmSync(testDirectory, { recursive: true, force: true });
}
process.exitCode = exitCode;
