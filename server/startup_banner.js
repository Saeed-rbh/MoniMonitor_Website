const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repository = path.resolve(__dirname, '..');

function git(...args) {
    try {
        return execFileSync('git', ['-C', repository, ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return '';
    }
}

function readUpdateReceipt(currentCommit) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const stateDirectory = path.join(localAppData, 'MoniMonitor');
    const receiptPath = path.join(stateDirectory, 'last-update.json');

    try {
        const json = fs.readFileSync(receiptPath, 'utf8').replace(/^\uFEFF/, '');
        const receipt = JSON.parse(json);
        return receipt.toCommit === currentCommit ? receipt : null;
    } catch {
        // The updater version that installs this feature cannot write the new
        // receipt yet, but its existing log still records the same transition.
        try {
            const lines = fs.readFileSync(path.join(stateDirectory, 'auto-update.log'), 'utf8').split(/\r?\n/).reverse();
            for (const line of lines) {
                const match = line.match(/^\[([^\]]+)] Updated repository from ([0-9a-f]+) to ([0-9a-f]+)\.$/i);
                if (match?.[3] === currentCommit) {
                    return { receivedAt: match[1], fromCommit: match[2], toCommit: match[3] };
                }
            }
        } catch {
            // Update history is optional on a first or manually started run.
        }
        return null;
    }
}

const commit = git('rev-parse', 'HEAD');
const shortCommit = git('rev-parse', '--short=12', 'HEAD');
const commitTime = git('show', '-s', '--format=%cI', 'HEAD');
const subject = git('show', '-s', '--format=%s', 'HEAD');
const updateReceipt = readUpdateReceipt(commit);
const startedAt = new Date().toISOString();

console.log('');
console.log('='.repeat(72));
console.log('MoniMonitor backend version');
console.log(`Push ID:          ${shortCommit || commit || 'unknown'}`);
if (commit && commit !== shortCommit) console.log(`Full commit:      ${commit}`);
if (subject) console.log(`Commit:           ${subject}`);
if (commitTime) console.log(`Commit time:      ${commitTime}`);
console.log(`Backend started:  ${startedAt}`);
if (updateReceipt) {
    console.log(`Update received:  ${updateReceipt.receivedAt}`);
    console.log(`Updated from:     ${String(updateReceipt.fromCommit || 'unknown').slice(0, 12)}`);
}
console.log('='.repeat(72));
console.log('');
