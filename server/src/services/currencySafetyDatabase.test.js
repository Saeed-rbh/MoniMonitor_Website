const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-currency-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
process.env.MARKET_QUOTES_ENABLED = 'false';
const service = require('../database/dbService');
const mutations = require('./transactionMutations');
const { normalizeInvestmentSnapshot, applyInvestmentSnapshot } = require('./plaidService');
const { buildMonthlyAnalysis } = require('./monthlyInsightService');
const { buildDailyExpenseSeries } = require('./timesFmForecastService');
const { buildCashFlowWidgetPayload } = require('./cashFlowWidgetService');
let db, cad, usd;
const input = { Amount: 10, Category: 'Expense', Label: 'Groceries', Reason: 'Store', Timestamp: '2026-09-10T12:00:00Z', Type: 'Chequing' };
test.before(async () => {
  db = await service.getDb();
  await service.createUser('owner', 'currency-owner', 'unused');
  cad = await service.createInvestmentAccount('owner', { name: 'CAD cash', accountType: 'TFSA', currency: 'CAD', cashMinor: 10000 });
  usd = await service.createInvestmentAccount('owner', { name: 'USD cash', accountType: 'TFSA', currency: 'USD', cashMinor: 20000 });
});
test.after(async () => { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('CAD summaries exclude native USD activity while history and native balance posting preserve it', async () => {
  await mutations.createTransaction('owner', { ...input, Currency: 'CAD', BalanceAccountId: cad.id });
  const native = await mutations.createTransaction('owner', { ...input, Currency: 'USD', BalanceAccountId: usd.id });
  assert.equal(native.accountPosting.status, 'applied');
  const summary = await service.getSummaryForUser('owner');
  assert.equal(summary.currency, 'CAD');
  assert.equal(summary.totalExpenses, 10);
  assert.equal((await service.getAllTransactionsForUser('owner')).length, 2);
  assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [usd.id])).cashMinor, 19000);
});

test('cross-currency cash and portfolio postings require review and posted currency edits roll back', async () => {
  const result = await mutations.createTransaction('owner', { ...input, Currency: 'USD', BalanceAccountId: cad.id });
  assert.equal(result.accountPosting.status, 'review_required');
  assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [cad.id])).cashMinor, 9000);
  const posted = await db.get("SELECT id FROM transactions WHERE Currency = 'CAD'");
  await assert.rejects(mutations.updateTransaction('owner', posted.id, { Currency: 'USD' }), /Reverse the existing/);
  assert.equal((await service.getTransactionById(posted.id, 'owner')).Currency, 'CAD');
  const id = await service.addTransaction({ ...input, Account: cad.name, userId: 'owner', Currency: 'USD', Category: 'Investment', Label: 'ETF & Stock Purchase', PortfolioAction: 'BUY' });
  const posting = await service.applyEmailPortfolioActivity('owner', id, { accountId: cad.id, confidence: 'HIGH', action: 'BUY', symbol: 'ABC', quantity: 1, price: 10 });
  assert.equal(posting.status, 'review_required');
});

test('portfolio aggregates cash and mixed-account holdings by their native currencies', async () => {
  await service.upsertInvestmentHolding('owner', cad.id, { symbol: 'ABC', quantity: 2, priceMinor: 500, averageCostMinor: 400, priceMicros: 5000000, averageCostMicros: 4000000, currency: 'USD' });
  const portfolio = await service.getPortfolioSummary('owner');
  assert.equal(portfolio.currency, 'CAD');
  assert.equal(portfolio.totalValueMinor, 9000);
  assert.equal(portfolio.byCurrency.find((item) => item.currency === 'USD').totalValueMinor, 20000);
  assert.equal(portfolio.accounts.find((item) => item.id === cad.id).holdingsValueMinor, 0);
});

test('AI facts, forecast series and widget totals never mix native currencies', () => {
  const rows = [{ ...input, AmountMinor: 1000, Currency: 'CAD' }, { ...input, Amount: 90, AmountMinor: 9000, Currency: 'USD' }];
  const analysis = buildMonthlyAnalysis(rows, '2026-09');
  assert.equal(analysis.summary.expenseMinor, 1000);
  assert.deepEqual(buildDailyExpenseSeries(rows).values, [10]);
  const widget = buildCashFlowWidgetPayload(rows, { accounts: [] }, new Date(2026, 8, 15));
  assert.equal(widget.totalExpense, 10);
  assert.deepEqual(widget.otherCurrencies, ['USD']);
});

test('mixed-currency provider holdings retain previous cash and expose review until native cash is supplied', async () => {
  const snapshot = { accounts: [{ account_id: 'mixed', balances: { current: 100, iso_currency_code: 'CAD' } }],
    securities: [{ security_id: 'stock', ticker_symbol: 'USDSTOCK', type: 'equity' }],
    holdings: [{ account_id: 'mixed', security_id: 'stock', quantity: 1, institution_price: 50, institution_value: 50, iso_currency_code: 'USD' }] };
  assert.equal(normalizeInvestmentSnapshot(snapshot).get('mixed').cashReviewRequired, true);
  const accountMap = new Map([['mixed', { appAccountId: cad.id, type: 'investment', currency: 'CAD' }]]);
  await applyInvestmentSnapshot('owner', accountMap, snapshot);
  const account = await db.get('SELECT * FROM investment_accounts WHERE id = ?', [cad.id]);
  assert.equal(account.cashMinor, 9000);
  assert.match(account.balanceReviewReason, /native cash/);
  snapshot.accounts[0].balances.available = 30;
  await applyInvestmentSnapshot('owner', accountMap, snapshot);
  const refreshed = await db.get('SELECT * FROM investment_accounts WHERE id = ?', [cad.id]);
  assert.equal(refreshed.cashMinor, 3000);
  assert.equal(refreshed.balanceReviewReason, null);
});
