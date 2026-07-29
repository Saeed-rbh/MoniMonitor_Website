const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

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
                    password TEXT NOT NULL
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
            const transactionColumns = await db.all("PRAGMA table_info(transactions)");
            const hasColumn = (name) => transactionColumns.some((column) => column.name === name);
            if (!hasColumn("AmountMinor")) await db.exec("ALTER TABLE transactions ADD COLUMN AmountMinor INTEGER");
            if (!hasColumn("Currency")) await db.exec("ALTER TABLE transactions ADD COLUMN Currency TEXT NOT NULL DEFAULT 'USD'");
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

                CREATE TABLE IF NOT EXISTS agent_audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    details TEXT,
                    createdAt TEXT NOT NULL,
                    FOREIGN KEY (userId) REFERENCES users(id)
                );
            `);

            await db.exec(`
                CREATE INDEX IF NOT EXISTS idx_transactions_user_timestamp ON transactions(userId, Timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_transactions_user_category ON transactions(userId, Category);
                CREATE INDEX IF NOT EXISTS idx_transactions_user_reference ON transactions(userId, ReferenceNumber);
                CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(userId);
            `);

            // Cleanup processed_emails older than 90 days to prevent DB bloat
            const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
            await db.run('DELETE FROM processed_emails WHERE processedAt < ?', [cutoff]);
            return db;
        });
    }
    return dbPromise;
}

module.exports = { getDb };
