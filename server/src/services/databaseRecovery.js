const { refreshDirtyMonthlySummaries } = require('../database/monthlySummaries');
const quote = value => `"${String(value).replaceAll('"', '""')}"`;
// Restoring older data must not reset the current provider usage budget.
const PRESERVE = new Set(['app_migrations', 'schema_migrations', 'ai_usage_daily']);
const INVALIDATE = new Set(['auth_sessions', 'rate_limits', 'monthly_ai_briefs',
    'monthly_transaction_summaries', 'monthly_summary_dirty', 'expense_forecast_points']);

async function restoreDatabase(db, sourcePath, afterRestore = async () => {}) {
    // All table discovery and writes use one serialized connection scope.
    return db.withTransaction(async () => {
        await db.exec(`ATTACH DATABASE '${String(sourcePath).replaceAll("'", "''")}' AS recovery`);
        try {
            const integrity = await db.get('PRAGMA recovery.integrity_check');
            if (integrity?.integrity_check !== 'ok') throw new Error('Selected backup failed integrity verification');
            const tables = async schema => (await db.all(`SELECT name FROM ${schema}.sqlite_master
                WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY (name = 'users') DESC, name`)).map(row => row.name);
            const current = await tables('main');
            const saved = new Set(await tables('recovery'));
            const unknown = [...saved].filter(table => !current.includes(table));
            if (unknown.length) throw new Error(`Backup contains unsupported tables: ${unknown.join(', ')}`);
            if (saved.has('schema_migrations')) {
                const oldVersion = await db.get('SELECT MAX(version) AS version FROM recovery.schema_migrations');
                const currentVersion = await db.get('SELECT MAX(version) AS version FROM schema_migrations');
                if (oldVersion.version > currentVersion.version) throw new Error('Backup was created by a newer app version');
            }
            await db.exec('PRAGMA defer_foreign_keys = ON');
            const restored = current.filter(table => !PRESERVE.has(table) && !INVALIDATE.has(table));
            for (const table of [...current].reverse()) {
                if (!PRESERVE.has(table)) await db.exec(`DELETE FROM ${quote(table)}`);
            }
            for (const table of restored) {
                if (!saved.has(table)) continue; // New tables start empty, never retain data from the replaced database.
                const targetColumns = await db.all(`PRAGMA main.table_info(${quote(table)})`);
                const savedColumns = new Set((await db.all(`PRAGMA recovery.table_info(${quote(table)})`)).map(column => column.name));
                const columns = targetColumns.map(column => column.name).filter(column => savedColumns.has(column));
                if (!columns.length) throw new Error(`Backup table ${table} has no compatible columns`);
                const list = columns.map(quote).join(', ');
                await db.exec(`INSERT INTO ${quote(table)} (${list}) SELECT ${list} FROM recovery.${quote(table)}`);
            }
            if (restored.includes('email_ingestion_queue')) await db.exec(`UPDATE email_ingestion_queue SET status = 'retry',
                leaseOwner = NULL, leaseExpiresAt = NULL, nextAttemptAt = NULL WHERE status = 'processing'`);
            if (restored.includes('plaid_webhook_events')) await db.exec(`UPDATE plaid_webhook_events SET status = 'retry',
                nextAttemptAt = CURRENT_TIMESTAMP WHERE status = 'processing'`);
            // Delivery acknowledgements cannot be rolled back at Telegram. Do not automatically resend old pending notifications.
            if (restored.includes('telegram_outbox')) await db.exec(`UPDATE telegram_outbox SET status = 'dead',
                leaseOwner = NULL, leaseExpiresAt = NULL, lastError = 'Recovery: verify prior delivery before retrying'
                WHERE status IN ('pending', 'retry', 'processing')`);
            await db.exec('DELETE FROM monthly_summary_dirty');
            await db.exec(`INSERT INTO monthly_summary_dirty (userId, month, revision, changedAt)
                SELECT DISTINCT userId, SUBSTR(Timestamp, 1, 7), 1, CURRENT_TIMESTAMP FROM transactions`);
            await refreshDirtyMonthlySummaries(db);
            const foreignKeys = await db.all('PRAGMA foreign_key_check');
            if (foreignKeys.length) throw new Error('Restored data failed foreign-key verification');
            await afterRestore();
            return { restoredTables: restored.filter(table => saved.has(table)), invalidatedTables: [...INVALIDATE] };
        } finally {
            // SQLite cannot detach while this transaction reads the source. Detach after commit in the outer finally.
        }
    }).finally(async () => { await db.exec('DETACH DATABASE recovery').catch(() => {}); });
}

module.exports = { restoreDatabase };
