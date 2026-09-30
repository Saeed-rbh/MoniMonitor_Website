function registerPortfolioRoutes(app, { authenticateToken, dbService, sendValidationError }) {
    const corrections = require('../services/portfolioCorrections');
    app.get('/portfolio/transactions/:id/correction', authenticateToken, async (req, res) => {
        try { return res.json(await corrections.getPortfolioCorrection(req.user.userId, req.params.id)); }
        catch (error) { return sendValidationError(res, error); }
    });
    for (const [action, handler] of [['reverse', corrections.reversePortfolioActivity], ['correct', corrections.correctPortfolioTrade]]) {
        app.post(`/portfolio/transactions/:id/${action}`, authenticateToken, async (req, res) => {
            try { return res.json(await handler(req.user.userId, req.params.id, req.body)); }
            catch (error) { return sendValidationError(res, error); }
        });
    }
    app.get('/portfolio', authenticateToken, async (req, res) => {
        try { return res.json(await dbService.getPortfolioSummary(req.user.userId)); }
        catch (error) { return sendValidationError(res, error); }
    });
}

module.exports = { registerPortfolioRoutes };
