const test = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('./logger');

test('redacts sensitive structured log fields recursively', () => {
    const result = redact({ authorization: 'Bearer secret', nested: { password: 'nope' }, safe: 'ok' });
    assert.deepEqual(result, { authorization: '[REDACTED]', nested: { password: '[REDACTED]' }, safe: 'ok' });
});
