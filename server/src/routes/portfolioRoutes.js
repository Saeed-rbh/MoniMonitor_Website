function registerPortfolioRoutes(app, { authenticateToken, dbService, sendValidationError }) {
    app.get('/portfolio', authenticateToken, async (req, res) => {
        try { return res.json(await dbService.getPortfolioSummary(req.user.userId)); }
        catch (error) { return sendValidationError(res, error); }
    });
}

module.exports = { registerPortfolioRoutes };
