function registerTransactionRoutes(app, {
    authenticateToken, dbService, plaidService, sendValidationError,
    cashFlowWidgetCache, cashFlowWidgetCacheMs, buildCashFlowWidgetPayload, parseTransaction,
}) {
    app.get('/transactions', authenticateToken, async (req, res) => {
        try {
            const filters = Object.fromEntries(['category', 'label', 'account', 'from', 'to', 'search', 'page', 'limit']
                .map((key) => [key, req.query[key]]));
            const transactions = await dbService.getAllTransactionsForUser(req.user.userId, filters);
            res.json(transactions);
            setImmediate(() => plaidService.syncUserItems(req.user.userId).catch((error) => console.error('Background Plaid sync error:', error.message)));
        } catch (error) { return sendValidationError(res, error); }
    });
    app.post('/transactions', authenticateToken, async (req, res) => {
        try {
            const { BalanceAccountId = null, ...transactionInput } = req.body || {};
            const transaction = parseTransaction(transactionInput);
            const id = await dbService.addTransaction({ ...transaction, userId: req.user.userId });
            const accountResolution = await dbService.ensureTransactionAccount(req.user.userId, {
                ...transaction, BalanceAccountId, BalanceAccountConfidence: BalanceAccountId ? 'HIGH' : null,
            });
            const resolvedAccountId = BalanceAccountId || accountResolution.account?.id || null;
            const accountPosting = await dbService.syncTransactionAccountBalance(req.user.userId, id, {
                accountId: resolvedAccountId, confidence: resolvedAccountId ? 'HIGH' : null,
            });
            await dbService.detectAndMarkRecurring(req.user.userId, id).catch((error) => console.error('Recurrence detection error:', error.message));
            return res.status(201).json({ message: 'Created', data: { ...transaction, id }, accountPosting, accountResolution });
        } catch (error) { return sendValidationError(res, error); }
    });
    app.get('/widget/cash-flow', authenticateToken, async (req, res) => {
        const userId = req.user.userId;
        const cached = cashFlowWidgetCache.get(userId);
        if (cached && Date.now() - cached.createdAt < cashFlowWidgetCacheMs) {
            res.set('Cache-Control', 'private, max-age=60');
            res.json(cached.payload);
        } else {
            try {
                const [transactions, portfolio] = await Promise.all([
                    dbService.getAllTransactionsForUser(userId), dbService.getPortfolioSummary(userId),
                ]);
                const payload = buildCashFlowWidgetPayload(transactions, portfolio);
                cashFlowWidgetCache.set(userId, { createdAt: Date.now(), payload });
                res.set('Cache-Control', 'private, max-age=60');
                res.json(payload);
            } catch (error) { return sendValidationError(res, error); }
        }
        setImmediate(() => plaidService.syncUserItems(userId).catch((error) => console.error('Background widget Plaid sync error:', error.message)));
    });
    app.get('/transactions/:id/sources', authenticateToken, async (req, res) => {
        const transactionId = Number(req.params.id);
        if (!Number.isSafeInteger(transactionId) || transactionId <= 0) return res.status(400).json({ error: 'Invalid transaction id' });
        try {
            const transaction = await dbService.getTransactionById(transactionId, req.user.userId);
            if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
            return res.json({ sources: await dbService.getTransactionSourcesForUser(transactionId, req.user.userId) });
        } catch (error) { return sendValidationError(res, error); }
    });
}
module.exports = { registerTransactionRoutes };
