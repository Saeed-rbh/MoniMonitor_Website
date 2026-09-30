const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { getAppVersion } = require('../../../scripts/app-version.cjs');

const repository = path.resolve(__dirname, '../../..');
function git(...args) {
    try {
        return execFileSync('git', ['-C', repository, ...args], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
        }).trim();
    } catch { return ''; }
}

function captureRuntimeVersion(readGit = git, readVersion = getAppVersion) {
    const commit = readGit('rev-parse', 'HEAD');
    return Object.freeze({
        version: commit ? readVersion(commit) : null,
        commit: /^[a-f0-9]{40,64}$/i.test(commit) ? commit : null,
        shortCommit: /^[a-f0-9]{40,64}$/i.test(commit) ? commit.slice(0, 7) : null,
        startedAt: new Date().toISOString(),
        localChanges: commit ? Boolean(readGit('status', '--porcelain', '--untracked-files=no')) : null,
    });
}

// Capture once: checking out a newer commit does not update this process.
const runtimeVersion = captureRuntimeVersion();
module.exports = { runtimeVersion, captureRuntimeVersion };
