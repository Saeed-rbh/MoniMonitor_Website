const MIGRATIONS = [
    {
        version: 15,
        name: 'guided_reliability_reviews',
        async up(db) {
            await db.exec(`CREATE TABLE reliability_reviews (
                userId TEXT NOT NULL REFERENCES users(id), issueKey TEXT NOT NULL,
                fingerprint TEXT NOT NULL, answer TEXT NOT NULL, reviewedAt TEXT NOT NULL,
                PRIMARY KEY(userId, issueKey))`);
        },
    },
    {
        version: 14,
        name: 'financial_reliability',
        async up(db) {
            await db.exec(`CREATE TABLE balance_snapshots (
                id INTEGER PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), accountId INTEGER NOT NULL,
                cashMinor INTEGER NOT NULL, currency TEXT NOT NULL, source TEXT NOT NULL, asOf TEXT NOT NULL,
                createdAt TEXT NOT NULL, UNIQUE(userId, accountId, source, asOf));
                CREATE INDEX idx_balance_snapshots_account ON balance_snapshots(userId, accountId, asOf);
                CREATE TABLE transaction_overrides (
                transactionId INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
                userId TEXT NOT NULL REFERENCES users(id), fieldsJson TEXT NOT NULL, evidence TEXT NOT NULL, updatedAt TEXT NOT NULL);
                CREATE TABLE reliability_incidents (
                userId TEXT NOT NULL REFERENCES users(id), incidentKey TEXT NOT NULL, kind TEXT NOT NULL,
                detailsJson TEXT NOT NULL, openedAt TEXT NOT NULL, updatedAt TEXT NOT NULL, resolvedAt TEXT,
                PRIMARY KEY(userId, incidentKey));
                CREATE TABLE reliability_runs (
                userId TEXT PRIMARY KEY REFERENCES users(id), checkedAt TEXT NOT NULL, reportJson TEXT NOT NULL);
                CREATE TABLE transaction_source_history (
                id INTEGER PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), transactionId INTEGER NOT NULL,
                provider TEXT NOT NULL, externalId TEXT NOT NULL, rawPayloadJson TEXT, contextPayloadJson TEXT, archivedAt TEXT NOT NULL);
                CREATE TRIGGER preserve_source_update BEFORE UPDATE OF rawPayloadJson,contextPayloadJson ON transaction_sources
                WHEN OLD.provider != 'email' AND (OLD.rawPayloadJson IS NOT NEW.rawPayloadJson OR OLD.contextPayloadJson IS NOT NEW.contextPayloadJson)
                BEGIN INSERT INTO transaction_source_history(userId,transactionId,provider,externalId,rawPayloadJson,contextPayloadJson,archivedAt)
                VALUES(OLD.userId,OLD.transactionId,OLD.provider,OLD.externalId,OLD.rawPayloadJson,OLD.contextPayloadJson,CURRENT_TIMESTAMP); END;
                CREATE TRIGGER preserve_source_delete BEFORE DELETE ON transaction_sources WHEN OLD.provider != 'email'
                BEGIN INSERT INTO transaction_source_history(userId,transactionId,provider,externalId,rawPayloadJson,contextPayloadJson,archivedAt)
                VALUES(OLD.userId,OLD.transactionId,OLD.provider,OLD.externalId,OLD.rawPayloadJson,OLD.contextPayloadJson,CURRENT_TIMESTAMP); END;
                INSERT INTO balance_snapshots(userId, accountId, cashMinor, currency, source, asOf, createdAt)
                SELECT userId, id, cashMinor, currency, balanceSource, balanceAsOf, CURRENT_TIMESTAMP
                FROM investment_accounts WHERE balanceAsOf IS NOT NULL;`);
            // Preserve previous evidence-based repairs as explicit overrides.
            const audits = await db.all("SELECT userId, details, createdAt FROM agent_audit_log WHERE action = 'october_evidence_repair' ORDER BY id");
            for (const audit of audits) {
                let changes; try { changes = JSON.parse(audit.details); } catch { continue; }
                if (!Array.isArray(changes)) continue;
                for (const change of changes) {
                    if (!change.id || !change.fields) continue;
                    if (!await db.get('SELECT id FROM transactions WHERE id = ? AND userId = ?', [change.id, audit.userId])) continue;
                    const prior = await db.get('SELECT fieldsJson FROM transaction_overrides WHERE transactionId = ?', [change.id]);
                    const fields = { ...JSON.parse(prior?.fieldsJson || '{}'), ...change.fields };
                    await db.run(`INSERT INTO transaction_overrides VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(transactionId) DO UPDATE SET fieldsJson=excluded.fieldsJson, evidence=excluded.evidence, updatedAt=excluded.updatedAt`,
                        [change.id, audit.userId, JSON.stringify(fields), change.evidence || 'Audited correction', audit.createdAt]);
                }
            }
        },
    },
    {
        version: 13,
        name: 'email_ingestion_review_holds',
        async up(db) {
            await db.exec(`CREATE TABLE transaction_ingestion_reviews (
                transactionId INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
                reason TEXT NOT NULL, candidateIdsJson TEXT NOT NULL DEFAULT '[]',
                createdAt TEXT NOT NULL, resolvedAt TEXT
            )`);
        },
    },
    {
        version: 12,
        name: 'persistent_ai_usage_limits',
        async up(db) {
            await db.exec(`CREATE TABLE ai_usage_daily (
                day TEXT PRIMARY KEY, requests INTEGER NOT NULL CHECK(requests >= 0),
                inputBytes INTEGER NOT NULL CHECK(inputBytes >= 0)
            )`);
        },
    },
    {
        version: 11,
        name: 'audited_portfolio_reversals',
        async up(db) {
            await db.exec(`ALTER TABLE portfolio_transactions ADD COLUMN reversalState TEXT;
                ALTER TABLE portfolio_transactions ADD COLUMN reversedAt TEXT;
                ALTER TABLE portfolio_transactions ADD COLUMN reversalReason TEXT;
                DROP INDEX IF EXISTS idx_portfolio_transactions_source;
                CREATE UNIQUE INDEX idx_portfolio_transactions_source ON portfolio_transactions(sourceTransactionId)
                    WHERE sourceTransactionId IS NOT NULL AND reversedAt IS NULL;`);
        },
    },
    {
        version: 10,
        name: 'signed_account_balances',
        rebuildReferences: true,
        up: require('./signedBalanceMigration').migrateSignedBalances,
    },
    {
        version: 9,
        name: 'review_legacy_pending_trade_overlays',
        async up(db) {
            await db.exec(`ALTER TABLE investment_accounts ADD COLUMN holdingsSource TEXT NOT NULL DEFAULT 'manual';
                ALTER TABLE investment_accounts ADD COLUMN holdingsAsOf TEXT;
                ALTER TABLE investment_accounts ADD COLUMN holdingsReviewReason TEXT;
                UPDATE investment_accounts SET holdingsSource = 'plaid'
                    WHERE id IN (SELECT appAccountId FROM plaid_accounts WHERE type = 'investment' AND userId = investment_accounts.userId);
                UPDATE investment_accounts SET holdingsReviewReason =
                    'Refresh bank holdings to replace possible legacy pending-trade overlays',
                    balanceReviewReason = COALESCE(balanceReviewReason, 'Refresh bank cash to replace possible legacy pending-trade adjustments')
                WHERE holdingsSource = 'plaid' AND id IN (
                    SELECT t.PortfolioAccountId FROM transactions t
                    WHERE t.userId = investment_accounts.userId AND t.Category = 'Investment' AND t.PortfolioAction IN ('BUY', 'SELL')
                      AND EXISTS (SELECT 1 FROM transaction_sources s WHERE s.transactionId = t.id AND s.userId = t.userId AND s.provider = 'email')
                      AND NOT EXISTS (SELECT 1 FROM transaction_sources s WHERE s.transactionId = t.id AND s.userId = t.userId AND s.provider = 'plaid_investments')
                );`);
        },
    },
    {
        version: 8,
        name: 'revocable_auth_sessions',
        async up(db) {
            await db.exec(`CREATE TABLE auth_sessions (
                idHash TEXT PRIMARY KEY,
                userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                createdAt INTEGER NOT NULL,
                expiresAt INTEGER NOT NULL CHECK(expiresAt > createdAt),
                revokedAt INTEGER
            );
            CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expiresAt);`);
        },
    },
    {
        version: 7,
        name: 'review_legacy_pending_transfer_balances',
        async up(db) {
            // The old override did not record whether it had changed cash.
            // Do not guess a reversal amount; require a fresh balance baseline.
            await db.exec(`UPDATE investment_accounts SET balanceReviewReason =
                'Review or refresh this balance to replace possible legacy pending-transfer adjustments'
                WHERE id IN (
                    SELECT a.id FROM investment_accounts a JOIN transactions t
                        ON t.userId = a.userId AND (t.BalanceAccountId = a.id OR t.PortfolioAccountId = a.id)
                    WHERE t.Category = 'Internal' AND t.Label = 'Internal Transfer' AND t.PortfolioAction = 'TRANSFER'
                      AND EXISTS (SELECT 1 FROM transaction_sources s WHERE s.transactionId = t.id AND s.userId = t.userId AND s.provider = 'email')
                      AND NOT EXISTS (SELECT 1 FROM transaction_sources s WHERE s.transactionId = t.id AND s.userId = t.userId AND s.provider IN ('plaid', 'plaid_investments'))
                );`);
        },
    },
    {
        version: 6,
        name: 'account_balance_snapshot_provenance',
        async up(db) {
            await db.exec(`ALTER TABLE investment_accounts ADD COLUMN balanceRevision INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE investment_accounts ADD COLUMN balanceSource TEXT NOT NULL DEFAULT 'manual';
                ALTER TABLE investment_accounts ADD COLUMN balanceAsOf TEXT;
                ALTER TABLE account_balance_events ADD COLUMN balanceRevision INTEGER NOT NULL DEFAULT 0;
                UPDATE investment_accounts SET balanceRevision = 1, balanceSource = 'plaid', balanceAsOf = updatedAt
                WHERE id IN (SELECT appAccountId FROM plaid_accounts WHERE appAccountId IS NOT NULL);`);
        },
    },
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
        const transaction = migration.rebuildReferences ? db.withSchemaMigration : db.withTransaction;
        await transaction(async () => {
            await migration.up(db);
            await db.run(
                'INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)',
                [migration.version, migration.name, new Date().toISOString()]
            );
        });
    }
}

module.exports = { MIGRATIONS, runMigrations };
