const crypto = require('node:crypto');
const { getDb } = require('../database/db');
const { FinancialMutationError } = require('./accountBalanceService');

async function capturePortfolioState(db, userId, accountId) {
    const account = await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?', [accountId, userId]);
    if (!account) throw new FinancialMutationError('Portfolio account not found', 404);
    const holdings = await db.all('SELECT * FROM investment_holdings WHERE accountId = ? AND userId = ? ORDER BY symbol', [accountId, userId]);
    return { account, holdings };
}

async function recordPortfolioState(db, userId, transactionId, before) {
    const after = await capturePortfolioState(db, userId, before.account.id);
    await db.run(`UPDATE portfolio_transactions SET reversalState = ?
        WHERE sourceTransactionId = ? AND userId = ? AND reversedAt IS NULL`,
        [JSON.stringify({ before, after }), transactionId, userId]);
}

const financialHolding = holding => holding ? {
    symbol: holding.symbol, quantity: holding.quantity, currency: holding.currency,
    averageCostMinor: holding.averageCostMinor, averageCostMicros: holding.averageCostMicros,
} : null;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tokenFor = state => crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');

async function correctionState(db, userId, transactionId) {
    const source = await db.get('SELECT * FROM transactions WHERE id = ? AND userId = ?', [transactionId, userId]);
    if (!source) throw new FinancialMutationError('Transaction not found', 404);
    const activity = await db.get(`SELECT * FROM portfolio_transactions WHERE sourceTransactionId = ? AND userId = ?
        ORDER BY (reversedAt IS NULL) DESC, id DESC LIMIT 1`, [transactionId, userId]);
    if (!activity) return { activity: null, source };
    const current = await capturePortfolioState(db, userId, activity.accountId);
    let recorded;
    try { recorded = JSON.parse(activity.reversalState); } catch { recorded = null; }
    if (!recorded?.before?.account || !recorded?.after?.account ||
        !Array.isArray(recorded.before.holdings) || !Array.isArray(recorded.after.holdings) ||
        !Number.isSafeInteger(recorded.before.account.cashMinor) || !Number.isSafeInteger(recorded.after.account.cashMinor)) recorded = null;
    const later = await db.get(`SELECT id FROM portfolio_transactions WHERE userId = ? AND accountId = ?
        AND id > ? AND reversedAt IS NULL LIMIT 1`, [userId, activity.accountId, activity.id]);
    const cashAbsorbed = recorded && (current.account.balanceSource === 'plaid' ||
        current.account.balanceRevision !== recorded.after.account.balanceRevision);
    const holdingsAbsorbed = recorded && current.account.holdingsSource === 'plaid' &&
        (current.account.holdingsAsOf !== recorded.after.account.holdingsAsOf ||
            recorded.after.account.holdingsSource !== 'plaid');
    let reason = !recorded ? 'This older activity has no saved cost-basis history. Review the current cash and full holdings baseline first.'
        : later ? 'Reverse later portfolio activity in this account first.' : null;
    if (current.account.holdingsReviewReason || current.account.balanceReviewReason) reason ||= 'Resolve the account baseline review before automatically reversing activity.';
    const affected = recorded ? [...new Set([...recorded.before.holdings, ...recorded.after.holdings].map(h => h.symbol))]
        .filter(symbol => !same(financialHolding(recorded.before.holdings.find(h => h.symbol === symbol)),
            financialHolding(recorded.after.holdings.find(h => h.symbol === symbol)))) : [];
    if (recorded && !holdingsAbsorbed && affected.some(symbol => !same(
        financialHolding(current.holdings.find(h => h.symbol === symbol)),
        financialHolding(recorded.after.holdings.find(h => h.symbol === symbol))))) {
        reason ||= 'The holding quantity or cost basis has changed. Review the current full baseline first.';
    }
    return { source, activity, current, recorded, affected, cashAbsorbed: Boolean(cashAbsorbed),
        holdingsAbsorbed: Boolean(holdingsAbsorbed), reason, token: tokenFor({ source, activity, current }) };
}

async function getPortfolioCorrection(userId, transactionId) {
    const db = await getDb();
    return db.withTransaction(async () => {
        const state = await correctionState(db, userId, transactionId);
        if (!state.activity) return null;
        return { activityId: state.activity.id, accountId: state.activity.accountId, accountName: state.current.account.name,
            kind: state.activity.kind, reversedAt: state.activity.reversedAt, token: state.token,
            requiresBaselineReview: Boolean(state.reason), reason: state.reason,
            cashAbsorbed: state.cashAbsorbed, holdingsAbsorbed: state.holdingsAbsorbed,
            canCorrect: !state.activity.reversedAt && !state.reason && !state.cashAbsorbed && !state.holdingsAbsorbed &&
                ['EMAIL_BUY', 'EMAIL_SELL'].includes(state.activity.kind),
            source: { amountMinor: state.source.AmountMinor, symbol: state.source.PortfolioSymbol,
                quantity: state.source.PortfolioQuantity, price: state.source.PortfolioPrice, action: state.source.PortfolioAction },
        };
    });
}

async function reverseState(db, userId, state, reason, verifiedBaseline) {
    if (state.reason && !verifiedBaseline) throw new FinancialMutationError(state.reason);
    const now = new Date().toISOString();
    if (!verifiedBaseline) {
        const { before, after } = state.recorded;
        if (!state.cashAbsorbed) {
            const cashMinor = state.current.account.cashMinor - (after.account.cashMinor - before.account.cashMinor);
            if (!Number.isSafeInteger(cashMinor)) throw new FinancialMutationError('Reversal exceeds supported balance limits');
            await db.run('UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ? AND userId = ?',
                [cashMinor, now, state.activity.accountId, userId]);
        }
        if (!state.holdingsAbsorbed) for (const symbol of state.affected) {
            const previous = before.holdings.find(h => h.symbol === symbol);
            const current = state.current.holdings.find(h => h.symbol === symbol);
            await db.run('DELETE FROM investment_holdings WHERE accountId = ? AND userId = ? AND symbol = ?', [state.activity.accountId, userId, symbol]);
            if (previous) await db.run(`INSERT INTO investment_holdings
                (userId, accountId, symbol, name, quantity, averageCostMinor, averageCostMicros, priceMinor, priceMicros, currency, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [userId, state.activity.accountId, symbol, previous.name,
                previous.quantity, previous.averageCostMinor, previous.averageCostMicros,
                current?.priceMinor ?? previous.priceMinor, current?.priceMicros ?? previous.priceMicros, previous.currency, now]);
        }
    }
    await db.run('UPDATE portfolio_transactions SET reversedAt = ?, reversalReason = ? WHERE id = ? AND userId = ?', [now, reason, state.activity.id, userId]);
    await db.run(`INSERT INTO agent_audit_log (userId, action, status, details, createdAt) VALUES (?, 'portfolio_reversal', 'success', ?, ?)`,
        [userId, JSON.stringify({ activity: state.activity, source: state.source, reason, verifiedBaseline,
            cashAbsorbed: state.cashAbsorbed, holdingsAbsorbed: state.holdingsAbsorbed, before: state.current,
            after: await capturePortfolioState(db, userId, state.activity.accountId) }), now]);
}

async function reversePortfolioActivity(userId, transactionId, input) {
    if (!input || typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.length > 500 ||
        typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token) ||
        (input.verifiedBaseline !== undefined && typeof input.verifiedBaseline !== 'boolean')) {
        throw new FinancialMutationError('Provide a reviewed preview and a correction reason', 400);
    }
    const db = await getDb();
    return db.withTransaction(async () => {
        const state = await correctionState(db, userId, transactionId);
        if (!state.activity) throw new FinancialMutationError('Portfolio activity not found', 404);
        if (state.activity.reversedAt) return { reversed: true, alreadyReversed: true };
        if (state.token !== input.token) throw new FinancialMutationError('Account or transaction changed. Refresh the correction preview.');
        await reverseState(db, userId, state, input.reason.trim(), input.verifiedBaseline === true);
        return { reversed: true, preservedBaseline: Boolean(input.verifiedBaseline || state.cashAbsorbed || state.holdingsAbsorbed) };
    });
}

async function correctPortfolioTrade(userId, transactionId, input) {
    const { correction } = input || {};
    if (!correction || !['BUY', 'SELL'].includes(correction.action) ||
        typeof correction.symbol !== 'string' || !/^[A-Z0-9.\-]{1,15}$/.test(correction.symbol) ||
        !Number.isFinite(correction.quantity) || correction.quantity <= 0 || correction.quantity > 1e9 ||
        !Number.isFinite(correction.price) || correction.price <= 0 || !Number.isSafeInteger(Math.round(correction.price * 1e6)) ||
        !Number.isSafeInteger(correction.amountMinor) || correction.amountMinor <= 0 || correction.amountMinor > 1e11) {
        throw new FinancialMutationError('Provide valid corrected trade details', 400);
    }
    const db = await getDb();
    return db.withTransaction(async () => {
        const preview = await getPortfolioCorrection(userId, transactionId);
        if (!preview?.canCorrect || input.verifiedBaseline) throw new FinancialMutationError('This trade requires baseline review before correction');
        await reversePortfolioActivity(userId, transactionId, input);
        const service = require('../database/dbService');
        await service.updateTransactionForUser(transactionId, userId, { AmountMinor: correction.amountMinor,
            Amount: correction.amountMinor / 100, PortfolioAction: correction.action, PortfolioSymbol: correction.symbol,
            PortfolioQuantity: correction.quantity, PortfolioPrice: correction.price });
        const result = await service.applyEmailPortfolioActivity(userId, transactionId, { accountId: preview.accountId,
            confidence: 'HIGH', action: correction.action, symbol: correction.symbol, quantity: correction.quantity,
            price: correction.price, allowReapply: true });
        if (result.status !== 'applied' || result.accountId !== preview.accountId) throw new FinancialMutationError(result.reason || 'Corrected trade could not be posted to the reviewed account');
        const data = await service.getTransactionById(transactionId, userId);
        await db.run(`INSERT INTO agent_audit_log (userId, action, status, details, createdAt)
            VALUES (?, 'portfolio_correction', 'success', ?, ?)`,
            [userId, JSON.stringify({ transactionId, accountId: preview.accountId, reason: input.reason.trim(), correction, source: data }), new Date().toISOString()]);
        return { corrected: true, data };
    });
}

module.exports = { capturePortfolioState, recordPortfolioState, getPortfolioCorrection, reversePortfolioActivity, correctPortfolioTrade };
