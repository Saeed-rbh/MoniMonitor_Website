const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const { applyFinancialSnapshot } = require('./financialSnapshot');

const DB_PATH = path.join(__dirname, '..', '..', 'monimonitor.sqlite');

let dbPromise = null;

async function getDb() {
    if (!dbPromise) {
        dbPromise = open({
            filename: DB_PATH,
            driver: sqlite3.Database
        }).then(async (db) => {
            await db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    profilePhotoUrl TEXT
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

                CREATE TABLE IF NOT EXISTS merchant_rules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    pattern TEXT NOT NULL,
                    category TEXT NOT NULL,
                    label TEXT NOT NULL,
                    UNIQUE(userId, pattern)
                );
            `);
            const userColumns = await db.all("PRAGMA table_info(users)");
            if (!userColumns.some((column) => column.name === "profilePhotoUrl")) {
                await db.exec("ALTER TABLE users ADD COLUMN profilePhotoUrl TEXT");
            }
            const transactionColumns = await db.all("PRAGMA table_info(transactions)");
            const hasColumn = (name) => transactionColumns.some((column) => column.name === name);
            if (!hasColumn("AmountMinor")) await db.exec("ALTER TABLE transactions ADD COLUMN AmountMinor INTEGER");
            if (!hasColumn("Currency")) await db.exec("ALTER TABLE transactions ADD COLUMN Currency TEXT NOT NULL DEFAULT 'USD'");
            if (!hasColumn("PortfolioAction")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioAction TEXT");
            if (!hasColumn("PortfolioAccountId")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioAccountId INTEGER");
            if (!hasColumn("PortfolioConfidence")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioConfidence TEXT");
            if (!hasColumn("PortfolioSymbol")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioSymbol TEXT");
            if (!hasColumn("PortfolioQuantity")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioQuantity REAL");
            if (!hasColumn("PortfolioPrice")) await db.exec("ALTER TABLE transactions ADD COLUMN PortfolioPrice REAL");
            await db.run("UPDATE transactions SET AmountMinor = ROUND(Amount * 100) WHERE AmountMinor IS NULL");

            await db.exec(`
                CREATE TABLE IF NOT EXISTS user_settings (
                    userId TEXT PRIMARY KEY,
                    currency TEXT NOT NULL DEFAULT 'USD',
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
                    currency TEXT NOT NULL DEFAULT 'USD',
                    UNIQUE(userId, category, month),
                    FOREIGN KEY (userId) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS goals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    name TEXT NOT NULL,
                    targetMinor INTEGER NOT NULL CHECK(targetMinor > 0),
                    currentMinor INTEGER NOT NULL DEFAULT 0 CHECK(currentMinor >= 0),
                    currency TEXT NOT NULL DEFAULT 'USD',
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
                    currency TEXT NOT NULL DEFAULT 'USD',
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
                    currency TEXT NOT NULL DEFAULT 'USD',
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
            `);
            const investmentAccountColumns = await db.all('PRAGMA table_info(investment_accounts)');
            if (!investmentAccountColumns.some((column) => column.name === 'accountRef')) {
                await db.exec('ALTER TABLE investment_accounts ADD COLUMN accountRef TEXT');
            }
            await db.exec(`
                UPDATE investment_accounts
                SET accountRef = CASE name
                    WHEN 'CIBC Chequing' THEN '6768237'
                    WHEN 'RBC Chequing' THEN '03481-5026554'
                    WHEN 'RBC Visa' THEN '4510 **** **** 2379'
                    WHEN 'TFSA' THEN 'TFSA'
                    WHEN 'Future' THEN '•••• 1234'
                    WHEN 'Earnings' THEN '•••• 1832'
                    ELSE accountRef
                END
                WHERE accountRef IS NULL
            `);
            const portfolioTransactionColumns = await db.all('PRAGMA table_info(portfolio_transactions)');
            if (!portfolioTransactionColumns.some((column) => column.name === 'sourceTransactionId')) {
                await db.exec('ALTER TABLE portfolio_transactions ADD COLUMN sourceTransactionId INTEGER');
            }
            if (!portfolioTransactionColumns.some((column) => column.name === 'priceMicros')) {
                await db.exec('ALTER TABLE portfolio_transactions ADD COLUMN priceMicros INTEGER');
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

            await db.exec(`
                CREATE INDEX IF NOT EXISTS idx_transactions_user_timestamp ON transactions(userId, Timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_transactions_user_category ON transactions(userId, Category);
                CREATE INDEX IF NOT EXISTS idx_transactions_user_reference ON transactions(userId, ReferenceNumber);
                CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(userId);
                CREATE INDEX IF NOT EXISTS idx_investment_accounts_user ON investment_accounts(userId);
                CREATE INDEX IF NOT EXISTS idx_investment_holdings_account ON investment_holdings(accountId);
                CREATE INDEX IF NOT EXISTS idx_portfolio_transactions_user_date ON portfolio_transactions(userId, occurredAt DESC);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_transactions_source ON portfolio_transactions(sourceTransactionId) WHERE sourceTransactionId IS NOT NULL;
                CREATE INDEX IF NOT EXISTS idx_account_balance_events_user ON account_balance_events(userId, occurredAt DESC);
            `);

            // Cleanup processed_emails older than 90 days to prevent DB bloat
            const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
            await db.run('DELETE FROM processed_emails WHERE processedAt < ?', [cutoff]);
            await applyFinancialSnapshot(db, process.env.USER_ID);
            return db;
        });
    }
    return dbPromise;
}

module.exports = { getDb };
