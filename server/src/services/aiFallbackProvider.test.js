const test = require('node:test');
const assert = require('node:assert/strict');
const { withFallback } = require('./aiFallbackProvider');
const { createProvider } = require('./aiProvider');

test('keeps successful Luna responses and falls back only after CLI errors', async () => {
    let fail = false, calls = 0;
    const request = { contents: 'data' };
    const provider = withFallback({ identity: 'codex-cli:gpt-6-luna', generate: async () => {
        if (fail) throw Error('CLI unavailable');
        return { text: '{"source":"cli"}' };
    } }, { identity: 'gemini:test', enabled: true, generate: async received => {
        assert.equal(received, request); calls++; return { text: '{"source":"api"}' };
    } });
    assert.equal((await provider.generate(request)).text, '{"source":"cli"}');
    assert.equal(calls, 0); fail = true;
    assert.equal((await provider.generate(request)).text, '{"source":"api"}');
    assert.equal(calls, 1);
});

test('does not call API for cancelled requests or unconfigured fallback', async () => {
    const error = Error('failed');
    for (const enabled of [true, false]) {
        const provider = withFallback({ generate: async () => { throw error; } }, {
            enabled, generate: () => assert.fail('must not call API'),
        });
        const controller = new AbortController(); if (enabled) controller.abort();
        await assert.rejects(provider.generate({ config: { abortSignal: controller.signal } }), e => e === error);
    }
});

test('factory requires explicit API fallback and advertises both providers', () => {
    const env = { AI_PROVIDER: 'codex-cli', AI_CODEX_MODEL: 'gpt-6-luna' };
    assert.equal(createProvider(env).identity, 'codex-cli:gpt-6-luna');
    assert.match(createProvider({ ...env, AI_FALLBACK_PROVIDER: 'gemini' }, { gemini: {} }).identity, /fallback:gemini:/);
    assert.throws(() => createProvider({ ...env, AI_FALLBACK_PROVIDER: 'codex-cli' }), /Unsupported/);
});

test('CLI timeout aborts the child and leaves the API fallback usable', async () => {
    let primarySignal;
    const provider = withFallback({ generate: request => {
        primarySignal = request.config.abortSignal;
        return new Promise(() => {});
    } }, { enabled: true, generate: async request => {
        assert.equal(primarySignal.aborted, true);
        assert.equal(request.config?.abortSignal?.aborted, undefined);
        return { text: '{}' };
    } }, 5);
    assert.deepEqual(await provider.generate({ contents: 'data' }), { text: '{}' });
});
