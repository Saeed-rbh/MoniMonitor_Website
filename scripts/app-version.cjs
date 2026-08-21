const path = require('path');
const { execFileSync } = require('child_process');
const versionBase = require('../app-version.json');

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

function getAutomaticPatch() {
    const baseline = versionBase.baselineCommit;
    if (!baseline) return Number(versionBase.patch) || 0;

    // Verify the baseline exists, then count commits made after that release.
    if (!git('cat-file', '-t', baseline)) return Number(versionBase.patch) || 0;

    const count = Number(git('rev-list', '--count', `${baseline}..HEAD`));
    return (Number(versionBase.patch) || 0) + (Number.isFinite(count) ? count : 0);
}

function getAppVersion() {
    return `${versionBase.major}.${versionBase.minor}.${getAutomaticPatch()}`;
}

module.exports = { getAppVersion };
