const assert = require('node:assert/strict');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { getDb } = require('../src/database/db');
const service = require('../src/database/dbService');
const { restoreDatabase } = require('../src/services/databaseRecovery');
const { isIncome, isExpense, getSavingEffectMinor, amountMinorOf } = require('../src/services/transactionClassification');

async function run() {
    const sourcePath = path.resolve(process.argv[2] || '');
    const targetPath = path.resolve(process.env.MONIMONITOR_DB_PATH || '');
    if (process.env.MONIMONITOR_RESTORE_DRILL !== '1' || !process.env.MONIMONITOR_DB_PATH || sourcePath === targetPath) {
        throw new Error('Restore drill requires a separate isolated database');
    }
    const source = await open({ filename: sourcePath, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
    let db;
    try {
        db = await getDb();
        await restoreDatabase(db, sourcePath);
        const users = await source.all('SELECT id FROM users');
        for (const table of ['users', 'transactions', 'investment_accounts', 'investment_holdings', 'portfolio_transactions', 'transaction_sources']) {
            const expected = (await source.get(`SELECT COUNT(*) AS count FROM ${table}`)).count;
            const actual = (await db.get(`SELECT COUNT(*) AS count FROM ${table}`)).count;
            assert.equal(actual, expected, `${table} row count changed during recovery`);
        }
        for (const { id: userId } of users) {
            const transactions = await source.all("SELECT * FROM transactions WHERE userId = ? AND COALESCE(Currency, 'CAD') = 'CAD'", [userId]);
            const months = new Map();
            for (const tx of transactions) {
                const month = tx.Timestamp.slice(0, 7);
                const totals = months.get(month) || { income: 0, expenses: 0, savings: 0, count: 0 };
                if (isIncome(tx)) totals.income += amountMinorOf(tx);
                if (isExpense(tx)) totals.expenses += amountMinorOf(tx);
                totals.savings += getSavingEffectMinor(tx); totals.count++;
                months.set(month, totals);
            }
            const report = await service.getSummaryForUser(userId);
            assert.equal(report.byMonth.length, months.size, 'Recovered report has stale months');
            for (const [month, totals] of months) {
                const bootstrap = await service.getDashboardBootstrapForUser(userId, month);
                const recovered = bootstrap.byMonth.find(row => row.month === month);
                assert.equal(Math.round(recovered.income * 100), totals.income, 'Income report mismatch');
                assert.equal(Math.round(recovered.expenses * 100), totals.expenses, 'Expense report mismatch');
                assert.equal(Math.round(recovered.savings * 100), totals.savings, 'Savings report mismatch');
                assert.equal(recovered.count, totals.count, 'Report transaction count mismatch');
            }
            const accounts = await service.getInvestmentAccounts(userId);
            const saved = await source.all('SELECT id, cashMinor, currency FROM investment_accounts WHERE userId = ? ORDER BY id', [userId]);
            assert.deepEqual(accounts.map(({ id, cashMinor, currency }) => ({ id, cashMinor, currency })).sort((a,b) => a.id - b.id), saved);
        }
        assert.equal((await db.get('SELECT COUNT(*) AS count FROM auth_sessions')).count, 0);
        assert.equal((await db.get('SELECT COUNT(*) AS count FROM monthly_ai_briefs')).count, 0);
        console.log(JSON.stringify({ verified: true, users: users.length, applicationReports: true }));
    } finally { await source.close(); await db?.close(); }
}
run().catch(error => { console.error('Application restore drill failed:', error.message); process.exitCode = 1; });
