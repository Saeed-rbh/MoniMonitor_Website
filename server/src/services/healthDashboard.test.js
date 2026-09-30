const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('dashboard shows the reported running version and handles older backends', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../../MoniMonitor_HealthDashboard.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nfetchAll\(\);(?=\r?\nsetInterval)/, '');
    const version = { textContent: '', title: '', addEventListener: () => {} };
    const context = vm.createContext({
        window: { location: { protocol: 'http:', origin: 'http://localhost:3001', pathname: '/' } },
        document: { getElementById: () => version }, Date, setInterval: () => {},
    });
    vm.runInContext(script, context);
    vm.runInContext("showRunningVersion({ version: '1.0.76', shortCommit: '5eaf950', commit: '5eaf950full', localChanges: false })", context);
    assert.equal(version.textContent, 'Running backend: v1.0.76 · 5eaf950');
    assert.equal(version.title, '5eaf950full');
    vm.runInContext("showRunningVersion({ version: '1.0.76', shortCommit: '5eaf950', localChanges: true })", context);
    assert.match(version.textContent, /local changes at startup/);
    vm.runInContext('showRunningVersion(undefined)', context);
    assert.match(version.textContent, /unavailable.*restart/);
    assert.equal(version.title, '');
    const rendered = vm.runInContext("m('<img src=x onerror=alert(1)>', '<script>alert(1)</script>')", context);
    assert.ok(!rendered.includes('<script>')); assert.ok(!rendered.includes('<img '));
    assert.ok(rendered.includes('&lt;script&gt;'));
});
