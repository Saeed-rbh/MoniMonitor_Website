const test = require('node:test');
const assert = require('node:assert/strict');
const { setBrowserSession, requestSession } = require('./browserSession');
const request = (headers = {}, method = 'POST') => ({ headers, method, secure: true,
    get(name) { return headers[name.toLowerCase()]; } });
test('production browser sessions cannot be read by scripts or set for a broader domain', () => {
    const saved = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
    try {
        let cookie;
        const result = setBrowserSession(request({ 'x-session-mode': 'cookie' }), { cookie: (...args) => { cookie = args; } },
            { accessToken: 'private-token', expiresAt: Date.now() + 30000 });
        assert.equal(result.accessToken, undefined);
        assert.equal(cookie[0], '__Host-monimonitor');
        assert.equal(cookie[2].secure, true); assert.equal(cookie[2].httpOnly, true);
        assert.equal(cookie[2].domain, undefined); assert.equal(cookie[2].path, '/');
    } finally { if (saved === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved; }
});
test('cookie authentication rejects missing and null origins while explicit bearer clients remain supported', () => {
    const allowed = ['https://app.example.com'];
    assert.equal(requestSession(request({ cookie: 'monimonitor_session=private' }), allowed).forbidden, true);
    assert.equal(requestSession(request({ cookie: 'monimonitor_session=private', origin: 'null' }), allowed).forbidden, true);
    assert.equal(requestSession(request({ cookie: 'monimonitor_session=private', origin: allowed[0] }), allowed).token, 'private');
    assert.equal(requestSession(request({ authorization: 'Bearer cli-token' }), allowed).token, 'cli-token');
});
