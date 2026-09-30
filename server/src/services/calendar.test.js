const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTimestamp, calendarDate, addCalendarDays, validMonth } = require('../../../shared/calendar.cjs');
const { parseTransaction, transactionUpdateSchema } = require('../validation/transaction');
const { buildDailyExpenseSeries } = require('./timesFmForecastService');
const { buildMonthlyAnalysis } = require('./monthlyInsightService');

test('rejects impossible dates, clock values, offsets and invalid reporting months', () => {
    for (const value of ['2026-02-30', '2026-13-01', '2026-00-01', '2026-01-00', '2026-01-01T24:01:00Z',
        '2026-01-01T12:60:00Z', '2026-01-01T12:00:00+14:01', '', 'not-a-date']) {
        assert.equal(parseTimestamp(value), null, value);
        assert.throws(() => parseTransaction({ Amount: 1, Category: 'Expense', Timestamp: value }));
        assert.throws(() => transactionUpdateSchema.parse({ Timestamp: value }));
    }
    assert.equal(validMonth('2026-13'), false);
    assert.equal(validMonth('2026-00'), false);
    assert.equal(validMonth('2026-09'), true);
    assert.equal(calendarDate('2024-02-29'), '2024-02-29');
});

test('preserves statement dates for explicit offsets, midnight UTC and legacy wall times', () => {
    for (const value of ['2026-09-01T00:30:00+14:00', '2026-09-01T23:30:00-12:00',
        '2026-09-01T00:00:00.000Z', '2026-09-01 14:25']) {
        assert.equal(calendarDate(value), '2026-09-01');
    }
});

test('forecast calendar stepping stays stable through daylight saving and month boundaries', () => {
    assert.equal(addCalendarDays('2026-03-08', 1), '2026-03-09');
    assert.equal(addCalendarDays('2026-11-01', 1), '2026-11-02');
    assert.equal(addCalendarDays('2026-12-31', 1), '2027-01-01');
    const series = buildDailyExpenseSeries([{ AmountMinor: 100, Category: 'Expense', Timestamp: '2026-03-07T23:30:00-12:00' },
        { AmountMinor: 200, Category: 'Expense', Timestamp: '2026-03-10T00:30:00+14:00' }]);
    assert.deepEqual(series.values, [1, 0, 0, 2]);
});

test('monthly comparisons use the statement day instead of the UTC instant', () => {
    const analysis = buildMonthlyAnalysis([
        { id: 1, Timestamp: '2026-09-01T00:30:00+14:00', AmountMinor: 1000, Category: 'Expense', Label: 'Shopping' },
        { id: 2, Timestamp: '2026-08-01T23:30:00-12:00', AmountMinor: 500, Category: 'Expense', Label: 'Shopping' },
    ], '2026-09');
    assert.equal(analysis.latestDay, 1);
    assert.match(analysis.candidates.find((candidate) => candidate.id === 'spending-pace').fact, /100% above/);
});
