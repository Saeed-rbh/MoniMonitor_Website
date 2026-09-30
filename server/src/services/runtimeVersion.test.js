const test = require('node:test');
const assert = require('node:assert/strict');
const { captureRuntimeVersion } = require('./runtimeVersion');

test('running identity remains fixed after the checkout advances', () => {
    let commit = '5eaf95030cf9f548fd53daeb3bc014c333ae0f32';
    let versionRef;
    const snapshot = captureRuntimeVersion((command) => command === 'rev-parse' ? commit : ' M server/index.js',
        ref => { versionRef = ref; return '1.0.76'; });
    assert.equal(versionRef, commit);
    commit = '39399c8b81ca8b404670994b0c1c4edf5e8d45d2';
    assert.equal(snapshot.shortCommit, '5eaf950');
    assert.equal(snapshot.version, '1.0.76');
    assert.equal(snapshot.localChanges, true);
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Number.isFinite(Date.parse(snapshot.startedAt)));
});

test('missing Git metadata reports unknown identity rather than a guessed version', () => {
    const snapshot = captureRuntimeVersion(() => '', () => { throw new Error('must not guess'); });
    assert.equal(snapshot.version, null);
    assert.equal(snapshot.commit, null);
    assert.equal(snapshot.shortCommit, null);
    assert.equal(snapshot.localChanges, null);
});
