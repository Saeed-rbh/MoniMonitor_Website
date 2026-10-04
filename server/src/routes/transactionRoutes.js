const mutations = require('../services/transactionMutations');

function registerTransactionRoutes(app, {
    authenticateToken, dbService, plaidService, sendValidationError,
    cashFlowWidgetCache, cashFlowWidgetCacheMs, buildCashFlowWidgetPayload, parseTransaction,
}) {
    app.get('/reliability', authenticateToken, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try { return res.json(await require('../services/financialReliability').checkFinancialReliability(req.user.userId)); }
        catch (error) { return sendValidationError(res, error); }
    });
    app.get('/transactions/:id/reliability', authenticateToken, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid transaction id' });
        try {
            const transaction = await dbService.getTransactionById(id, req.user.userId);
            if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
            const db = await dbService.getDb();
            const sources = await db.all('SELECT * FROM transaction_sources WHERE userId=? AND transactionId=?', [req.user.userId, id]);
            const override = await db.get('SELECT * FROM transaction_overrides WHERE userId=? AND transactionId=?', [req.user.userId, id]);
            return res.json(require('../services/financialReliability').assessTransaction(transaction, sources, override));
        } catch (error) { return sendValidationError(res, error); }
    });
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
            const result = await mutations.createTransaction(req.user.userId, req.body, req.get('Idempotency-Key') || null);
            cashFlowWidgetCache.delete(req.user.userId);
            return res.status(201).json(result);
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
    app.get('/transactions/:id/refunds', authenticateToken, async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid transaction id' });
        try {
            if (!await dbService.getTransactionById(id, req.user.userId)) return res.status(404).json({ error: 'Transaction not found' });
            const db = await dbService.getDb();
            const pairings = await db.all(`SELECT rp.*, p.Reason AS purchaseReason, r.Reason AS refundReason
                FROM refund_pairings rp JOIN transactions p ON p.id = rp.purchaseTransactionId
                JOIN transactions r ON r.id = rp.refundTransactionId
                WHERE rp.userId = ? AND (rp.purchaseTransactionId = ? OR rp.refundTransactionId = ?)`,
                [req.user.userId, id, id]);
            return res.json({ pairings });
        } catch (error) { return sendValidationError(res, error); }
    });
}
module.exports = { registerTransactionRoutes };
