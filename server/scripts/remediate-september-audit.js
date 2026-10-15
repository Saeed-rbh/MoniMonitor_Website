// Evidence-based human audit and remediation for September 2026 transactions.
// Preview by default; run with --apply to apply after creating an encrypted/snapshot backup.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { protectConnection } = require('../src/database/transactionConnection');
const { mergeTransactionRows } = require('../src/services/transactionDeduplication');
const { refreshMonthlySummary } = require('../src/database/monthlySummaries');

async function repair(db, userId, apply = false) {
    const now = new Date().toISOString();
    const changes = [];

    // 1. Merge #1: Tx 64158 ($200 RBC withdrawal) into Tx 64159 ($200 Interac e-Transfer to SEP Immigration)
    const t64159 = await db.get('SELECT * FROM transactions WHERE id = 64159 AND userId = ?', [userId]);
    const t64158 = await db.get('SELECT * FROM transactions WHERE id = 64158 AND userId = ?', [userId]);
    if (t64159 && t64158) {
        changes.push({ merge: [64158, 64159], evidence: 'RBC withdrawal alert and Interac confirmation describe same $200 Sep 28 transfer to SEP Immigration.' });
        if (apply) await mergeTransactionRows(db, t64159, t64158);
    }

    // 2. Merge #2: Tx 64141 ($330 RBC withdrawal) into Tx 64145 ($330 Interac e-Transfer to Bahrami)
    const t64145 = await db.get('SELECT * FROM transactions WHERE id = 64145 AND userId = ?', [userId]);
    const t64141 = await db.get('SELECT * FROM transactions WHERE id = 64141 AND userId = ?', [userId]);
    if (t64145 && t64141) {
        changes.push({ merge: [64141, 64145], evidence: 'RBC withdrawal alert and Interac acceptance describe same $330 Sep 26-27 transfer to Bahrami.' });
        if (apply) {
            await db.run(`
                UPDATE transactions
                SET Account = '6554', BalanceAccountId = 8, AccountFlow = 'OUT',
                    BalanceAccountConfidence = 'HIGH', Category = 'Expense', Label = 'Personal Transfers'
                WHERE id = 64145
            `);
            const updated = await db.get('SELECT * FROM transactions WHERE id = 64145');
            await mergeTransactionRows(db, updated, t64141);
        }
    }

    // 3. Merge #3: Tx 64166 ($42.89 redundant Plaid transfer-in) into Tx 64132 ($42.89 Future->TFSA leg)
    const t64132 = await db.get('SELECT * FROM transactions WHERE id = 64132 AND userId = ?', [userId]);
    const t64166 = await db.get('SELECT * FROM transactions WHERE id = 64166 AND userId = ?', [userId]);
    if (t64132 && t64166) {
        changes.push({ merge: [64166, 64132], evidence: 'Redundant Plaid investment transfer-in duplicate of already-paired 64132 TFSA transfer leg.' });
        if (apply) await mergeTransactionRows(db, t64132, t64166);
    }

    // 4. Merge #4: Tx 64149 ($1,007.11 processing crypto send) into Tx 64150 ($1,007.43 completed send)
    const t64150 = await db.get('SELECT * FROM transactions WHERE id = 64150 AND userId = ?', [userId]);
    const t64149 = await db.get('SELECT * FROM transactions WHERE id = 64149 AND userId = ?', [userId]);
    if (t64150 && t64149) {
        changes.push({ merge: [64149, 64150], evidence: 'Preliminary processing email duplicate of completed transfer email for 0.26499 ETH.' });
        if (apply) await mergeTransactionRows(db, t64150, t64149);
    }

    // 5. Transfer Fix: Tx 64151 and Tx 64147 (Wealthsimple Earnings -> Crypto $1,032.29)
    const t64151 = await db.get('SELECT * FROM transactions WHERE id = 64151 AND userId = ?', [userId]);
    if (t64151 && t64151.Category !== 'Internal') {
        changes.push({ id: 64151, fix: 'Expense to Internal Transfer OUT ($1032.29)' });
        if (apply) {
            await db.run(`
                UPDATE transactions
                SET Category = 'Internal', Label = 'Internal Transfer',
                    Reason = 'Internal transfer: Wealthsimple Earnings -> Wealthsimple Crypto',
                    AccountFlow = 'OUT', BalanceAccountId = 12, BalanceAccountConfidence = 'HIGH',
                    ReferenceNumber = 'XFER-20260927-103229-1832-LZ12'
                WHERE id = 64151 AND userId = ?
            `, [userId]);
        }
    }

    const t64147 = await db.get('SELECT * FROM transactions WHERE id = 64147 AND userId = ?', [userId]);
    if (t64147 && t64147.AccountFlow !== 'IN') {
        changes.push({ id: 64147, fix: 'Crypto transfer AccountFlow OUT to IN ($1032.29)' });
        if (apply) {
            await db.run(`
                UPDATE transactions
                SET Category = 'Internal', Label = 'Internal Transfer',
                    Reason = 'Internal transfer: Wealthsimple Earnings -> Wealthsimple Crypto',
                    AccountFlow = 'IN', Account = 'LZ12', BalanceAccountId = 13, PortfolioAccountId = 13,
                    BalanceAccountConfidence = 'HIGH', PortfolioConfidence = 'HIGH',
                    ReferenceNumber = 'XFER-20260927-103229-1832-LZ12'
                WHERE id = 64147 AND userId = ?
            `, [userId]);
            await db.run(`UPDATE account_balance_events SET deltaMinor = 103229 WHERE sourceTransactionId = 64147 AND userId = ?`, [userId]);
        }
    }

    // 6. Reversal Flow: Tx 64079 Google Services reversal ($2.00)
    const t64079 = await db.get('SELECT * FROM transactions WHERE id = 64079 AND userId = ?', [userId]);
    if (t64079 && t64079.AccountFlow !== 'IN') {
        changes.push({ id: 64079, fix: 'Reversal AccountFlow set to IN ($2.00)' });
        if (apply) {
            await db.run(`UPDATE transactions SET AccountFlow = 'IN', BalanceAccountId = 9, BalanceAccountConfidence = 'HIGH' WHERE id = 64079 AND userId = ?`, [userId]);
        }
    }

    // 7. Currency conflict reviews for recurring daily TFSA ETF purchases
    const conflictReviews = await db.all(`
        SELECT r.transactionId
        FROM transaction_ingestion_reviews r
        JOIN transactions t ON t.id = r.transactionId
        WHERE t.userId = ? AND t.Timestamp >= '2026-09-01' AND t.Timestamp < '2026-10-01'
          AND r.reason = 'provider_currency_conflict' AND r.resolvedAt IS NULL
    `, [userId]);
    if (conflictReviews.length) {
        changes.push({ count: conflictReviews.length, fix: 'Resolved provider currency conflicts for September ETF purchases' });
        if (apply) {
            for (const r of conflictReviews) {
                await db.run(`
                    UPDATE transactions
                    SET Account = 'S0K7', PortfolioAccountNumber = 'S0K7', PortfolioAccountId = 10,
                        BalanceAccountId = 10, PortfolioConfidence = 'HIGH', BalanceAccountConfidence = 'HIGH'
                    WHERE id = ? AND userId = ?
                `, [r.transactionId, userId]);
                await db.run(`UPDATE transaction_ingestion_reviews SET resolvedAt = ? WHERE transactionId = ?`, [now, r.transactionId]);
            }
        }
    }

    if (apply) {
        await refreshMonthlySummary(db, userId, '2026-09');
        await db.run(`
            INSERT INTO agent_audit_log (userId, action, status, details, createdAt)
            VALUES (?, 'september_2026_remediation_audit', 'success', ?, ?)
        `, [userId, JSON.stringify(changes), now]);
    }

    return changes;
}

async function main() {
    const apply = process.argv.includes('--apply');
    const filename = process.env.MONIMONITOR_DB_PATH || path.join(__dirname, '..', 'monimonitor.sqlite');
    const userId = process.env.USER_ID || '1';
    const db = await open({
        filename,
        driver: sqlite3.Database,
        mode: apply ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY
    });
    protectConnection(db);
    db.configure('busyTimeout', 10000);
    try {
        let backupPath = null;
        if (apply) {
            backupPath = path.join(path.dirname(filename), `monimonitor.before-september-audit-${Date.now()}.sqlite`);
            await db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
            await db.exec('PRAGMA foreign_keys = ON');
        }
        const changes = apply ? await db.withTransaction(async () => {
            await db.run('UPDATE users SET id = id WHERE id = ?', [userId]);
            return repair(db, userId, true);
        }) : await repair(db, userId, false);
        console.log(JSON.stringify({ applied: apply, backupPath, changes }, null, 2));
    } finally {
        await db.close();
    }
}

if (require.main === module) main().catch(err => { console.error(err); process.exitCode = 1; });
module.exports = { repair };
