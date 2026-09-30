const { currencyOf } = require('../../../shared/currency.cjs');
const PENDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Estimates are derived from current evidence, never written into cashMinor.
// Linking a provider source, editing/deleting a transaction, or expiration
// therefore removes the estimate without requiring a compensating mutation.
async function attachPendingTransfers(db, userId, accounts, now = Date.now()) {
    const byId = new Map(accounts.map((account) => [account.id, {
        ...account, pendingCashDeltaMinor: 0, pendingTransfers: [],
    }]));
    const rows = await db.all(`SELECT t.id, t.AmountMinor, t.Currency, t.Timestamp, t.BalanceAccountConfidence, t.PortfolioConfidence,
            t.BalanceAccountId AS sourceAccountId, t.PortfolioAccountId AS destinationAccountId,
            e.accountId AS postedAccountId, e.deltaMinor AS postedDeltaMinor, e.balanceRevision AS postedRevision
        FROM transactions t
        LEFT JOIN account_balance_events e ON e.sourceTransactionId = t.id AND e.userId = t.userId
        WHERE t.userId = ? AND t.Category = 'Internal' AND t.Label = 'Internal Transfer'
          AND t.PortfolioAction = 'TRANSFER' AND t.AccountFlow = 'OUT'
          AND t.ReceivedAt >= ? AND t.ReceivedAt <= ?
          AND t.BalanceAccountId IS NOT NULL AND t.PortfolioAccountId IS NOT NULL
          AND t.BalanceAccountId != t.PortfolioAccountId
          AND EXISTS (SELECT 1 FROM transaction_sources s WHERE s.transactionId = t.id AND s.userId = t.userId AND s.provider = 'email')
          AND NOT EXISTS (SELECT 1 FROM transaction_sources s WHERE s.transactionId = t.id AND s.userId = t.userId AND s.provider IN ('plaid', 'plaid_investments'))`,
        [userId, new Date(now - PENDING_WINDOW_MS).toISOString(), new Date(now).toISOString()]);
    let transferCount = 0;
    for (const transfer of rows) {
        const source = byId.get(transfer.sourceAccountId);
        const destination = byId.get(transfer.destinationAccountId);
        if (!source || !destination) continue;
        transferCount += 1;
        let reason = null;
        if (!Number.isSafeInteger(transfer.AmountMinor) || transfer.AmountMinor <= 0) reason = 'The transfer amount needs review';
        else if (transfer.BalanceAccountConfidence !== 'HIGH' || transfer.PortfolioConfidence !== 'HIGH') reason = 'Both transfer accounts need confirmation';
        else if ([source, destination].some((a) => currencyOf(a) !== currencyOf(transfer))) reason = 'A cross-currency transfer needs recorded exchange rates';
        else if ([source, destination].some((a) => a.accountType === 'Credit Card')) reason = 'A credit-card transfer needs review';
        for (const [account, direction] of [[source, -1], [destination, 1]]) {
            const delta = direction * transfer.AmountMinor;
            const alreadyPosted = account.balanceSource === 'manual' && transfer.postedAccountId === account.id &&
                (transfer.postedRevision < account.balanceRevision ||
                    transfer.postedRevision === account.balanceRevision && transfer.postedDeltaMinor === delta);
            const reviewReason = reason || account.balanceReviewReason || null;
            account.pendingTransfers.push({ transactionId: transfer.id, occurredAt: transfer.Timestamp,
                deltaMinor: reason ? null : delta, status: reviewReason ? 'review_required' : alreadyPosted ? 'already_posted' : 'pending',
                reason: reviewReason });
            if (reviewReason) account.pendingCashDeltaMinor = null;
            else if (!alreadyPosted && account.pendingCashDeltaMinor !== null) {
                const total = account.pendingCashDeltaMinor + delta;
                account.pendingCashDeltaMinor = Number.isSafeInteger(total) ? total : null;
            }
        }
    }
    return { transferCount, accounts: [...byId.values()].map((account) => {
        const estimated = account.pendingCashDeltaMinor === null ? null : account.cashMinor + account.pendingCashDeltaMinor;
        return { ...account, estimatedCashMinor: Number.isSafeInteger(estimated) ? estimated : null,
            pendingBalanceReviewRequired: !Number.isSafeInteger(estimated) || estimated < 0 };
    }) };
}

module.exports = { attachPendingTransfers };
