const assert = require('node:assert/strict');
const test = require('node:test');
const { runStartupMaintenance } = require('./startupMaintenance');

test('startup maintenance never deletes financial history', async () => {
    const statements = [];
    const db = {
        run: async (sql, params) => {
            statements.push({ sql, params });
        },
    };

    await runStartupMaintenance(db, Date.parse('2026-08-20T12:00:00.000Z'));

    assert.equal(statements.length, 1);
    assert.match(statements[0].sql, /^DELETE FROM processed_emails/);
    assert.doesNotMatch(statements[0].sql, /transactions|accounts|holdings|merchant_rules/i);
    assert.deepEqual(statements[0].params, ['2026-05-22T12:00:00.000Z']);
});
