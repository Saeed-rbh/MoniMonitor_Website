function registerIntegrationRoutes(app, { authenticateToken, authRateLimit, plaidService, sendValidationError }) {
    app.post('/plaid/webhook', async (req, res) => {
        const signedJwt = req.get('Plaid-Verification');
        const verified = await plaidService.verifyPlaidWebhook(req.rawBody, signedJwt).catch((error) => {
            console.error('Plaid webhook verification error:', error.message);
            return false;
        });
        if (!verified) return res.status(401).json({ error: 'Invalid webhook signature' });
        try {
            const queued = await plaidService.enqueuePlaidWebhook(req.rawBody, signedJwt);
            res.status(200).json({ received: true, queued: queued.inserted });
            plaidService.kickPlaidWebhookWorker();
        } catch (error) {
            console.error('Plaid webhook enqueue error:', error.message);
            return res.status(503).json({ error: 'Unable to persist webhook' });
        }
    });
    app.get('/plaid/status', authenticateToken, async (req, res) => {
        try { return res.json(await plaidService.getStatus(req.user.userId)); }
        catch (error) { return sendValidationError(res, error); }
    });
    app.post('/plaid/link-token', authenticateToken, authRateLimit, async (req, res) => {
        try {
            const itemId = req.body?.itemId;
            if (itemId !== undefined && (typeof itemId !== 'string' || itemId.length > 200)) return res.status(400).json({ error: 'Invalid Plaid item' });
            return res.json(await plaidService.createLinkToken(req.user.userId, itemId));
        } catch (error) {
            if (error.statusCode && error.statusCode < 500) return res.status(error.statusCode).json({ error: error.message });
            if (error.statusCode === 503) return res.status(503).json({ error: error.message });
            return sendValidationError(res, error);
        }
    });
    app.post('/plaid/exchange', authenticateToken, authRateLimit, async (req, res) => {
        try {
            const connection = await plaidService.exchangePublicToken(req.user.userId, req.body?.publicToken, req.body?.metadata);
            const sync = await plaidService.syncUserItems(req.user.userId, { force: true });
            return res.status(201).json({ connection, sync });
        } catch (error) {
            if (error.statusCode && error.statusCode < 500) return res.status(error.statusCode).json({ error: error.message });
            return sendValidationError(res, error);
        }
    });
    app.post('/plaid/sync', authenticateToken, async (req, res) => {
        try { return res.json(await plaidService.syncUserItems(req.user.userId, { force: true })); }
        catch (error) { return sendValidationError(res, error); }
    });
    app.delete('/plaid/items/:itemId', authenticateToken, async (req, res) => {
        if (typeof req.params.itemId !== 'string' || req.params.itemId.length > 200) return res.status(400).json({ error: 'Invalid Plaid item' });
        try {
            if (!await plaidService.disconnectItem(req.user.userId, req.params.itemId)) return res.status(404).json({ error: 'Bank connection not found' });
            return res.json({ message: 'Bank disconnected' });
        } catch (error) { return sendValidationError(res, error); }
    });
}
module.exports = { registerIntegrationRoutes };
