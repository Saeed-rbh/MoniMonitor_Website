require('dotenv').config();
const fs = require('node:fs/promises');
const { getDb } = require('../src/database/db');
const { parseSnapshot, assertEmptyFinancialState, importSnapshot } = require('../src/services/financialSnapshotImport');

async function main() {
    const args = process.argv.slice(2);
    const fileIndex = args.indexOf('--file');
    const userIndex = args.indexOf('--user');
    const file = fileIndex >= 0 ? args[fileIndex + 1] : null;
    const userId = userIndex >= 0 ? args[userIndex + 1] : process.env.BACKUP_OWNER_USER_ID || process.env.USER_ID;
    if (!file || !userId) throw new Error('Usage: node scripts/import-financial-snapshot.js --file <private-json-path> --user <owner-id> [--apply]');
    const snapshot = parseSnapshot(JSON.parse(await fs.readFile(file, 'utf8')));
    const db = await getDb();
    try {
        await assertEmptyFinancialState(db, userId);
        if (!args.includes('--apply')) {
            console.log(JSON.stringify({ mode: 'preview', snapshotId: snapshot.id, capturedAt: snapshot.capturedAt,
                accounts: snapshot.accounts.length, holdings: snapshot.holdings.length }, null, 2));
            return;
        }
        if (String(process.env.BACKUP_ENCRYPTION_KEY || process.env.JWT_SECRET || '').length < 16) {
            throw new Error('Configure a durable backup encryption key before importing');
        }
        const { createBackup } = require('../src/services/backupService');
        console.log(JSON.stringify(await importSnapshot(db, userId, snapshot, createBackup), null, 2));
    } finally {
        await db.close();
    }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
