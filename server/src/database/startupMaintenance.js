const PROCESSED_EMAIL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

async function runStartupMaintenance(db, now = Date.now()) {
    const cutoff = new Date(now - PROCESSED_EMAIL_RETENTION_MS).toISOString();
    await db.run('DELETE FROM processed_emails WHERE processedAt < ?', [cutoff]);
}

module.exports = { PROCESSED_EMAIL_RETENTION_MS, runStartupMaintenance };
