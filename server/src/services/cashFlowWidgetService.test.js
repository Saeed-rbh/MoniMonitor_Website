const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCashFlowWidgetPayload, transactionCalendarDate } = require('./cashFlowWidgetService');

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

test('reports investment contributions separately from portfolio value changes', () => {
    const payload = buildCashFlowWidgetPayload([
        {
            ...transaction('2026-09-01T11:37:28.000Z', 91082, 'Internal'),
            Account: 'S0K7',
            AccountFlow: 'NONE',
            PortfolioAction: 'TRANSFER',
            PortfolioAccountId: 10,
        },
        {
            ...transaction('2026-09-01T12:01:00.000Z', 1000, 'Investment'),
            Account: 'TFSA',
            AccountFlow: 'OUT',
            PortfolioAction: 'BUY',
            PortfolioAccountId: 10,
        },
    ], {
        accounts: [{ id: 10, name: 'TFSA', accountType: 'TFSA', totalValueMinor: 1050312 }],
    }, new Date('2026-09-01T18:00:00.000Z'));

    assert.equal(payload.investmentTotal, 910.82);
    assert.equal(payload.chartItems[0].investment, 910.82);
    assert.equal(payload.totalExpense, 0);
});

test('keeps midnight UTC transactions on their stored bank calendar date', () => {
    assert.deepEqual(transactionCalendarDate('2026-09-01T00:00:00.000Z'), {
        year: 2026, month: 8, day: 1,
    });

    const payload = buildCashFlowWidgetPayload([
        transaction('2026-09-01T00:00:00.000Z', 2259, 'Expense'),
        transaction('2026-09-01T00:00:00.000Z', 6950, 'Expense'),
        transaction('2026-09-01T00:00:00.000Z', 974, 'Expense'),
        transaction('2026-09-01T12:00:00.000Z', 1524, 'Income'),
    ], { accounts: [] }, new Date('2026-09-01T18:00:00.000Z'));

    assert.equal(payload.totalIncome, 15.24);
    assert.equal(payload.totalExpense, 101.83);
    assert.equal(payload.balance, -86.59);
    assert.equal(payload.chartItems[0].expense, 101.83);
});
