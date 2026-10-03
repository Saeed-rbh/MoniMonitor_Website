const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const exception = {
    advisory: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
    expires: '2026-11-03T00:00:00.000Z',
};

function evaluateAudit(report, lock, now = new Date()) {
    if (report.error || report.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata?.vulnerabilities) {
        throw new Error('Dependency audit did not return a valid report');
    }
    const vulnerabilities = report.vulnerabilities;
    function excepted(name, visited = new Set()) {
        const item = vulnerabilities[name];
        if (!item || visited.has(name) || now >= new Date(exception.expires)) return false;
        if (!item.nodes?.length || !item.nodes.every(node => lock.packages?.[node]?.dev === true)) return false;
        if (!item.via?.length) return false;
        const next = new Set([...visited, name]);
        return item.via.every(via => typeof via === 'string' ? excepted(via, next) :
            via.name === 'braces' && via.url === exception.advisory && via.range === '<=3.0.3' &&
            item.fixAvailable === false);
    }
    const accepted = [], blocked = [];
    for (const name of Object.keys(vulnerabilities)) (excepted(name) ? accepted : blocked).push(name);
    if (!Object.keys(vulnerabilities).length && report.metadata.vulnerabilities.total !== 0) {
        throw new Error('Dependency audit summary disagrees with its findings');
    }
    return { accepted, blocked };
}

function main() {
    const npmCli = process.env.npm_execpath;
    if (!npmCli || !fs.existsSync(npmCli)) throw new Error('Run this audit through npm');
    const cwd = path.resolve(process.argv[2] || '.');
    const result = spawnSync(process.execPath, [npmCli, 'audit', '--include=dev', '--json'],
        { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (result.error || result.signal || ![0, 1].includes(result.status)) throw new Error('Dependency audit failed to execute');
    const report = JSON.parse(result.stdout);
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, 'package-lock.json'), 'utf8'));
    const { accepted, blocked } = evaluateAudit(report, lock);
    console.log(`Dependency audit: ${blocked.length} blocking packages, ${accepted.length} excepted build-only packages.`);
    if (accepted.length) console.log(`Temporary exception ${exception.advisory}, expires ${exception.expires}: ${accepted.join(', ')}`);
    if (blocked.length) {
        console.error(JSON.stringify(Object.fromEntries(blocked.map(name => [name, report.vulnerabilities[name]])), null, 2));
        process.exitCode = 1;
    }
}
if (require.main === module) {
    try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { evaluateAudit, exception };
