const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { createRateLimit } = require('./rateLimit');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-rate-limit-'));
let first, second;
test.before(async () => {
  first = await open({ filename: path.join(directory, 'limits.sqlite'), driver: sqlite3.Database });
  second = await open({ filename: path.join(directory, 'limits.sqlite'), driver: sqlite3.Database });
  await first.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE rate_limits (bucketKey TEXT PRIMARY KEY, count INTEGER NOT NULL, startedAt INTEGER NOT NULL)');
  await second.exec('PRAGMA busy_timeout = 5000');
});
test.after(async () => { await first.close(); await second.close(); fs.rmSync(directory, { recursive: true, force: true }); });

async function request(limiter, ip = '203.0.113.4') {
  const response = { statusCode: 200, headers: {}, passed: false,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  await limiter({ ip }, response, () => { response.passed = true; });
  return response;
}

test('concurrent requests across SQLite connections allow exactly the configured maximum', async () => {
  const policies = [first, second].map((db) => createRateLimit({ windowMs: 1000, max: 10, namespace: 'concurrent' },
    { database: async () => db, clock: () => 1000 }));
  const responses = await Promise.all(Array.from({ length: 40 }, (_, index) => request(policies[index % 2])));
  assert.equal(responses.filter((response) => response.passed).length, 10);
  assert.equal(responses.filter((response) => response.statusCode === 429).length, 30);
  assert.ok(responses.filter((response) => !response.passed).every((response) => response.headers['Retry-After'] === '1'));
  const record = await first.get("SELECT count, bucketKey FROM rate_limits WHERE bucketKey LIKE 'concurrent:%'");
  assert.equal(record.count, 11);
  assert.ok(!record.bucketKey.includes('203.0.113.4'));
});

test('limits persist across middleware recreation and reset only when the window expires', async () => {
  let now = 1000;
  const build = () => createRateLimit({ windowMs: 1000, max: 1, namespace: 'restart' }, { database: async () => first, clock: () => now });
  assert.equal((await request(build())).passed, true);
  now = 1999;
  assert.equal((await request(build())).statusCode, 429);
  now = 2000;
  const reset = await request(build());
  assert.equal(reset.passed, true);
  assert.equal(reset.headers['RateLimit-Remaining'], '0');
});

test('separate client identities and policy namespaces cannot consume each other’s buckets', async () => {
  const build = (namespace) => createRateLimit({ windowMs: 1000, max: 1, namespace }, { database: async () => first, clock: () => 3000 });
  const auth = build('auth');
  assert.equal((await request(auth, '198.51.100.1')).passed, true);
  assert.equal((await request(auth, '198.51.100.1')).statusCode, 429);
  assert.equal((await request(auth, '198.51.100.2')).passed, true);
  assert.equal((await request(build('ai'), '198.51.100.1')).passed, true);
});

test('storage failures fail closed with a retryable 503', async () => {
  const limiter = createRateLimit({ windowMs: 1000, max: 1 }, { database: async () => { throw new Error('storage unavailable'); } });
  const response = await request(limiter);
  assert.equal(response.passed, false);
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['Retry-After'], '5');
  assert.ok(!response.body.error.includes('storage unavailable'));
});

test('prunes expired buckets while retaining active policies', async () => {
  await first.run("INSERT INTO rate_limits VALUES ('old', 1, 0)");
  const limiter = createRateLimit({ windowMs: 1000, max: 2, namespace: 'cleanup' }, { database: async () => first, clock: () => 90_000_000 });
  assert.equal((await request(limiter)).passed, true);
  assert.equal(await first.get("SELECT * FROM rate_limits WHERE bucketKey = 'old'"), undefined);
  assert.equal((await request(limiter)).passed, true);
});
