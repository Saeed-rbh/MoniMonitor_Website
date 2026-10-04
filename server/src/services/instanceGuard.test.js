const test = require('node:test');
const assert = require('node:assert/strict');
const { acquireInstance, assertApiPortFree } = require('./instanceGuard');
test('only one supervisor can hold the lock and it can be reacquired after shutdown', async () => {
    const first = await acquireInstance(0);
    const port = first.address().port;
    try {
        await assert.rejects(acquireInstance(port), /Another backend supervisor/);
        await assert.rejects(assertApiPortFree(port), /API already owns/);
    } finally { await new Promise(resolve => first.close(resolve)); }
    await assertApiPortFree(port);
    const replacement = await acquireInstance(port);
    await new Promise(resolve => replacement.close(resolve));
});
