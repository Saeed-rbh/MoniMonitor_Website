const { currencyOf } = require('../../../shared/currency.cjs');
const PENDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Current email evidence is a projection, never a change to recorded holdings
// or cash. Provider confirmation, edits, deletion, and expiry remove it naturally.
async function attachPendingTrades(db, userId, accounts, now = Date.now()) {
    const byId = new Map(accounts.map((account) => [account.id, { ...account,
        pendingTrades: [], pendingTradeHoldings: [], pendingTradeCashDeltaMinor: 0,
    }]));
    const rows = await db.all(`SELECT t.*, p.accountId AS postedAccountId,
            EXISTS (SELECT 1 FROM plaid_accounts a WHERE a.appAccountId = t.PortfolioAccountId AND a.userId = t.userId) AS bankLinked
        FROM transactions t LEFT JOIN portfolio_transactions p ON p.sourceTransactionId = t.id AND p.userId = t.userId AND p.reversedAt IS NULL
        WHERE t.userId = ? AND t.Category = 'Investment' AND t.PortfolioAction IN ('BUY', 'SELL')
          AND NOT EXISTS (SELECT 1 FROM portfolio_transactions r WHERE r.sourceTransactionId = t.id AND r.userId = t.userId
              AND r.reversedAt IS NOT NULL AND p.id IS NULL)
          AND t.ReceivedAt >= ? AND t.ReceivedAt <= ?
          AND EXISTS (SELECT 1 FROM transaction_sources s WHERE s.transactionId = t.id AND s.userId = t.userId AND s.provider = 'email')
          AND NOT EXISTS (SELECT 1 FROM transaction_sources s WHERE s.transactionId = t.id AND s.userId = t.userId AND s.provider = 'plaid_investments')
        ORDER BY t.Timestamp ASC, t.id ASC`,
        [userId, new Date(now - PENDING_WINDOW_MS).toISOString(), new Date(now).toISOString()]);
    const unassignedTrades = [];
    const holdingDeltas = new Map();
    for (const row of rows) {
        const account = byId.get(row.PortfolioAccountId);
        const trade = { transactionId: row.id, occurredAt: row.Timestamp, action: row.PortfolioAction,
            symbol: row.PortfolioSymbol, quantity: row.PortfolioQuantity, currency: currencyOf(row),
            status: 'pending', reason: null };
        if (!account) {
            unassignedTrades.push({ ...trade, status: 'review_required', reason: 'The trade account needs confirmation' });
            continue;
        }
        const symbol = String(row.PortfolioSymbol || '').trim().toUpperCase();
        const quantity = Number(row.PortfolioQuantity);
        const price = Number(row.PortfolioPrice);
        let reason = account.holdingsReviewReason || account.balanceReviewReason || null;
        if (row.PortfolioConfidence !== 'HIGH') reason ||= 'The trade account needs confirmation';
        if (!['TFSA', 'RRSP', 'Brokerage', '401(k)', 'IRA', 'Crypto'].includes(account.accountType)) reason ||= 'The account type needs review';
        if (!/^[A-Z0-9.\-]{1,15}$/.test(symbol) || !Number.isFinite(quantity) || quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER ||
            !Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(row.AmountMinor) || row.AmountMinor <= 0) reason ||= 'The trade details need review';
        if (currencyOf(row) !== currencyOf(account)) reason ||= 'A cross-currency trade needs recorded exchange rates';
        const holding = account.holdings.find((item) => item.symbol === symbol);
        if (holding && currencyOf(holding) !== currencyOf(row)) reason ||= 'The holding currency differs from the trade currency';
        const expected = Math.round(quantity * price * 100);
        if (!Number.isSafeInteger(expected) || Math.abs(expected - row.AmountMinor) > Math.max(2, Math.round(row.AmountMinor * 0.02))) reason ||= 'The trade total does not match quantity and execution price';
        // Old bank overlays left EMAIL_* history records. They do not prove a
        // trade remains outside the latest bank snapshot. Only manual postings
        // are already reflected in the manually maintained account baseline.
        const alreadyPosted = !row.bankLinked && account.holdingsSource === 'manual' && row.postedAccountId === account.id;
        account.pendingTrades.push({ ...trade, symbol, status: reason ? 'review_required' : alreadyPosted ? 'already_posted' : 'pending', reason });
        if (alreadyPosted && !reason) continue;
        if (reason) {
            account.pendingTradeCashDeltaMinor = null;
            continue;
        }
        const cashDelta = row.PortfolioAction === 'BUY' ? -row.AmountMinor : row.AmountMinor;
        const cash = account.pendingTradeCashDeltaMinor === null ? null : account.pendingTradeCashDeltaMinor + cashDelta;
        account.pendingTradeCashDeltaMinor = Number.isSafeInteger(cash) ? cash : null;
        const key = `${account.id}:${symbol}`;
        const state = holdingDeltas.get(key) || { symbol, currency: currencyOf(row), recordedQuantity: Number(holding?.quantity || 0), quantityDelta: 0 };
        state.quantityDelta += row.PortfolioAction === 'BUY' ? quantity : -quantity;
        state.estimatedQuantity = state.recordedQuantity + state.quantityDelta;
        state.reason ||= !Number.isFinite(state.estimatedQuantity) || Math.abs(state.estimatedQuantity) > Number.MAX_SAFE_INTEGER
            ? 'The projected share quantity is unsupported; review is required'
            : state.estimatedQuantity < 0 ? 'The pending sell exceeds recorded shares; review is required' : null;
        holdingDeltas.set(key, state);
    }
    for (const [key, holding] of holdingDeltas) byId.get(Number(key.split(':')[0])).pendingTradeHoldings.push(holding);
    return { unassignedTrades, accounts: [...byId.values()].map((account) => {
        // An invalid or ambiguous trade makes the complete projection unknown;
        // do not show a partial set of trades as a complete share estimate.
        if (account.pendingTrades.some((trade) => trade.reason)) account.pendingTradeHoldings = [];
        const cash = account.pendingTradeCashDeltaMinor === null || account.estimatedCashMinor === null
            ? null : (account.estimatedCashMinor ?? account.cashMinor) + account.pendingTradeCashDeltaMinor;
        const needsReview = account.pendingTrades.length > 0 && (!Number.isSafeInteger(cash) || cash < 0 || account.pendingTradeHoldings.some((item) => item.reason));
        return { ...account, estimatedCashWithTradesMinor: Number.isSafeInteger(cash) ? cash : null,
            pendingTradeReviewRequired: needsReview || account.pendingTrades.some((trade) => trade.reason) };
    }) };
}

module.exports = { attachPendingTrades };
