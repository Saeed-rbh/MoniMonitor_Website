const { getSavingEffectMinor } = require('../services/transactionClassification');

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function normalizeMonth(value) {
    const month = String(value || '').slice(0, 7);
    return MONTH_PATTERN.test(month) ? month : null;
}

async function refreshMonthlySummary(db, userId, month, expectedRevision = null) {
    const normalizedMonth = normalizeMonth(month);
    if (!userId || !normalizedMonth) return false;

    const start = `${normalizedMonth}-01`;
    const nextMonthDate = new Date(`${start}T00:00:00.000Z`);
    nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
    const nextMonth = nextMonthDate.toISOString().slice(0, 10);
    const transactions = await db.all(
        `SELECT AmountMinor, Category, Label, Reason, Account, PortfolioAction
         FROM transactions
         WHERE userId = ? AND Timestamp >= ? AND Timestamp < ?`,
        [userId, start, nextMonth]
    );

    const totals = transactions.reduce((summary, transaction) => {
        const amountMinor = Number(transaction.AmountMinor || 0);
        if (transaction.Category === 'Income') summary.incomeMinor += amountMinor;
        if (transaction.Category === 'Expense') summary.expensesMinor += amountMinor;
        summary.savingsMinor += getSavingEffectMinor(transaction);
        return summary;
    }, { incomeMinor: 0, expensesMinor: 0, savingsMinor: 0 });

    if (transactions.length === 0) {
        await db.run(
            'DELETE FROM monthly_transaction_summaries WHERE userId = ? AND month = ?',
            [userId, normalizedMonth]
        );
    } else {
        await db.run(
            `INSERT INTO monthly_transaction_summaries
                (userId, month, incomeMinor, expensesMinor, savingsMinor, transactionCount, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(userId, month) DO UPDATE SET
                incomeMinor = excluded.incomeMinor,
                expensesMinor = excluded.expensesMinor,
                savingsMinor = excluded.savingsMinor,
                transactionCount = excluded.transactionCount,
                updatedAt = excluded.updatedAt`,
            [userId, normalizedMonth, totals.incomeMinor, totals.expensesMinor,
                totals.savingsMinor, transactions.length, new Date().toISOString()]
        );
    }

    if (expectedRevision === null) {
        await db.run(
            'DELETE FROM monthly_summary_dirty WHERE userId = ? AND month = ?',
            [userId, normalizedMonth]
        );
    } else {
        await db.run(
            'DELETE FROM monthly_summary_dirty WHERE userId = ? AND month = ? AND revision = ?',
            [userId, normalizedMonth, expectedRevision]
        );
    }
    return true;
}

async function refreshDirtyMonthlySummaries(db, userId = null) {
    const params = [];
    let query = 'SELECT userId, month, revision FROM monthly_summary_dirty';
    if (userId) {
        query += ' WHERE userId = ?';
        params.push(userId);
    }
    query += ' ORDER BY userId, month';

    const dirtyMonths = await db.all(query, params);
    for (const dirty of dirtyMonths) {
        await refreshMonthlySummary(db, dirty.userId, dirty.month, dirty.revision);
    }
    return dirtyMonths.length;
}

async function refreshTransactionMonths(db, transactions) {
    const affected = new Map();
    for (const transaction of transactions || []) {
        const month = normalizeMonth(transaction?.Timestamp);
        if (transaction?.userId && month) {
            affected.set(`${transaction.userId}\u0000${month}`, { userId: transaction.userId, month });
        }
    }
    for (const item of affected.values()) {
        const dirty = await db.get(
            'SELECT revision FROM monthly_summary_dirty WHERE userId = ? AND month = ?',
            [item.userId, item.month]
        );
        await refreshMonthlySummary(db, item.userId, item.month, dirty?.revision ?? null);
    }
}

async function getStoredMonthlySummaries(db, userId) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const refreshed = await refreshDirtyMonthlySummaries(db, userId);
        if (refreshed === 0) break;
    }
    const rows = await db.all(
        `SELECT month, incomeMinor, expensesMinor, savingsMinor, transactionCount, updatedAt
         FROM monthly_transaction_summaries
         WHERE userId = ?
         ORDER BY month DESC`,
        [userId]
    );
    return rows.map((row) => ({
        month: row.month,
        income: Number(row.incomeMinor || 0) / 100,
        expenses: Number(row.expensesMinor || 0) / 100,
        savings: Number(row.savingsMinor || 0) / 100,
        count: Number(row.transactionCount || 0),
        updatedAt: row.updatedAt,
    }));
}

module.exports = {
    getStoredMonthlySummaries,
    normalizeMonth,
    refreshDirtyMonthlySummaries,
    refreshMonthlySummary,
    refreshTransactionMonths,
};
