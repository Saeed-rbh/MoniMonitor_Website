const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMonthlyAnalysis } = require('./monthlyInsightService');

const tx = (id, month, day, amountMinor, Category, Label, Reason = Label, extra = {}) => ({
    id, AmountMinor: amountMinor, Amount: amountMinor / 100, Category, Label, Reason,
    Timestamp: `${month}-${String(day).padStart(2, '0')}T12:00:00.000Z`, Frequency: 'OneTime', ...extra,
});

test('builds verified monthly facts and excludes internal transfers from cash flow', () => {
    const transactions = [
        tx(1, '2026-08', 10, 300000, 'Income', 'Employment Income'),
        tx(2, '2026-08', 11, 4000, 'Expense', 'Dining', 'Tim Hortons'),
        tx(3, '2026-08', 12, 100000, 'Internal', 'Internal Transfer'),
        tx(4, '2026-08', 12, 25000, 'Saving', 'Savings Contributions', 'TFSA contribution', { Account: 'TFSA' }),
        tx(5, '2026-07', 10, 3000, 'Expense', 'Dining'),
        tx(6, '2026-06', 10, 2000, 'Expense', 'Dining'),
    ];
    const analysis = buildMonthlyAnalysis(transactions, '2026-08');
    assert.equal(analysis.summary.incomeMinor, 300000);
    assert.equal(analysis.summary.expenseMinor, 4000);
    assert.equal(analysis.summary.netCashFlowMinor, 296000);
    assert.equal(analysis.summary.savingMinor, 25000);
    assert.ok(analysis.candidates.some((candidate) => candidate.id === 'contributions'));
    assert.ok(analysis.candidates.every((candidate) => !candidate.fact.includes('$1,000.00')));
});

test('gates AI ranking when pending email data makes the month incomplete', () => {
    const analysis = buildMonthlyAnalysis([
        tx(1, '2026-08', 10, 1000, 'Expense', 'Dining'),
    ], '2026-08', { pendingEmails: 2 });
    assert.equal(analysis.dataQuality.status, 'review');
    assert.deepEqual(analysis.dataQuality.issues, ['2 emails awaiting processing']);
});

test('compares spending at the same point in prior months', () => {
    const analysis = buildMonthlyAnalysis([
        tx(1, '2026-08', 5, 10000, 'Expense', 'Shopping'),
        tx(2, '2026-07', 5, 5000, 'Expense', 'Shopping'),
        tx(3, '2026-07', 20, 90000, 'Expense', 'Travel'),
    ], '2026-08');
    const pace = analysis.candidates.find((candidate) => candidate.id === 'spending-pace');
    assert.match(pace.fact, /100% above/);
    assert.doesNotMatch(pace.fact, /950\.00/);
});
