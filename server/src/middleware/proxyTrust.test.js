const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { proxyTrust } = require('./proxyTrust');

test('proxy trust defaults to loopback and rejects unrestricted or hop-count settings', () => {
  assert.deepEqual(proxyTrust({}), ['loopback']);
  assert.equal(proxyTrust({ TRUSTED_PROXIES: 'false' }), false);
  assert.deepEqual(proxyTrust({ TRUSTED_PROXIES: '192.0.2.1, 2001:db8::/64' }), ['192.0.2.1', '2001:db8::/64']);
  for (const value of ['true', '1', '', '0.0.0.0/0', '::/0', '192.0.2.1/33', 'unknown']) {
    assert.throws(() => proxyTrust({ TRUSTED_PROXIES: value }), /TRUSTED_PROXIES/);
  }
});

async function inspectHeaders(t, trusted) {
  const app = express();
  app.set('trust proxy', trusted);
  app.get('/', (req, res) => res.json({ ip: req.ip, secure: req.secure }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return (await fetch(`http://127.0.0.1:${server.address().port}`, { headers: {
    'X-Forwarded-For': '198.51.100.7', 'X-Forwarded-Proto': 'https',
  } })).json();
}

test('untrusted peers cannot spoof client identity or HTTPS using forwarded headers', async (t) => {
  assert.deepEqual(await inspectHeaders(t, proxyTrust({ TRUSTED_PROXIES: '192.0.2.1' })), { ip: '127.0.0.1', secure: false });
});

test('configured local reverse proxy supplies the client identity and HTTPS protocol', async (t) => {
  assert.deepEqual(await inspectHeaders(t, proxyTrust({})), { ip: '198.51.100.7', secure: true });
});
