const test = require('node:test');
const assert = require('node:assert/strict');
const { ALL_LABELS, CATEGORY_LABELS } = require('./transactionCategories');

test('defines the requested five category groups and 44 unique labels', () => {
    assert.deepEqual(Object.keys(CATEGORY_LABELS), [
        'Expense', 'Income', 'Internal', 'Investment', 'Saving',
    ]);
    assert.equal(ALL_LABELS.length, 44);
    assert.equal(new Set(ALL_LABELS).size, 44);
    assert.deepEqual(CATEGORY_LABELS.Internal, ['Internal Transfer']);
    assert.deepEqual(CATEGORY_LABELS.Saving, ['Crypto Funding', 'Savings Contributions']);
});
