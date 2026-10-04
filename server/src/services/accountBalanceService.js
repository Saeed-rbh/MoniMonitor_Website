const { getDb } = require('../database/db');

class FinancialMutationError extends Error {
    constructor(message, statusCode = 409) { super(message); this.statusCode = statusCode; }
}

async function setAccountBalanceSnapshot(userId, accountId, cashMinor, currency, source = 'plaid', asOf = new Date().toISOString()) {
    const db = await getDb();
    return db.withTransaction(async () => {
        const account = await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?', [accountId, userId]);
        if (!account) throw new FinancialMutationError('Account not found', 404);
        if (!Number.isSafeInteger(cashMinor) || currency !== account.currency) {
            const reason = currency !== account.currency
                ? 'The bank currency differs from the recorded account currency; review is required'
                : `The bank reported an unsupported balance (${cashMinor} minor units); review is required`;
            await db.run('UPDATE investment_accounts SET balanceReviewReason = ? WHERE id = ? AND userId = ?', [reason, accountId, userId]);
            return { status: 'review_required', reason };
        }
        await db.run(`UPDATE investment_accounts SET cashMinor = ?, balanceRevision = balanceRevision + 1,
            balanceSource = ?, balanceAsOf = ?, balanceReviewReason = NULL, updatedAt = ? WHERE id = ? AND userId = ?`,
            [cashMinor, source, asOf, asOf, accountId, userId]);
        await db.run(`INSERT OR IGNORE INTO balance_snapshots(userId, accountId, cashMinor, currency, source, asOf, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)`, [userId, accountId, cashMinor, currency, source, asOf, new Date().toISOString()]);
        return { status: 'applied' };
    });
}

module.exports = { FinancialMutationError, setAccountBalanceSnapshot };
