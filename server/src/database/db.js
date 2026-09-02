const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const { applyFinancialSnapshot } = require('./financialSnapshot');
const { reconcileHistoricalInternalTransfers } = require('./historicalTransferReconciliation');
const { reconcileTransactionDuplicates } = require('../services/transactionDeduplication');
const { refreshDirtyMonthlySummaries } = require('./monthlySummaries');

const DB_PATH = process.env.MONIMONITOR_DB_PATH
    ? path.resolve(process.env.MONIMONITOR_DB_PATH)
    : path.join(__dirname, '..', '..', 'monimonitor.sqlite');
const DB_BUSY_TIMEOUT_MS = 10000;

let dbPromise = null;

async function getDb() {
    if (!dbPromise) {
        let openedDb = null;
        const initialization = open({
            filename: DB_PATH,
            driver: sqlite3.Database
        }).then(async (db) => {
            openedDb = db;
            db.configure('busyTimeout', DB_BUSY_TIMEOUT_MS);
            await db.exec('PRAGMA journal_mode = WAL');
            await db.exec('PRAGMA synchronous = NORMAL');

            await db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('owner', 'user')),
                    profilePhotoUrl TEXT,
                    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    Amount REAL NOT NULL,
                    Category TEXT NOT NULL,
                    Label TEXT,
                    Reason TEXT,
                    Timestamp TEXT NOT NULL,
                    ReceivedAt TEXT,
                    Type TEXT,
                    Account TEXT,
                    BankName TEXT,
                    ReferenceNumber TEXT,
                    TelegramMessageId INTEGER,
                    Frequency TEXT DEFAULT 'OneTime',
                    PortfolioAction TEXT,
                    PortfolioAccountId INTEGER,
                    PortfolioConfidence TEXT,
                    PortfolioSymbol TEXT,
                    PortfolioQuantity REAL,
                    PortfolioPrice REAL,
                    BalanceAccountId INTEGER,
                    BalanceAccountConfidence TEXT,
                    PortfolioAccountNumber TEXT,
                    PortfolioToSymbol TEXT,
                    PortfolioToQuantity REAL,
                    AccountFlow TEXT,
                    SourceEmailKey TEXT,
                    FOREIGN KEY (userId) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    Account TEXT NOT NULL,
                    BankName TEXT,
                    Type TEXT,
                    FirstSeen TEXT,
                    UNIQUE(userId, Account),
                    FOREIGN KEY (userId) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS processed_emails (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    uid INTEGER UNIQUE,
                    processedAt TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS email_sync_state (
                    mailboxKey TEXT PRIMARY KEY,
                    uidValidity TEXT NOT NULL,
                    lastDiscoveredUid INTEGER NOT NULL DEFAULT 0,
                    initializedAt TEXT NOT NULL,
                    updatedAt TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS email_ingestion_queue (
                    mailboxKey TEXT NOT NULL,
                    uidValidity TEXT NOT NULL,
                    uid INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending', 'processed')),
                    attempts INTEGER NOT NULL DEFAULT 0,
                    lastError TEXT,
                    discoveredAt TEXT NOT NULL,
                    processedAt TEXT,
                    PRIMARY KEY (mailboxKey, uidValidity, uid)
                );

                CREATE TABLE IF NOT EXISTS merchant_rules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    pattern TEXT NOT NULL,
                    category TEXT NOT NULL,
                    label TEXT NOT NULL,
                    UNIQUE(userId, pattern)
                );

                CREATE TABLE IF NOT EXISTS rate_limits (
                    bucketKey TEXT PRIMARY KEY,
                    count INTEGER NOT NULL,
                    startedAt INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS expense_forecast_points (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    generatedAt TEXT NOT NULL,
                    forecastDate TEXT NOT NULL,
                    forecastAmount REAL NOT NULL CHECK(forecastAmount >= 0),
                    lowerAmount REAL NOT NULL CHECK(lowerAmount >= 0),
                    upperAmount REAL NOT NULL CHECK(upperAmount >= 0),
                    UNIQUE(userId, generatedAt, forecastDate),
                    FOREIGN KEY (userId) REFERENCES users(id)
                );
            `);
            const userColumns = await db.all("PRAGMA table_info(users)");
            if (!userColumns.some((column) => column.name === "profilePhotoUrl")) {
                await db.exec("ALTER TABLE users ADD COLUMN profilePhotoUrl TEXT");
            }
            if (!userColumns.some((column) => column.name === "role")) {
                await db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('owner', 'user'))");
            }
            if (!userColumns.some((column) => column.name === "createdAt")) {
                await db.exec("ALTER TABLE users ADD COLUMN createdAt TEXT");
                await db.run(
                    "UPDATE users SET createdAt = ? WHERE createdAt IS NULL",
                    [new Date().toISOString()]
                );
            }
            const configuredOwnerId = String(process.env.BACKUP_OWNER_USER_ID || process.env.USER_ID || '').trim();
            if (configuredOwnerId) {
                await db.run("UPDATE users SET role = 'owner' WHERE id = ?", [configuredOwnerId]);
            }
            const transactionColumns = await db.all("PRAGMA table_info(transactions)");
            const hasColumn = (name) => transactionColumns.some((column) => column.name === name);
            if (!hasColumn("AmountMinor")) await db.exec("ALTER TABLE transactions ADD COLUMN AmountMinor INTEGER");
            if (!hasColumn("Currency")) await db.exec("ALTER TABLE transactions ADD COLUMN Currency TEXT NOT NULL DEFAULT 'CAD'");
            if (!hasColumn("PortfolioAction")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioAction TEXT");
            if (!hasColumn("PortfolioAccountId")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioAccountId INTEGER");
            if (!hasColumn("PortfolioConfidence")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioConfidence TEXT");
            if (!hasColumn("PortfolioSymbol")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioSymbol TEXT");
            if (!hasColumn("PortfolioQuantity")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioQuantity REAL");
            if (!hasColumn("PortfolioPrice")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioPrice REAL");
            if (!hasColumn("BalanceAccountId")) await db.exec("ALTER TABLE transactions ADD COLUMN BalanceAccountId INTEGER");
            if (!hasColumn("BalanceAccountConfidence")) await db.exec("ALTER TABLE transactions ADD COLUMN BalanceAccountConfidence TEXT");
            if (!hasColumn("PortfolioAccountNumber")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioAccountNumber TEXT");
            if (!hasColumn("PortfolioToSymbol")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioToSymbol TEXT");
            if (!hasColumn("PortfolioToQuantity")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioToQuantity REAL");
            if (!hasColumn("AccountFlow")) await db.exec("ALTER TABLE transactions ADD COLUMN AccountFlow TEXT");
            if (!hasColumn("SourceEmailKey")) await db.exec("ALTER TABLE transactions ADD COLUMN SourceEmailKey TEXT");
            await db.run("UPDATE transactions SET AmountMinor = ROUND(Amount * 100) WHERE AmountMinor IS NULL");

            await db.exec(`
                CREATE TABLE IF NOT EXISTS user_settings (
                    userId TEXT PRIMARY KEY,
                    currency TEXT NOT NULL DEFAULT 'CAD',
                    timezone TEXT,
                    notificationsEnabled INTEGER NOT NULL DEFAULT 1,
                    updatedAt TEXT NOT NULL,
                    FOREIGN KEY (userId) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS budgets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    category TEXT NOT NULL,
                    month TEXT NOT NULL,
                    amountMinor INTEGER NOT NULL CHECK(amountMinor >= 0),
                    currency TEXT NOT NULL DEFAULT 'CAD',
                    UNIQUE(userId, category, month),
                    FOREIGN KEY (userId) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS goals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    name TEXT NOT NULL,
                    targetMinor INTEGER NOT NULL CHECK(targetMinor > 0),
                    currentMinor INTEGER NOT NULL DEFAULT 0 CHECK(currentMinor >= 0),
                    currency TEXT NOT NULL DEFAULT 'CAD',
                    targetDate TEXT,
                    createdAt TEXT NOT NULL,
                    FOREIGN KEY (userId) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS investment_accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    name TEXT NOT NULL,
                    institution TEXT,
                    accountType TEXT NOT NULL,
                    accountRef TEXT,
                    currency TEXT NOT NULL DEFAULT 'CAD',
                    cashMinor INTEGER NOT NULL DEFAULT 0 CHECK(cashMinor >= 0),
                    createdAt TEXT NOT NULL,
                    updatedAt TEXT NOT NULL,
                    FOREIGN KEY (userId) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS investment_holdings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    accountId INTEGER NOT NULL,
                    symbol TEXT NOT NULL,
                    name TEXT,
                    quantity REAL NOT NULL CHECK(quantity >= 0),
                    averageCostMinor INTEGER NOT NULL DEFAULT 0 CHECK(averageCostMinor >= 0),
                    averageCostMicros INTEGER NOT NULL DEFAULT 0 CHECK(averageCostMicros >= 0),
                    priceMinor INTEGER NOT NULL DEFAULT 0 CHECK(priceMinor >= 0),
                    priceMicros INTEGER NOT NULL DEFAULT 0 CHECK(priceMicros >= 0),
                    currency TEXT NOT NULL DEFAULT 'CAD',
                    updatedAt TEXT NOT NULL,
                    UNIQUE(accountId, symbol),
                    FOREIGN KEY (userId) REFERENCES users(id),
                    FOREIGN KEY (accountId) REFERENCES investment_accounts(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS portfolio_transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    accountId INTEGER NOT NULL,
                    sourceTransactionId INTEGER,
                    kind TEXT NOT NULL,
                    amountMinor INTEGER NOT NULL DEFAULT 0,
                    symbol TEXT,
                    quantity REAL,
                    priceMinor INTEGER,
                    relatedAccountId INTEGER,
                    priceMicros INTEGER,
                    occurredAt TEXT NOT NULL,
                    note TEXT,
                    FOREIGN KEY (userId) REFERENCES users(id),
                    FOREIGN KEY (accountId) REFERENCES investment_accounts(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS agent_audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    details TEXT,
                    createdAt TEXT NOT NULL,
                    FOREIGN KEY (userId) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS account_balance_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    accountId INTEGER NOT NULL,
                    sourceTransactionId INTEGER NOT NULL UNIQUE,
                    deltaMinor INTEGER NOT NULL,
                    occurredAt TEXT NOT NULL,
                    FOREIGN KEY (userId) REFERENCES users(id),
                    FOREIGN KEY (accountId) REFERENCES investment_accounts(id) ON DELETE CASCADE,
                    FOREIGN KEY (sourceTransactionId) REFERENCES transactions(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS monthly_ai_briefs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    month TEXT NOT NULL,
                    dataHash TEXT,
                    briefJson TEXT NOT NULL,
                    createdAt TEXT NOT NULL,
                    UNIQUE(userId, month)
                );

                CREATE TABLE IF NOT EXISTS monthly_transaction_summaries (
                    userId TEXT NOT NULL,
                    month TEXT NOT NULL,
                    incomeMinor INTEGER NOT NULL DEFAULT 0,
                    expensesMinor INTEGER NOT NULL DEFAULT 0,
                    savingsMinor INTEGER NOT NULL DEFAULT 0,
                    transactionCount INTEGER NOT NULL DEFAULT 0,
                    updatedAt TEXT NOT NULL,
                    PRIMARY KEY (userId, month),
                    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS monthly_summary_dirty (
                    userId TEXT NOT NULL,
                    month TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 1,
                    changedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (userId, month),
                    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS plaid_items (
                    itemId TEXT PRIMARY KEY,
                    userId TEXT NOT NULL,
                    accessTokenEncrypted TEXT NOT NULL,
                    cursor TEXT,
                    institutionId TEXT,
                    institutionName TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    lastSyncedAt TEXT,
                    lastError TEXT,
                    createdAt TEXT NOT NULL,
                    updatedAt TEXT NOT NULL,
                    UNIQUE(userId, itemId),
                    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS plaid_accounts (
                    plaidAccountId TEXT PRIMARY KEY,
                    itemId TEXT NOT NULL,
                    userId TEXT NOT NULL,
                    appAccountId INTEGER,
                    name TEXT,
                    officialName TEXT,
                    mask TEXT,
                    type TEXT,
                    subtype TEXT,
                    currency TEXT,
                    updatedAt TEXT NOT NULL,
                    FOREIGN KEY (itemId) REFERENCES plaid_items(itemId) ON DELETE CASCADE,
                    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (appAccountId) REFERENCES investment_accounts(id) ON DELETE SET NULL
                );

                CREATE TABLE IF NOT EXISTS transaction_sources (
                    provider TEXT NOT NULL,
                    externalId TEXT NOT NULL,
                    userId TEXT NOT NULL,
                    transactionId INTEGER NOT NULL,
                    itemId TEXT,
                    ownsTransaction INTEGER NOT NULL DEFAULT 0,
                    rawPayloadJson TEXT,
                    contextPayloadJson TEXT,
                    capturedAt TEXT,
                    createdAt TEXT NOT NULL,
                    updatedAt TEXT NOT NULL,
                    PRIMARY KEY (provider, externalId),
                    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (transactionId) REFERENCES transactions(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS plaid_webhook_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    eventKey TEXT UNIQUE NOT NULL,
                    itemId TEXT,
                    webhookType TEXT,
                    webhookCode TEXT,
                    payloadJson TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending', 'processing', 'retry', 'processed')),
                    attempts INTEGER NOT NULL DEFAULT 0,
                    receivedAt TEXT NOT NULL,
                    nextAttemptAt TEXT NOT NULL,
                    lastAttemptAt TEXT,
                    processedAt TEXT,
                    lastError TEXT,
                    updatedAt TEXT NOT NULL
                );
            `);
            await db.exec(`
                CREATE TRIGGER IF NOT EXISTS trg_monthly_summary_transaction_insert
                AFTER INSERT ON transactions
                WHEN SUBSTR(NEW.Timestamp, 1, 7) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
                BEGIN
                    INSERT INTO monthly_summary_dirty (userId, month, revision, changedAt)
                    VALUES (NEW.userId, SUBSTR(NEW.Timestamp, 1, 7), 1, CURRENT_TIMESTAMP)
                    ON CONFLICT(userId, month) DO UPDATE SET
                        revision = monthly_summary_dirty.revision + 1,
                        changedAt = CURRENT_TIMESTAMP;
                END;

                CREATE TRIGGER IF NOT EXISTS trg_monthly_summary_transaction_delete
                AFTER DELETE ON transactions
                WHEN SUBSTR(OLD.Timestamp, 1, 7) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
                BEGIN
                    INSERT INTO monthly_summary_dirty (userId, month, revision, changedAt)
                    VALUES (OLD.userId, SUBSTR(OLD.Timestamp, 1, 7), 1, CURRENT_TIMESTAMP)
                    ON CONFLICT(userId, month) DO UPDATE SET
                        revision = monthly_summary_dirty.revision + 1,
                        changedAt = CURRENT_TIMESTAMP;
                END;

                CREATE TRIGGER IF NOT EXISTS trg_monthly_summary_transaction_update
                AFTER UPDATE OF userId, AmountMinor, Category, Label, Reason, Timestamp, PortfolioAction, Account
                ON transactions
                BEGIN
                    INSERT INTO monthly_summary_dirty (userId, month, revision, changedAt)
                    SELECT OLD.userId, SUBSTR(OLD.Timestamp, 1, 7), 1, CURRENT_TIMESTAMP
                    WHERE SUBSTR(OLD.Timestamp, 1, 7) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
                    ON CONFLICT(userId, month) DO UPDATE SET
                        revision = monthly_summary_dirty.revision + 1,
                        changedAt = CURRENT_TIMESTAMP;

                    INSERT INTO monthly_summary_dirty (userId, month, revision, changedAt)
                    SELECT NEW.userId, SUBSTR(NEW.Timestamp, 1, 7), 1, CURRENT_TIMESTAMP
                    WHERE SUBSTR(NEW.Timestamp, 1, 7) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
                    ON CONFLICT(userId, month) DO UPDATE SET
                        revision = monthly_summary_dirty.revision + 1,
                        changedAt = CURRENT_TIMESTAMP;
                END;
            `);
            await db.run(`
                INSERT INTO monthly_summary_dirty (userId, month, revision, changedAt)
                SELECT DISTINCT transactions.userId, SUBSTR(transactions.Timestamp, 1, 7), 1, CURRENT_TIMESTAMP
                FROM transactions
                LEFT JOIN monthly_transaction_summaries
                  ON monthly_transaction_summaries.userId = transactions.userId
                 AND monthly_transaction_summaries.month = SUBSTR(transactions.Timestamp, 1, 7)
                WHERE monthly_transaction_summaries.userId IS NULL
                  AND SUBSTR(transactions.Timestamp, 1, 7) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
                ON CONFLICT(userId, month) DO NOTHING
            `);
            await db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_ai_briefs_user_month ON monthly_ai_briefs(userId, month);
                CREATE INDEX IF NOT EXISTS idx_monthly_transaction_summaries_user_month
                    ON monthly_transaction_summaries(userId, month DESC);
            `).catch(() => {});
            const plaidItemColumns = await db.all('PRAGMA table_info(plaid_items)');
            if (!plaidItemColumns.some((column) => column.name === 'holdingsStatus')) {
                await db.exec("ALTER TABLE plaid_items ADD COLUMN holdingsStatus TEXT NOT NULL DEFAULT 'unknown'");
            }
            if (!plaidItemColumns.some((column) => column.name === 'holdingsLastError')) {
                await db.exec('ALTER TABLE plaid_items ADD COLUMN holdingsLastError TEXT');
            }
            if (!plaidItemColumns.some((column) => column.name === 'holdingsLastSyncedAt')) {
                await db.exec('ALTER TABLE plaid_items ADD COLUMN holdingsLastSyncedAt TEXT');
            }
            if (!plaidItemColumns.some((column) => column.name === 'investmentTransactionsStatus')) {
                await db.exec("ALTER TABLE plaid_items ADD COLUMN investmentTransactionsStatus TEXT NOT NULL DEFAULT 'unknown'");
            }
            if (!plaidItemColumns.some((column) => column.name === 'investmentTransactionsLastError')) {
                await db.exec('ALTER TABLE plaid_items ADD COLUMN investmentTransactionsLastError TEXT');
            }
            if (!plaidItemColumns.some((column) => column.name === 'investmentTransactionsLastSyncedAt')) {
                await db.exec('ALTER TABLE plaid_items ADD COLUMN investmentTransactionsLastSyncedAt TEXT');
            }
            if (!plaidItemColumns.some((column) => column.name === 'lastWebhookAt')) {
                await db.exec('ALTER TABLE plaid_items ADD COLUMN lastWebhookAt TEXT');
            }
            if (!plaidItemColumns.some((column) => column.name === 'lastWebhookType')) {
                await db.exec('ALTER TABLE plaid_items ADD COLUMN lastWebhookType TEXT');
            }
            if (!plaidItemColumns.some((column) => column.name === 'lastWebhookCode')) {
                await db.exec('ALTER TABLE plaid_items ADD COLUMN lastWebhookCode TEXT');
            }
            const investmentAccountColumns = await db.all('PRAGMA table_info(investment_accounts)');
            if (!investmentAccountColumns.some((column) => column.name === 'accountRef')) {
                await db.exec('ALTER TABLE investment_accounts ADD COLUMN accountRef TEXT');
            }
            await db.exec(`
                UPDATE investment_accounts
                SET accountRef = name
                WHERE accountRef IS NULL AND name IS NOT NULL
            `);
            const portfolioTransactionColumns = await db.all('PRAGMA table_info(portfolio_transactions)');
            if (!portfolioTransactionColumns.some((column) => column.name === 'sourceTransactionId')) {
                await db.exec('ALTER TABLE portfolio_transactions ADD COLUMN sourceTransactionId INTEGER');
            }
            if (!portfolioTransactionColumns.some((column) => column.name === 'priceMicros')) {
                await db.exec('ALTER TABLE portfolio_transactions ADD COLUMN priceMicros INTEGER');
            }
            if (!portfolioTransactionColumns.some((column) => column.name === 'toSymbol')) {
                await db.exec('ALTER TABLE portfolio_transactions ADD COLUMN toSymbol TEXT');
            }
            if (!portfolioTransactionColumns.some((column) => column.name === 'toQuantity')) {
                await db.exec('ALTER TABLE portfolio_transactions ADD COLUMN toQuantity REAL');
            }

            const holdingColumns = await db.all('PRAGMA table_info(investment_holdings)');
            if (!holdingColumns.some((column) => column.name === 'averageCostMicros')) {
                await db.exec('ALTER TABLE investment_holdings ADD COLUMN averageCostMicros INTEGER');
            }
            if (!holdingColumns.some((column) => column.name === 'priceMicros')) {
                await db.exec('ALTER TABLE investment_holdings ADD COLUMN priceMicros INTEGER');
            }
            await db.run('UPDATE investment_holdings SET averageCostMicros = averageCostMinor * 10000 WHERE averageCostMicros IS NULL');
            await db.run('UPDATE investment_holdings SET priceMicros = priceMinor * 10000 WHERE priceMicros IS NULL');

            const transactionSourceColumns = await db.all('PRAGMA table_info(transaction_sources)');
            if (!transactionSourceColumns.some((column) => column.name === 'rawPayloadJson')) {
                await db.exec('ALTER TABLE transaction_sources ADD COLUMN rawPayloadJson TEXT');
            }
            if (!transactionSourceColumns.some((column) => column.name === 'contextPayloadJson')) {
                await db.exec('ALTER TABLE transaction_sources ADD COLUMN contextPayloadJson TEXT');
            }
            if (!transactionSourceColumns.some((column) => column.name === 'capturedAt')) {
                await db.exec('ALTER TABLE transaction_sources ADD COLUMN capturedAt TEXT');
            }
            const sourceMigrationTime = new Date().toISOString();
            await db.run(
                `INSERT OR IGNORE INTO transaction_sources
                    (provider, externalId, userId, transactionId, ownsTransaction, createdAt, updatedAt)
                 SELECT 'email', SourceEmailKey, userId, id, 1, ?, ?
                 FROM transactions
                 WHERE SourceEmailKey IS NOT NULL AND TRIM(SourceEmailKey) <> ''`,
                [sourceMigrationTime, sourceMigrationTime]
            );

            await db.exec(`
                CREATE INDEX IF NOT EXISTS idx_transactions_user_timestamp ON transactions(userId, Timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_transactions_user_category ON transactions(userId, Category);
                CREATE INDEX IF NOT EXISTS idx_transactions_user_reference ON transactions(userId, ReferenceNumber);
                CREATE INDEX IF NOT EXISTS idx_expense_forecast_points_user_date
                    ON expense_forecast_points(userId, forecastDate DESC, id DESC);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_source_email
                    ON transactions(SourceEmailKey) WHERE SourceEmailKey IS NOT NULL;
                CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(userId);
                CREATE INDEX IF NOT EXISTS idx_email_ingestion_pending
                    ON email_ingestion_queue(mailboxKey, uidValidity, status, uid);
                CREATE INDEX IF NOT EXISTS idx_investment_accounts_user ON investment_accounts(userId);
                CREATE INDEX IF NOT EXISTS idx_investment_holdings_account ON investment_holdings(accountId);
                CREATE INDEX IF NOT EXISTS idx_portfolio_transactions_user_date ON portfolio_transactions(userId, occurredAt DESC);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_transactions_source ON portfolio_transactions(sourceTransactionId) WHERE sourceTransactionId IS NOT NULL;
                CREATE INDEX IF NOT EXISTS idx_account_balance_events_user ON account_balance_events(userId, occurredAt DESC);
                CREATE INDEX IF NOT EXISTS idx_plaid_items_user ON plaid_items(userId);
                CREATE INDEX IF NOT EXISTS idx_plaid_accounts_item ON plaid_accounts(itemId);
                CREATE INDEX IF NOT EXISTS idx_transaction_sources_transaction ON transaction_sources(transactionId);
                CREATE INDEX IF NOT EXISTS idx_transaction_sources_user_provider ON transaction_sources(userId, provider, updatedAt DESC);
                CREATE INDEX IF NOT EXISTS idx_plaid_webhook_events_pending
                    ON plaid_webhook_events(status, nextAttemptAt, id);
            `);

            // Cleanup processed_emails older than 90 days to prevent DB bloat
            const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
            await db.run('DELETE FROM processed_emails WHERE processedAt < ?', [cutoff]);
            await applyFinancialSnapshot(db, process.env.USER_ID);
            if (process.env.MONIMONITOR_SKIP_TRANSACTION_RECONCILIATION !== '1') {
                const duplicateSummary = await reconcileTransactionDuplicates(db);
                if (duplicateSummary.merged) {
                    console.log(
                        `[Transaction deduplication] Merged ${duplicateSummary.merged} duplicate row(s); ` +
                        `removed ${duplicateSummary.removedTransactionIds.length} transaction row(s).`
                    );
                }
            }
            const historicalTransfers = await reconcileHistoricalInternalTransfers(db, process.env.USER_ID);
            if (historicalTransfers.matched) {
                console.log(`[Historical transfers] Reclassified ${historicalTransfers.matched} matched pair(s).`);
            }
            await refreshDirtyMonthlySummaries(db);
            return db;
        });

        const recoverableInitialization = initialization.catch(async (error) => {
            if (openedDb) {
                await openedDb.close().catch(() => {});
            }
            if (dbPromise === recoverableInitialization) {
                dbPromise = null;
            }
            throw error;
        });
        dbPromise = recoverableInitialization;
    }
    return dbPromise;
}

module.exports = { getDb };
