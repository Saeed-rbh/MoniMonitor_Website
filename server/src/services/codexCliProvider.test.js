const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const { createCodexCliProvider } = require('./codexCliProvider');

test('uses isolated ChatGPT CLI, stdin, validated output and removes temporary files', async () => {
    let directory, input = '', calls = 0;
    const provider = createCodexCliProvider({ AI_CODEX_CLI: 'C:/Program Files/codex.exe', OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret' }, {
        spawnImpl(command, args, options) {
            assert.equal(command, 'C:/Program Files/codex.exe');
            assert.equal(options.shell, false);
            assert.equal(options.env.OPENAI_API_KEY, undefined);
            assert.equal(options.env.CODEX_API_KEY, undefined);
            directory = options.cwd;
            const child = new EventEmitter();
            child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
            child.stdin.on('data', chunk => { input += chunk; });
            process.nextTick(() => {
                if (calls++ === 0) child.stdout.end('Logged in using ChatGPT');
                else {
                    assert.ok(args.includes('--ignore-user-config'));
                    assert.ok(args.includes('forced_login_method="chatgpt"'));
                    assert.ok(args.includes('read-only'));
                    fs.writeFileSync(args[args.indexOf('-o') + 1], '{"ok":true}');
                }
                child.emit('close', 0);
            });
            return child;
        },
    });
    assert.deepEqual(await provider.generate({ contents: 'private email', config: {} }), { text: '{"ok":true}' });
    assert.match(input, /private email/);
    assert.equal(fs.existsSync(directory), false);
});

test('rejects pre-aborted calls and removes the workspace', async () => {
    const controller = new AbortController(); controller.abort();
    const provider = createCodexCliProvider({}, { spawnImpl() { assert.fail('must not spawn'); } });
    await assert.rejects(provider.generate({ contents: '', config: { abortSignal: controller.signal } }), { code: 'AI_TIMEOUT' });
});

for (const scenario of ['api-login', 'exit-failure', 'invalid-json']) {
    test(`rejects ${scenario} without falling back or retaining private output`, async () => {
        let calls = 0, directory;
        const provider = createCodexCliProvider({}, { spawnImpl(command, args, options) {
            directory = options.cwd;
            const child = new EventEmitter();
            child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
            process.nextTick(() => {
                if (calls++ === 0) {
                    child.stdout.end(scenario === 'api-login' ? 'Logged in using an API key' : 'Logged in using ChatGPT');
                    child.emit('close', 0);
                } else {
                    fs.writeFileSync(args[args.indexOf('-o') + 1], 'not json');
                    child.emit('close', scenario === 'exit-failure' ? 1 : 0);
                }
            });
            return child;
        } });
        await assert.rejects(provider.generate({ contents: 'private data', config: {} }));
        assert.equal(calls, scenario === 'api-login' ? 1 : 2);
        assert.equal(fs.existsSync(directory), false);
    });
}

for (const result of [{ Amount: '10.00', Evidence: { Amount: '$10.00' } }, { error: 'Not a bank email' }, null]) {
    test(`enforces an output schema and unwraps ${result === null ? 'invalid envelopes safely' : Object.keys(result)[0]}`, async () => {
        const schema = require('./extractionEvidence').RESPONSE_SCHEMA;
        let directory;
        const provider = createCodexCliProvider({}, { spawnImpl(command, args, options) {
            directory = options.cwd;
            const child = new EventEmitter();
            child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
            process.nextTick(() => {
                if (args[0] === 'login') child.stdout.end('Logged in using ChatGPT');
                else {
                    const outputSchema = JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
                    assert.equal(outputSchema.type, 'object');
                    assert.deepEqual(outputSchema.required, ['result']);
                    assert.equal(outputSchema.additionalProperties, false);
                    assert.deepEqual(outputSchema.properties.result, schema);
                    fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(result === null ? {} : { result }));
                }
                child.emit('close', 0);
            });
            return child;
        } });
        const request = { contents: 'email', config: { responseJsonSchema: schema } };
        if (result === null) await assert.rejects(provider.generate(request), { code: 'AI_CODEX_INVALID_OUTPUT' });
        else assert.deepEqual(JSON.parse((await provider.generate(request)).text), result);
        assert.equal(fs.existsSync(directory), false);
    });
}
