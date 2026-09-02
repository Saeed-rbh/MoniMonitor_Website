function registerBackupRoutes(app, {
    authenticateToken,
    requireConfiguredOwner,
    requirePrivateBackupNetwork,
    backupService,
    sendValidationError,
}) {
    app.get('/backups', authenticateToken, requireConfiguredOwner, requirePrivateBackupNetwork, async (_req, res) => {
        try { return res.json(await backupService.getBackupStatus()); }
        catch (error) { return sendValidationError(res, error); }
    });
    app.post('/backups', authenticateToken, requireConfiguredOwner, requirePrivateBackupNetwork, async (_req, res) => {
        try { return res.status(201).json(await backupService.createBackup('manual')); }
        catch (error) { return sendValidationError(res, error); }
    });
    app.get('/backups/:fileName/download', authenticateToken, requireConfiguredOwner, requirePrivateBackupNetwork, async (req, res) => {
        try {
            const filePath = await backupService.resolveBackupPath(req.params.fileName);
            return res.download(filePath, req.params.fileName);
        } catch (error) {
            if (error.code === 'ENOENT') return res.status(404).json({ error: 'Backup not found' });
            return sendValidationError(res, error);
        }
    });
    app.post('/backups/:fileName/restore', authenticateToken, requireConfiguredOwner, requirePrivateBackupNetwork, async (req, res) => {
        if (req.body?.confirm !== 'RESTORE') return res.status(400).json({ error: 'Restore confirmation is required' });
        try {
            const result = await backupService.restoreBackup(req.params.fileName, req.user.userId);
            res.json(result);
            setTimeout(() => process.exit(0), 250).unref?.();
            return undefined;
        } catch (error) {
            if (error.code === 'ENOENT') return res.status(404).json({ error: 'Backup not found' });
            return sendValidationError(res, error);
        }
    });
}

module.exports = { registerBackupRoutes };
