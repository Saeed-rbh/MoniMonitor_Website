const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-financial-consistency-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
const service = require('../database/dbService');
const { buildMonthlyAnalysis } = require('./monthlyInsightService');
const { buildCashFlowWidgetPayload } = require('./cashFlowWidgetService');
const { buildDailyExpenseSeries } = require('./timesFmForecastService');
const { toMinorUnits } = require('../../../shared/financialSemantics.cjs');
let db;
test.before(async () => { db = await service.getDb(); await service.createUser('owner', 'consistency-owner', 'unused'); });
test.after(async () => { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('summary, AI facts, widget and forecast agree despite conflicting type and category', async () => {
  const input = [
    { Amount: 0.1, Category: 'Expense', Label: 'Groceries' },
    { Amount: 0.2, Category: 'Expense', Label: 'Groceries' },
    { Amount: 10, Category: 'Expense', Type: 'Credit', Label: 'Shopping' },
    { Amount: 100, Category: 'Internal', Type: 'Credit', Label: 'Internal Transfer' },
    { Amount: 200, Category: 'Investment', Type: 'Debit', Label: 'ETF & Stock Purchase' },
    { Amount: 3, Category: 'Income', Type: 'Debit', Label: 'Refunds & Reversals' },
    { Amount: 1.23, Category: 'Expense', Reason: 'Refund received', Label: 'Other Expense' },
  ];
  for (const row of input) await service.addTransaction({ ...row, userId: 'owner', Timestamp: '2026-09-10' });
  const transactions = await service.getAllTransactionsForUser('owner');
  const summary = await service.getSummaryForUser('owner');
  const ai = buildMonthlyAnalysis(transactions, '2026-09');
  const widget = buildCashFlowWidgetPayload(transactions, { accounts: [] }, new Date(2026, 8, 10));
  const forecast = buildDailyExpenseSeries(transactions);
  assert.equal(summary.totalExpenses, 10.3);
  assert.equal(summary.totalIncome, 3);
  assert.equal(summary.byLabel.filter((row) => row.Category === 'Expense').reduce((sum, row) => sum + toMinorUnits(row.total), 0), 1030);
  assert.equal(ai.summary.expenseMinor, 1030);
  assert.equal(ai.summary.incomeMinor, 300);
  assert.equal(widget.totalExpense, 10.3);
  assert.equal(widget.totalIncome, 3);
  assert.equal(widget.balance, -7.3);
  assert.deepEqual(forecast.values, [10.3]);
});

test('decimal rounding uses half-up cents and respects the authoritative integer amount', async () => {
  assert.equal(toMinorUnits(1.005), 101);
  assert.equal(toMinorUnits(-1.005), -101);
  assert.equal(toMinorUnits(1e-7), 0);
  assert.throws(() => toMinorUnits(Number.MAX_VALUE), /safe integer/);
  const id = await service.addTransaction({ userId: 'owner', Amount: 99, AmountMinor: 10, Category: 'Expense', Timestamp: '2026-09-11' });
  const row = await service.getTransactionById(id, 'owner');
  assert.equal(row.Amount, 0.1);
  assert.equal(buildCashFlowWidgetPayload([row], { accounts: [] }, new Date(2026, 8, 11)).totalExpense, 0.1);
});
