const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { getDb } = require('../database/db');
const { encryptFile, decryptFile } = require('./encryptedFileService');
const { pauseWorkers, resumeWorkers, registerWorker } = require('./workerLifecycle');

const BACKUP_DIRECTORY = process.env.MONIMONITOR_BACKUP_DIR
    ? path.resolve(process.env.MONIMONITOR_BACKUP_DIR)
    : path.join(__dirname, '..', '..', 'backups');
const BACKUP_INTERVAL_HOURS = Math.max(
    1,
    Number(process.env.MONIMONITOR_BACKUP_INTERVAL_HOURS) || 24
);
const BACKUP_INTERVAL_MS = BACKUP_INTERVAL_HOURS * 60 * 60 * 1000;
const OFFSITE_BACKUP_DIRECTORY = process.env.BACKUP_OFFSITE_DIRECTORY
    ? path.resolve(process.env.BACKUP_OFFSITE_DIRECTORY)
    : null;
const RESTORE_DRILL_INTERVAL_MS = Math.max(1, Number(process.env.BACKUP_RESTORE_DRILL_INTERVAL_DAYS) || 30) * 24 * 60 * 60 * 1000;
const BACKUP_FILE_PATTERN = /^monimonitor-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(automatic|manual|pre-restore)-[a-f0-9]{8}\.sqlite(?:\.enc)?$/;
const { restoreDatabase } = require('./databaseRecovery');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const executeFile = promisify(execFile);

let backupPromise = null;
let scheduler = null;
let restoreDrillPromise = null;
let restoreInProgress = false;
let restoreDrill = { lastRunAt: null, lastSuccessAt: null, lastError: null };
const verificationStatePath = path.join(BACKUP_DIRECTORY, 'verification-state.json');
let offsiteVerification = null;
let verificationStateLoaded = false;
async function loadVerificationState() {
    if (verificationStateLoaded) return;
    try {
        const state = JSON.parse(await fs.readFile(verificationStatePath, 'utf8'));
        restoreDrill = state.restoreDrill || restoreDrill;
        offsiteVerification = state.offsiteVerification || null;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    verificationStateLoaded = true;
}
async function saveVerificationState() {
    await fs.mkdir(BACKUP_DIRECTORY, { recursive: true });
    const temporary = `${verificationStatePath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ restoreDrill, offsiteVerification }));
    await fs.rename(temporary, verificationStatePath);
}
async function verifyCopiedFile(original, copy) {
    const digest = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    if (await digest(original) !== await digest(copy)) throw new Error('Offsite backup readback did not match');
}

const quoteSqlString = (value) => String(value).replaceAll("'", "''");
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
    await loadVerificationState();
    await fs.mkdir(BACKUP_DIRECTORY, { recursive: true });
    const safeReason = ['automatic', 'manual', 'pre-restore'].includes(reason) ? reason : 'manual';
    const timestamp = new Date().toISOString().replaceAll(':', '-').replace('.', '-');
    const fileName = `monimonitor-${timestamp}-${safeReason}-${crypto.randomUUID().slice(0, 8)}.sqlite.enc`;
    const filePath = path.join(BACKUP_DIRECTORY, fileName);
    const temporaryPath = `${filePath}.tmp.sqlite`;
    const db = await getDb();

    await db.exec('PRAGMA wal_checkpoint(RESTART)');
    try {
        await db.exec(`VACUUM INTO '${quoteSqlString(temporaryPath)}'`);
        await verifyBackupFile(temporaryPath);
        await encryptFile(temporaryPath, filePath);
    } catch (error) {
        await fs.rm(filePath, { force: true }).catch(() => {});
        throw error;
    } finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }

    await pruneBackups();
    if (OFFSITE_BACKUP_DIRECTORY) {
        try {
            await fs.mkdir(OFFSITE_BACKUP_DIRECTORY, { recursive: true });
            const copyPath = path.join(OFFSITE_BACKUP_DIRECTORY, fileName);
            await fs.copyFile(filePath, copyPath);
            await verifyCopiedFile(filePath, copyPath);
            offsiteVerification = { fileName, verifiedAt: new Date().toISOString(), verified: true };
        } catch (error) {
            offsiteVerification = { fileName, verified: false };
            await saveVerificationState();
            throw error;
        }
        await saveVerificationState();
    }
    const stats = await fs.stat(filePath);
    return {
        fileName,
        createdAt: stats.mtime.toISOString(),
        sizeBytes: stats.size,
        reason: safeReason,
        offsiteStored: Boolean(OFFSITE_BACKUP_DIRECTORY),
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

async function getBackupHealth() {
    await loadVerificationState();
    const { lastBackup } = await getBackupStatus();
    const ageSeconds = lastBackup ? Math.max(0, Math.floor((Date.now() - new Date(lastBackup.createdAt).getTime()) / 1000)) : null;
    return {
        lastBackup,
        ageSeconds,
        stale: !lastBackup || ageSeconds > BACKUP_INTERVAL_MS / 1000 * 2,
        offsiteConfigured: Boolean(OFFSITE_BACKUP_DIRECTORY),
        offsiteVerified: Boolean(offsiteVerification?.verified && offsiteVerification.fileName === lastBackup?.fileName),
        restoreDrill,
    };
}

async function runRestoreDrill() {
    if (restoreDrillPromise) return restoreDrillPromise;
    restoreDrillPromise = (async () => {
        await loadVerificationState();
        restoreDrill = { ...restoreDrill, lastRunAt: new Date().toISOString(), lastError: null };
        const { lastBackup } = await getBackupStatus();
        if (!lastBackup) {
            restoreDrill.lastError = 'No backup is available for a restore drill';
            await saveVerificationState();
            throw new Error(restoreDrill.lastError);
        }
        const filePath = await resolveBackupPath(lastBackup.fileName);
        const drillPath = `${filePath}.drill-${crypto.randomUUID()}.sqlite`;
        try {
            const restoreSource = OFFSITE_BACKUP_DIRECTORY ? path.join(OFFSITE_BACKUP_DIRECTORY, lastBackup.fileName) : filePath;
            if (OFFSITE_BACKUP_DIRECTORY) await verifyCopiedFile(filePath, restoreSource);
            await decryptFile(restoreSource, drillPath);
            await verifyBackupFile(drillPath);
            const targetPath = `${drillPath}.application.sqlite`;
            try {
                await executeFile(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'restore-drill.js'), drillPath], {
                    timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024,
                    env: { ...process.env, MONIMONITOR_DB_PATH: targetPath, MONIMONITOR_RESTORE_DRILL: '1',
                        AI_INGESTION_ENABLED: 'false', TELEGRAM_DISABLE_NETWORK: 'true' },
                });
            } finally {
                for (const suffix of ['', '-wal', '-shm', '.encryption-keys.local']) await fs.rm(`${targetPath}${suffix}`, { force: true }).catch(() => {});
            }
            restoreDrill = { ...restoreDrill, lastSuccessAt: new Date().toISOString(), lastError: null };
            return { fileName: lastBackup.fileName, verified: true };
        } catch (error) {
            restoreDrill = { ...restoreDrill, lastError: String(error.message || error) };
            throw error;
        } finally {
            await fs.rm(drillPath, { force: true }).catch(() => {});
            await saveVerificationState();
        }
    })().finally(() => { restoreDrillPromise = null; });
    return restoreDrillPromise;
}

async function ensureRestoreDrill() {
    await loadVerificationState();
    const lastSuccessfulRun = new Date(restoreDrill.lastSuccessAt || 0).getTime();
    if (!Number.isFinite(lastSuccessfulRun) || Date.now() - lastSuccessfulRun >= RESTORE_DRILL_INTERVAL_MS) {
        return runRestoreDrill();
    }
    return { skipped: true };
}

async function resolveBackupPath(fileName) {
    if (!isSafeBackupFileName(fileName)) throw new Error('Invalid backup file name');
    const filePath = path.join(BACKUP_DIRECTORY, fileName);
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) throw new Error('Backup not found');
    return filePath;
}

async function restoreBackup(fileName, restoredByUserId) {
    if (restoreInProgress) throw new Error('A restore is already in progress');
    restoreInProgress = true;
    try { return await performRestore(fileName, restoredByUserId); }
    finally { restoreInProgress = false; }
}

async function performRestore(fileName, restoredByUserId) {
    const filePath = await resolveBackupPath(fileName);
    const restoredTempPath = `${filePath}.restore-${crypto.randomUUID()}.sqlite`;
    let safetyBackup;
    let db;
    let restored = false;

    try {
        await pauseWorkers();
        await decryptFile(filePath, restoredTempPath);
        await verifyBackupFile(restoredTempPath);
        safetyBackup = await createBackup('pre-restore');
        db = await getDb();
        await restoreDatabase(db, restoredTempPath, async () => {
            await db.run(`INSERT INTO agent_audit_log (userId, action, status, details, createdAt)
                VALUES (?, 'backup_restore', 'success', ?, ?)`,
                [restoredByUserId, JSON.stringify({ fileName, safetyBackup: safetyBackup.fileName }), new Date().toISOString()]);
        });
        restored = true;
    } catch (error) {
        throw error;
    } finally {
        await fs.rm(restoredTempPath, { force: true }).catch(() => {});
        if (!restored) await resumeWorkers().catch(() => {});
    }

    return { restoredFrom: fileName, safetyBackup, restartRequired: true };
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
    ensureAutomaticBackup()
        .then(() => ensureRestoreDrill())
        .catch((error) => console.error('Automatic backup or restore drill failed:', error.message));
    scheduler = setInterval(() => {
        ensureAutomaticBackup()
            .then(() => ensureRestoreDrill())
            .catch((error) => console.error('Automatic backup or restore drill failed:', error.message));
    }, Math.min(BACKUP_INTERVAL_MS, 6 * 60 * 60 * 1000));
    scheduler.unref?.();
    registerWorker('backups', { pause: stopAutomaticBackups, resume: startAutomaticBackups });
    return scheduler;
}

async function stopAutomaticBackups() {
    clearInterval(scheduler); scheduler = null;
    await Promise.allSettled([backupPromise, restoreDrillPromise].filter(Boolean));
}

module.exports = {
    createBackup,
    getBackupStatus,
    getBackupHealth,
    isSafeBackupFileName,
    listBackups,
    resolveBackupPath,
    runRestoreDrill,
    restoreBackup,
    selectBackupNamesToKeep,
    startAutomaticBackups,
    stopAutomaticBackups,
    verifyCopiedFile,
};
