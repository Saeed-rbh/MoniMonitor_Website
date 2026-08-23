const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { getDb } = require('../database/db');

const BACKUP_DIRECTORY = process.env.MONIMONITOR_BACKUP_DIR
    ? path.resolve(process.env.MONIMONITOR_BACKUP_DIR)
    : path.join(__dirname, '..', '..', 'backups');
const BACKUP_INTERVAL_HOURS = Math.max(
    1,
    Number(process.env.MONIMONITOR_BACKUP_INTERVAL_HOURS) || 24
);
const BACKUP_INTERVAL_MS = BACKUP_INTERVAL_HOURS * 60 * 60 * 1000;
const BACKUP_FILE_PATTERN = /^monimonitor-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(automatic|manual|pre-restore)-[a-f0-9]{8}\.sqlite$/;
const INSERT_ORDER = [
    'users',
    'user_settings',
    'budgets',
    'goals',
    'accounts',
    'investment_accounts',
    'transactions',
    'expense_forecast_points',
    'merchant_rules',
    'processed_emails',
    'email_sync_state',
    'email_ingestion_queue',
    'investment_holdings',
    'portfolio_transactions',
    'account_balance_events',
    'plaid_items',
    'plaid_accounts',
    'transaction_sources',
    'plaid_webhook_events',
    'agent_audit_log',
    'app_migrations',
];

let backupPromise = null;
let scheduler = null;

const quoteSqlString = (value) => String(value).replaceAll("'", "''");
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const isSafeBackupFileName = (fileName) => BACKUP_FILE_PATTERN.test(String(fileName || ''));

const backupReason = (fileName) => {
    const match = String(fileName || '').match(BACKUP_FILE_PATTERN);
    return match?.[1] || 'unknown';
};

const isoWeekKey = (value) => {
    const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
};

const selectBackupNamesToKeep = (backups = []) => {
    const sorted = [...backups].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const keep = new Set();
    const manual = sorted.filter((item) => item.reason !== 'automatic');
    manual.slice(0, 10).forEach((item) => keep.add(item.fileName));

    const automatic = sorted.filter((item) => item.reason === 'automatic');
    const daily = new Set();
    const weekly = new Set();
    const monthly = new Set();
    automatic.forEach((item) => {
        const date = new Date(item.createdAt);
        if (Number.isNaN(date.getTime())) return;
        const dayKey = date.toISOString().slice(0, 10);
        const weekKey = isoWeekKey(date);
        const monthKey = date.toISOString().slice(0, 7);
        if (daily.size < 7 && !daily.has(dayKey)) {
            daily.add(dayKey);
            keep.add(item.fileName);
        }
        if (weekly.size < 4 && !weekly.has(weekKey)) {
            weekly.add(weekKey);
            keep.add(item.fileName);
        }
        if (monthly.size < 12 && !monthly.has(monthKey)) {
            monthly.add(monthKey);
            keep.add(item.fileName);
        }
    });
    return keep;
};

async function verifyBackupFile(filePath) {
    const verificationDb = await open({
        filename: filePath,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY,
    });
    try {
        const result = await verificationDb.get('PRAGMA integrity_check');
        if (result?.integrity_check !== 'ok') throw new Error('Backup integrity check failed');
        const requiredTables = await verificationDb.all(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'transactions', 'investment_accounts')"
        );
        if (requiredTables.length !== 3) throw new Error('Backup is missing required MoniMonitor tables');
        return true;
    } finally {
        await verificationDb.close();
    }
}

async function listBackups() {
    await fs.mkdir(BACKUP_DIRECTORY, { recursive: true });
    const entries = await fs.readdir(BACKUP_DIRECTORY, { withFileTypes: true });
    const backups = await Promise.all(entries
        .filter((entry) => entry.isFile() && isSafeBackupFileName(entry.name))
        .map(async (entry) => {
            const stats = await fs.stat(path.join(BACKUP_DIRECTORY, entry.name));
            return {
                fileName: entry.name,
                createdAt: stats.mtime.toISOString(),
                sizeBytes: stats.size,
                reason: backupReason(entry.name),
            };
        }));
    return backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function pruneBackups() {
    const backups = await listBackups();
    const keep = selectBackupNamesToKeep(backups);
    await Promise.all(backups
        .filter((item) => !keep.has(item.fileName))
        .map((item) => fs.rm(path.join(BACKUP_DIRECTORY, item.fileName), { force: true })));
}

async function performBackup(reason) {
    await fs.mkdir(BACKUP_DIRECTORY, { recursive: true });
    const safeReason = ['automatic', 'manual', 'pre-restore'].includes(reason) ? reason : 'manual';
    const timestamp = new Date().toISOString().replaceAll(':', '-').replace('.', '-');
    const fileName = `monimonitor-${timestamp}-${safeReason}-${crypto.randomUUID().slice(0, 8)}.sqlite`;
    const filePath = path.join(BACKUP_DIRECTORY, fileName);
    const db = await getDb();

    await db.exec('PRAGMA wal_checkpoint(RESTART)');
    try {
        await db.exec(`VACUUM INTO '${quoteSqlString(filePath)}'`);
        await verifyBackupFile(filePath);
    } catch (error) {
        await fs.rm(filePath, { force: true }).catch(() => {});
        throw error;
    }

    await pruneBackups();
    const stats = await fs.stat(filePath);
    return {
        fileName,
        createdAt: stats.mtime.toISOString(),
        sizeBytes: stats.size,
        reason: safeReason,
    };
}

async function createBackup(reason = 'manual') {
    if (!backupPromise) {
        backupPromise = performBackup(reason).finally(() => { backupPromise = null; });
    }
    return backupPromise;
}

async function getBackupStatus() {
    const backups = await listBackups();
    return { lastBackup: backups[0] || null, backups };
}

async function resolveBackupPath(fileName) {
    if (!isSafeBackupFileName(fileName)) throw new Error('Invalid backup file name');
    const filePath = path.join(BACKUP_DIRECTORY, fileName);
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) throw new Error('Backup not found');
    return filePath;
}

async function restoreBackup(fileName, restoredByUserId) {
    const filePath = await resolveBackupPath(fileName);
    await verifyBackupFile(filePath);
    const safetyBackup = await createBackup('pre-restore');
    const db = await getDb();
    const sourcePath = quoteSqlString(filePath);
    let attached = false;

    try {
        await db.exec(`ATTACH DATABASE '${sourcePath}' AS restore_source`);
        attached = true;
        const integrity = await db.get('PRAGMA restore_source.integrity_check');
        if (integrity?.integrity_check !== 'ok') throw new Error('Selected backup failed integrity verification');

        const currentTables = new Set((await db.all(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )).map((row) => row.name));
        const sourceTables = new Set((await db.all(
            "SELECT name FROM restore_source.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )).map((row) => row.name));
        const tables = INSERT_ORDER.filter((table) => currentTables.has(table) && sourceTables.has(table));
        const sourceHasDurableEmailState = sourceTables.has('email_sync_state') &&
            sourceTables.has('email_ingestion_queue');
        const sourceHasPlaidState = sourceTables.has('plaid_items') &&
            sourceTables.has('plaid_accounts') && sourceTables.has('transaction_sources');

        await db.exec('BEGIN IMMEDIATE');
        if (!sourceHasPlaidState) {
            if (currentTables.has('transaction_sources')) await db.exec('DELETE FROM transaction_sources');
            if (currentTables.has('plaid_accounts')) await db.exec('DELETE FROM plaid_accounts');
            if (currentTables.has('plaid_items')) await db.exec('DELETE FROM plaid_items');
        }
        for (const table of [...tables].reverse()) {
            await db.exec(`DELETE FROM ${quoteIdentifier(table)}`);
        }
        for (const table of tables) {
            const currentColumns = await db.all(`PRAGMA table_info(${quoteIdentifier(table)})`);
            const sourceColumns = new Set((await db.all(
                `PRAGMA restore_source.table_info(${quoteIdentifier(table)})`
            )).map((column) => column.name));
            const columns = currentColumns.map((column) => column.name)
                .filter((column) => sourceColumns.has(column));
            if (!columns.length) continue;
            const columnList = columns.map(quoteIdentifier).join(', ');
            await db.exec(
                `INSERT INTO ${quoteIdentifier(table)} (${columnList}) ` +
                `SELECT ${columnList} FROM restore_source.${quoteIdentifier(table)}`
            );
        }
        if (!sourceHasDurableEmailState) {
            if (currentTables.has('email_ingestion_queue')) await db.exec('DELETE FROM email_ingestion_queue');
            if (currentTables.has('email_sync_state')) await db.exec('DELETE FROM email_sync_state');
        }
        if (currentTables.has('agent_audit_log')) {
            await db.run(
                `INSERT INTO agent_audit_log (userId, action, status, details, createdAt)
                 VALUES (?, 'backup_restore', 'success', ?, ?)`,
                [restoredByUserId, JSON.stringify({ fileName, safetyBackup: safetyBackup.fileName }), new Date().toISOString()]
            );
        }
        await db.exec('COMMIT');
    } catch (error) {
        await db.exec('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        if (attached) await db.exec('DETACH DATABASE restore_source').catch(() => {});
    }

    return { restoredFrom: fileName, safetyBackup };
}

async function ensureAutomaticBackup() {
    const { backups } = await getBackupStatus();
    const latestAutomatic = backups.find((item) => item.reason === 'automatic');
    if (!latestAutomatic || Date.now() - new Date(latestAutomatic.createdAt).getTime() >= BACKUP_INTERVAL_MS) {
        return createBackup('automatic');
    }
    return latestAutomatic;
}

function startAutomaticBackups() {
    if (scheduler) return scheduler;
    ensureAutomaticBackup().catch((error) => console.error('Automatic backup failed:', error.message));
    scheduler = setInterval(() => {
        ensureAutomaticBackup().catch((error) => console.error('Automatic backup failed:', error.message));
    }, Math.min(BACKUP_INTERVAL_MS, 6 * 60 * 60 * 1000));
    scheduler.unref?.();
    return scheduler;
}

module.exports = {
    createBackup,
    getBackupStatus,
    isSafeBackupFileName,
    listBackups,
    resolveBackupPath,
    restoreBackup,
    selectBackupNamesToKeep,
    startAutomaticBackups,
};
