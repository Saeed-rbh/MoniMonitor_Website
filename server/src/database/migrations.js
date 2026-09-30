const MIGRATIONS = [
    {
        version: 5,
        name: 'shared_reporting_semantics',
        async up(db) {
            await db.exec(`INSERT INTO monthly_summary_dirty (userId, month, revision, changedAt)
                SELECT userId, month, 1, CURRENT_TIMESTAMP FROM monthly_transaction_summaries WHERE 1
                ON CONFLICT(userId, month) DO UPDATE SET revision = monthly_summary_dirty.revision + 1;
                DELETE FROM monthly_ai_briefs;
                DELETE FROM expense_forecast_points;`);
        },
    },
    {
        version: 4,
        name: 'rebuild_currency_safe_summaries',
        async up(db) {
            await db.exec('ALTER TABLE investment_accounts ADD COLUMN balanceReviewReason TEXT');
            await db.exec(`INSERT INTO monthly_summary_dirty (userId, month, revision, changedAt)
                SELECT userId, month, 1, CURRENT_TIMESTAMP FROM monthly_transaction_summaries WHERE 1
                ON CONFLICT(userId, month) DO UPDATE SET revision = monthly_summary_dirty.revision + 1;
                DELETE FROM monthly_ai_briefs;
                DELETE FROM expense_forecast_points WHERE userId IN
                    (SELECT DISTINCT userId FROM transactions WHERE COALESCE(Currency, 'CAD') <> 'CAD');
                UPDATE user_settings SET currency = 'CAD';`);
        },
    },
    {
        version: 3,
        name: 'idempotent_manual_transactions',
        async up(db) {
            await db.exec(`CREATE TABLE IF NOT EXISTS transaction_requests (
                userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                requestKey TEXT NOT NULL,
                requestHash TEXT NOT NULL,
                responseJson TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                PRIMARY KEY (userId, requestKey)
            )`);
        },
    },
    {
        version: 1,
        name: 'phase2_single_tenant_and_retention',
        async up(db) {
            await db.exec(`
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    appliedAt TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_transaction_sources_email_retention
                    ON transaction_sources(provider, capturedAt);
            `);
        },
    },
    {
        version: 2,
        name: 'phase3_refund_pairings',
        async up(db) {
            await db.exec(`
                CREATE TABLE IF NOT EXISTS refund_pairings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    refundTransactionId INTEGER NOT NULL UNIQUE,
                    purchaseTransactionId INTEGER NOT NULL,
                    amountMinor INTEGER NOT NULL,
                    matchType TEXT NOT NULL,
                    confidence TEXT NOT NULL,
                    pairedAt TEXT NOT NULL,
                    FOREIGN KEY (refundTransactionId) REFERENCES transactions(id) ON DELETE CASCADE,
                    FOREIGN KEY (purchaseTransactionId) REFERENCES transactions(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_refund_pairings_user
                    ON refund_pairings(userId);
                CREATE INDEX IF NOT EXISTS idx_refund_pairings_purchase
                    ON refund_pairings(purchaseTransactionId);
                CREATE INDEX IF NOT EXISTS idx_refund_pairings_refund
                    ON refund_pairings(refundTransactionId);
            `);
        },
    },
];

async function runMigrations(db) {
    await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        appliedAt TEXT NOT NULL
    )`);
    const applied = new Set((await db.all('SELECT version FROM schema_migrations')).map((row) => Number(row.version)));
    for (const migration of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
        if (applied.has(migration.version)) continue;
        await db.withTransaction(async () => {
            await migration.up(db);
            await db.run(
                'INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)',
                [migration.version, migration.name, new Date().toISOString()]
            );
        });
    }
}

module.exports = { MIGRATIONS, runMigrations };
