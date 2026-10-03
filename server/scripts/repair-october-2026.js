// Evidence-specific repair. Preview by default; --apply backs up before writing.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { protectConnection } = require('../src/database/transactionConnection');
const { decryptString } = require('../src/services/encryptionService');
const { normalizeEmailEvidence } = require('../src/services/emailEvidence');
const { mergeTransactionRows } = require('../src/services/transactionDeduplication');
const { refreshMonthlySummary } = require('../src/database/monthlySummaries');

async function repair(db, userId, apply = false) {
    const changes = [];
    async function update(id, amountMinor, fields, evidence, deltaMinor = null) {
        const row = await db.get('SELECT * FROM transactions WHERE id = ? AND userId = ?', [id, userId]);
        if (!row || row.AmountMinor !== amountMinor) throw new Error(`Unexpected transaction ${id}; refusing repair`);
        const changed = Object.entries(fields).filter(([key, value]) => row[key] !== value);
        const event = deltaMinor === null ? null : await db.get(
            'SELECT * FROM account_balance_events WHERE sourceTransactionId = ? AND userId = ?', [id, userId]);
        if (!changed.length && (!event || event.deltaMinor === deltaMinor)) return;
        changes.push({ id, before: Object.fromEntries(changed.map(([key]) => [key, row[key]])), fields, evidence });
        if (!apply) return;
        if (changed.length) await db.run(`UPDATE transactions SET ${changed.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ? AND userId = ?`,
            [...changed.map(([, value]) => value), id, userId]);
        if (event && event.deltaMinor !== deltaMinor) {
            const account = await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?', [event.accountId, userId]);
            if (!account) throw new Error(`Missing balance account for ${id}`);
            // A current Plaid snapshot already includes real bank activity.
            if (account.balanceSource !== 'plaid' && Number(event.balanceRevision) === Number(account.balanceRevision)) {
                const balance = Number(account.cashMinor) + deltaMinor - Number(event.deltaMinor);
                if (!Number.isSafeInteger(balance)) throw new Error('Unsafe balance correction');
                await db.run('UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ? AND userId = ?',
                    [balance, new Date().toISOString(), account.id, userId]);
            }
            await db.run('UPDATE account_balance_events SET deltaMinor = ?, occurredAt = ? WHERE id = ?',
                [deltaMinor, fields.Timestamp || row.Timestamp, event.id]);
        } else if (fields.Timestamp) {
            await db.run('UPDATE account_balance_events SET occurredAt = ? WHERE sourceTransactionId = ? AND userId = ?',
                [fields.Timestamp, id, userId]);
        }
    }
    await update(64588, 1996, { Category: 'Income', Label: 'Refunds & Reversals', AccountFlow: 'IN',
        Timestamp: '2026-09-29T12:00:00.000Z' },
    'User-provided RBC bank screenshot: GOOGLE*CLOUD G7VV8V -19.96 CAD; transaction Sep 29, posted Oct 1. Email purchase wording is contradicted by bank evidence.', -1996);
    await update(64568, 500000, { Category: 'Internal', Label: 'Internal Transfer', AccountFlow: 'IN',
        Reason: 'Internal transfer: Wealthsimple Earnings -> Wealthsimple Savings', BalanceAccountId: 21 },
    'Email: From Earnings (Chequing), To Savings X05CAD. Plaid investment source: Transfer in, amount -5000.', 500000);
    await update(64570, 500000, { Category: 'Internal', Label: 'Internal Transfer', AccountFlow: 'OUT',
        Reason: 'Internal transfer: Wealthsimple Earnings -> Wealthsimple Savings' },
    'Plaid transfer-out from Earnings 1832 matches the confirmed Savings transfer.');
    const transferFields = { Category: 'Internal', Label: 'Internal Transfer', AccountFlow: 'OUT',
        Reason: 'Internal transfer: RBC Chequing -> Wealthsimple Earnings', BalanceAccountId: 8,
        BalanceAccountConfidence: 'HIGH', Account: '6554', ReferenceNumber: 'C1A3NK53zKh9' };
    await update(64569, 400000, transferFields, 'Interac confirmation: self-transfer, reference C1A3NK53zKh9.');
    const duplicate = await db.get('SELECT * FROM transactions WHERE id = 64567 AND userId = ?', [userId]);
    if (duplicate) {
        if (duplicate.AmountMinor !== 400000 || duplicate.BalanceAccountId !== 8) throw new Error('Unexpected withdrawal duplicate');
        changes.push({ merge: [64567, 64569], evidence: 'Withdrawal alert and Interac confirmation describe the same Oct 1 RBC withdrawal; matched by Wealthsimple incoming 64571.' });
        if (apply) await mergeTransactionRows(db,
            await db.get('SELECT * FROM transactions WHERE id = 64569 AND userId = ?', [userId]), duplicate);
    }
    await update(64571, 400000, { Reason: 'Internal transfer: RBC Chequing -> Wealthsimple Earnings' }, 'Plaid incoming self-transfer to Earnings.');
    for (const id of [64563, 64565, 64584, 64585]) {
        await update(id, 1000, { Account: 'S0K7', PortfolioAccountNumber: 'S0K7', PortfolioAccountId: 10,
            BalanceAccountId: 10, PortfolioConfidence: 'HIGH', BalanceAccountConfidence: 'HIGH' },
        'Linked Plaid source explicitly identifies TFSA S0K7. Currency conflict remains held for review.');
    }
    await update(64579, 65072, { Label: 'Auto Insurance', Reason: 'BELAIR AUTO Insurance' }, 'Plaid original description identifies auto insurance.');
    await update(64580, 1617, { Label: 'Home Insurance', Reason: 'BELAIR HABITAT Insurance' }, 'Plaid original description identifies home insurance.');
    // Correct all delayed RBC statement dates in the audited two-month window.
    const sources = await db.all(`SELECT t.*, s.rawPayloadJson FROM transactions t JOIN transaction_sources s
        ON t.id = s.transactionId WHERE t.userId = ? AND s.provider = 'email'
        AND t.Timestamp >= '2026-09-01' AND t.Timestamp < '2026-11-01'`, [userId]);
    const dateCandidates = new Map();
    for (const row of sources) {
        if (!row.rawPayloadJson) continue;
        const payload = JSON.parse(decryptString(row.rawPayloadJson, 'EMAIL_SOURCE_ENCRYPTION_KEY'));
        if (!payload?.rawBody) continue;
        const normalized = normalizeEmailEvidence(row, payload.rawBody, []);
        if (!/From:[^\n]*rbcroyalbankalerts@alerts\.rbc\.com/i.test(payload.rawBody)) continue;
        if (!dateCandidates.has(row.id)) dateCandidates.set(row.id, { row, dates: new Set() });
        dateCandidates.get(row.id).dates.add(String(normalized.Timestamp).slice(0, 10));
    }
    for (const { row, dates } of dateCandidates.values()) {
        // Linked alerts that disagree need review, not last-source-wins dates.
        if (dates.size !== 1) continue;
        const [date] = dates;
        if (date !== String(row.Timestamp).slice(0, 10)) {
            await update(row.id, row.AmountMinor, { Timestamp: `${date}T12:00:00.000Z` }, 'Agreed explicit transaction date in original RBC alerts.');
        }
    }
    if (apply) {
        for (const month of ['2026-09', '2026-10']) await refreshMonthlySummary(db, userId, month);
        if (changes.length) await db.run(`INSERT INTO agent_audit_log (userId, action, status, details, createdAt)
            VALUES (?, 'october_evidence_repair', 'success', ?, ?)`, [userId, JSON.stringify(changes), new Date().toISOString()]);
    }
    return changes;
}

async function main() {
    const apply = process.argv.includes('--apply');
    const filename = process.env.MONIMONITOR_DB_PATH || path.join(__dirname, '..', 'monimonitor.sqlite');
    const userIndex = process.argv.indexOf('--user');
    if (userIndex < 0 || !process.argv[userIndex + 1]) throw new Error('Specify --user tenantId');
    const userId = process.argv[userIndex + 1];
    const db = await open({ filename, driver: sqlite3.Database, mode: apply ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY });
    protectConnection(db);
    db.configure('busyTimeout', 10000);
    try {
        let backupPath = null;
        if (apply) {
            backupPath = path.join(path.dirname(filename), `monimonitor.before-october-evidence-${Date.now()}.sqlite`);
            await db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
            await db.exec('PRAGMA foreign_keys = ON');
        }
        const changes = apply ? await db.withTransaction(async () => {
            await db.run('UPDATE users SET id = id WHERE id = ?', [userId]);
            return repair(db, userId, true);
        }) : await repair(db, userId);
        console.log(JSON.stringify({ applied: apply, backupPath, changes }, null, 2));
    } finally { await db.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { repair };
