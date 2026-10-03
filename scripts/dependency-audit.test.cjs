const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAudit, exception } = require('./dependency-audit.cjs');
function fixture() {
    return { report: { auditReportVersion: 2, metadata: { vulnerabilities: { total: 2 } }, vulnerabilities: {
        braces: { nodes: ['node_modules/braces'], fixAvailable: false,
            via: [{ name: 'braces', url: exception.advisory, range: '<=3.0.3' }] },
        tailwindcss: { nodes: ['node_modules/tailwindcss'], via: ['braces'] },
    } }, lock: { packages: { 'node_modules/braces': { dev: true }, 'node_modules/tailwindcss': { dev: true } } } };
}
const now = new Date('2026-10-03');
test('allows only the known advisory and its build-only dependency chain', () => {
    const { report, lock } = fixture();
    assert.deepEqual(evaluateAudit(report, lock, now), { accepted: ['braces', 'tailwindcss'], blocked: [] });
});
test('blocks a new advisory even on an excepted package', () => {
    const { report, lock } = fixture();
    report.vulnerabilities.braces.via.push({ name: 'braces', url: 'https://github.com/advisories/NEW' });
    assert.equal(evaluateAudit(report, lock, now).blocked.length, 2);
});
test('accepts the npm Node 24 report suggesting a major Tailwind migration', () => {
    const { report, lock } = fixture();
    report.vulnerabilities.braces.fixAvailable = { name: 'tailwindcss', version: '4.3.3', isSemVerMajor: true };
    assert.equal(evaluateAudit(report, lock, now).blocked.length, 0);
    report.vulnerabilities.braces.fixAvailable = { name: 'braces', version: '3.0.4', isSemVerMajor: false };
    assert.equal(evaluateAudit(report, lock, now).blocked.length, 2);
});
test('blocks runtime dependency paths', () => {
    const { report, lock } = fixture();
    lock.packages['node_modules/braces'].dev = false;
    assert.equal(evaluateAudit(report, lock, now).blocked.length, 2);
});
test('expires the exception and refuses to suppress an available patch', () => {
    const { report, lock } = fixture();
    assert.equal(evaluateAudit(report, lock, new Date(exception.expires)).blocked.length, 2);
    report.vulnerabilities.braces.fixAvailable = true;
    assert.equal(evaluateAudit(report, lock, now).blocked.length, 2);
});
test('fails closed on audit service errors and dependency cycles', () => {
    const { report, lock } = fixture();
    assert.throws(() => evaluateAudit({ error: {} }, lock, now));
    report.vulnerabilities.braces.via = ['tailwindcss'];
    assert.equal(evaluateAudit(report, lock, now).blocked.length, 2);
});
