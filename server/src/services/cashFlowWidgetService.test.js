const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCashFlowWidgetPayload } = require('./cashFlowWidgetService');

const transaction = (Timestamp, AmountMinor, Category) => ({
    Timestamp,
    AmountMinor,
    Amount: AmountMinor / 100,
    Category,
});

test('builds a compact current-month widget payload', () => {
    const payload = buildCashFlowWidgetPayload([
        transaction('2026-08-10T12:00:00.000Z', 300000, 'Income'),
        transaction('2026-08-11T12:00:00.000Z', 4000, 'Expense'),
        transaction('2026-07-10T12:00:00.000Z', 200000, 'Income'),
        transaction('2026-07-11T12:00:00.000Z', 4000, 'Expense'),
    ], { accounts: [] }, new Date('2026-08-24T12:00:00.000Z'));

    assert.equal(payload.totalIncome, 3000);
    assert.equal(payload.totalExpense, 40);
    assert.equal(payload.balance, 2960);
    assert.equal(payload.percentageChange, 51);
    assert.equal(payload.chartItems.length, 12);
    assert.equal(payload.chartItems.at(-1).day, '24');
    assert.equal(payload.chartItems.at(-1).active, true);
    assert.ok(payload.maxChartTotal >= 1);
});

