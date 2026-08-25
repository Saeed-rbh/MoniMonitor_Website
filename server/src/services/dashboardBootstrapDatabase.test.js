const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-dashboard-bootstrap-'));
process.env.MONIMONITOR_DB_PATH = path.join(testDirectory, 'test.sqlite');
process.env.USER_ID = '';

const dbService = require('../database/dbService');

test.after(async () => {
    const db = await dbService.getDb();
    await db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('returns compact monthly totals and only the requested month transactions', async () => {
    const userId = 'dashboard-bootstrap-user';
    const db = await dbService.getDb();
    await db.run(
        'INSERT INTO users (id, username, password, createdAt) VALUES (?, ?, ?, ?)',
        [userId, 'dashboard-bootstrap', 'not-used', new Date().toISOString()]
    );

    await dbService.addTransaction({
        userId, Amount: 2000, AmountMinor: 200000, Category: 'Income', Label: 'Deposit',
        Reason: 'Pay', Timestamp: '2026-08-05T12:00:00.000Z', Account: 'Chequing',
    });
    await dbService.addTransaction({
        userId, Amount: 125, AmountMinor: 12500, Category: 'Expense', Label: 'Groceries',
        Reason: 'Store', Timestamp: '2026-08-06T12:00:00.000Z', Account: 'Credit Card',
    });
    await dbService.addTransaction({
        userId, Amount: 50, AmountMinor: 5000, Category: 'Expense', Label: 'Dining',
        Reason: 'Cafe', Timestamp: '2026-07-06T12:00:00.000Z', Account: 'Credit Card',
    });

    const payload = await dbService.getDashboardBootstrapForUser(userId, '2026-08');

    assert.equal(payload.currentMonth, '2026-08');
    assert.equal(payload.transactions.length, 2);
    assert.ok(payload.transactions.every((transaction) => transaction.Timestamp.startsWith('2026-08')));
    assert.deepEqual(
        payload.byMonth.map(({ month, count }) => ({ month, count })),
        [{ month: '2026-08', count: 2 }, { month: '2026-07', count: 1 }]
    );
    const stored = await db.all(
        `SELECT month, incomeMinor, expensesMinor, transactionCount
         FROM monthly_transaction_summaries WHERE userId = ? ORDER BY month DESC`,
        [userId]
    );
    assert.deepEqual(stored, [
        { month: '2026-08', incomeMinor: 200000, expensesMinor: 12500, transactionCount: 2 },
        { month: '2026-07', incomeMinor: 0, expensesMinor: 5000, transactionCount: 1 },
    ]);
    const summary = await dbService.getSummaryForUser(userId);
    assert.deepEqual(
        {
            totalIncome: summary.totalIncome,
            totalExpenses: summary.totalExpenses,
            totalSavings: summary.totalSavings,
            balance: summary.balance,
        },
        { totalIncome: 2000, totalExpenses: 175, totalSavings: 0, balance: 1825 }
    );
    assert.ok(JSON.stringify(payload).length < 5000);
});

test('keeps stored monthly summaries correct after edits, deletes, and direct writes', async () => {
    const userId = 'dashboard-summary-mutations-user';
    const db = await dbService.getDb();
    await db.run(
        'INSERT INTO users (id, username, password, createdAt) VALUES (?, ?, ?, ?)',
        [userId, 'dashboard-summary-mutations', 'not-used', new Date().toISOString()]
    );

    const transactionId = await dbService.addTransaction({
        userId, Amount: 90, AmountMinor: 9000, Category: 'Expense', Label: 'Groceries',
        Reason: 'Store', Timestamp: '2026-08-10T12:00:00.000Z', Account: 'Credit Card',
    });
    await dbService.updateTransactionForUser(transactionId, userId, {
        Amount: 120,
        Category: 'Income',
        Timestamp: '2026-07-10T12:00:00.000Z',
    });

    let summaries = await dbService.getDashboardBootstrapForUser(userId, '2026-07');
    assert.deepEqual(
        summaries.byMonth.map(({ month, income, expenses, count }) => ({ month, income, expenses, count })),
        [{ month: '2026-07', income: 120, expenses: 0, count: 1 }]
    );

    await db.run(
        "UPDATE transactions SET Category = 'Expense' WHERE id = ? AND userId = ?",
        [transactionId, userId]
    );
    summaries = await dbService.getDashboardBootstrapForUser(userId, '2026-07');
    assert.deepEqual(
        summaries.byMonth.map(({ month, income, expenses, count }) => ({ month, income, expenses, count })),
        [{ month: '2026-07', income: 0, expenses: 120, count: 1 }]
    );

    await dbService.deleteTransaction(transactionId, userId);
    summaries = await dbService.getDashboardBootstrapForUser(userId, '2026-07');
    assert.deepEqual(summaries.byMonth, []);
});
