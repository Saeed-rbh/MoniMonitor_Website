// Read-only preview by default. --apply makes a consistent SQLite backup and
// repairs only the requested tenant/month, retaining every source payload.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { protectConnection } = require('../src/database/transactionConnection');
const { runMigrations } = require('../src/database/migrations');
const { decryptString } = require('../src/services/encryptionService');
const { normalizeEmailEvidence, emailNotificationKind } = require('../src/services/emailEvidence');
const { toAppInvestmentTransaction } = require('../src/services/plaidService');
const { scoreTransactionMatch, matchesInvestmentIdentity, mergeTransactionRows,
    isDepositNotice, isInteracDeposit } = require('../src/services/transactionDeduplication');
const { refreshMonthlySummary } = require('../src/database/monthlySummaries');

function decode(source) {
    if (!source.rawPayloadJson) return null;
    return JSON.parse(source.provider === 'email'
        ? decryptString(source.rawPayloadJson, 'EMAIL_SOURCE_ENCRYPTION_KEY') : source.rawPayloadJson);
}

async function planRepair(db, userId, month) {
    // Include the final local evening, which falls in the next UTC month.
    // Keep imported date-only records on the requested bank statement month.
    const [year, number] = month.split('-').map(Number);
    const nextUtc = new Date(Date.UTC(year, number, 1));
    const zoneName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto',
        timeZoneName: 'longOffset' }).formatToParts(nextUtc).find(p => p.type === 'timeZoneName').value;
    const zone = zoneName.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!zone) throw new Error('Cannot resolve local month boundary');
    const offset = (Number(zone[2]) * 60 + Number(zone[3])) * (zone[1] === '+' ? 1 : -1);
    const end = new Date(nextUtc.getTime() - offset * 60000).toISOString();
    const originals = await db.all(`SELECT * FROM transactions WHERE userId = ? AND Timestamp >= ? AND Timestamp < ? ORDER BY id`,
        [userId, `${month}-01T00:00:00.000Z`, end]);
    const rows = originals.map(row => ({ ...row }));
    const byId = new Map(rows.map(row => [row.id, row]));
    const sources = await db.all(`SELECT s.* FROM transaction_sources s JOIN transactions t ON t.id = s.transactionId
        WHERE t.userId = ? AND s.userId = t.userId AND t.Timestamp >= ? AND t.Timestamp < ?`,
        [userId, `${month}-01T00:00:00.000Z`, end]);
    const accounts = await db.all('SELECT * FROM investment_accounts WHERE userId = ?', [userId]);
    const plan = { scanned: rows.length, timestampCorrections: [], sourceRelinks: [], merges: [],
        accountCorrections: [], reviews: [], contexts: [], updates: [] };
    const held = new Map();
    const decoded = new Map();
    for (const source of sources) {
        const payload = decode(source);
        decoded.set(source, payload);
        if (source.provider !== 'email' || !payload) continue;
        const row = byId.get(source.transactionId);
        const body = String(payload.rawBody || '');
        const normalized = normalizeEmailEvidence(row, body, accounts);
        if (normalized.Timestamp !== row.Timestamp) plan.timestampCorrections.push({ id: row.id, from: row.Timestamp, to: normalized.Timestamp });
        Object.assign(row, normalized);
        if (normalized.IngestionReviewReason) held.set(row.id, { id: row.id, reason: normalized.IngestionReviewReason, candidates: [] });
        const context = JSON.parse(source.contextPayloadJson || '{}');
        context.notificationKind = emailNotificationKind(body, row);
        plan.contexts.push({ provider: source.provider, externalId: source.externalId, context });
    }

    // Repair wrong-action investment links before looking for duplicate rows.
    // The source account and security are authoritative for provider activity.
    for (const source of sources.filter(s => s.provider === 'plaid_investments')) {
        const payload = decoded.get(source);
        if (!payload) continue;
        const context = JSON.parse(source.contextPayloadJson || '{}');
        const account = { ...context.account, appAccountId: context.account?.appAccountId };
        const incoming = toAppInvestmentTransaction(payload, account, context.security || {}, context.institutionName);
        const row = byId.get(source.transactionId);
        if (!incoming || row.Category === 'Internal') continue;
        if (row.PortfolioAction !== incoming.PortfolioAction) {
            const candidates = rows.filter(candidate => candidate.id !== row.id &&
                candidate.AmountMinor === incoming.AmountMinor && matchesInvestmentIdentity(candidate, incoming) &&
                candidate.PortfolioSymbol === incoming.PortfolioSymbol &&
                String(candidate.Timestamp).slice(0, 10) === String(incoming.Timestamp).slice(0, 10) &&
                candidate.BankName?.toLowerCase().includes('wealthsimple'));
            if (candidates.length !== 1) {
                held.set(row.id, { id: row.id, reason: 'conflicting_investment_source', candidates: candidates.map(c => c.id) });
                continue;
            }
            const target = candidates[0];
            plan.sourceRelinks.push({ provider: source.provider, externalId: source.externalId,
                from: row.id, to: target.id, action: incoming.PortfolioAction });
            source.transactionId = target.id;
        }
        const target = byId.get(source.transactionId);
        // Account identity can be confirmed by the linked bank source even
        // when the provider disagrees with the email's currency. Retain that
        // disagreement as a posting hold rather than converting money.
        const currencyConflict = String(target.Currency || 'CAD').toUpperCase() !== incoming.Currency;
        if (matchesInvestmentIdentity({ ...target, Currency: incoming.Currency }, incoming)) {
            target.PortfolioAccountId = incoming.PortfolioAccountId;
            target.BalanceAccountId = incoming.BalanceAccountId;
            target.PortfolioConfidence = target.BalanceAccountConfidence = 'HIGH';
            target.Account = incoming.Account;
            target.PortfolioAccountNumber = incoming.PortfolioAccountNumber;
            if (currencyConflict) held.set(target.id, { id: target.id,
                reason: 'provider_currency_conflict', candidates: [] });
            else held.delete(target.id);
        }
    }
    for (const row of rows) {
        row.hasPlaidSource = sources.some(s => s.transactionId === row.id && s.provider === 'plaid');
        row.hasPlaidInvestmentSource = sources.some(s => s.transactionId === row.id && s.provider === 'plaid_investments');
    }
    const removed = new Set();
    for (const row of rows) {
        if (removed.has(row.id) || !row.SourceEmailKey) continue;
        const possible = rows.filter(other => other.id !== row.id && !removed.has(other.id) &&
            other.AmountMinor === row.AmountMinor && Math.abs(new Date(row.Timestamp) - new Date(other.Timestamp)) <= 3 * 86400000);
        const noticePairs = possible.filter(other => ((isDepositNotice(row) && isInteracDeposit(other)) ||
            (isInteracDeposit(row) && isDepositNotice(other))) &&
            String(other.Account || '').replace(/\D/g, '').slice(-4) === String(row.Account || '').replace(/\D/g, '').slice(-4) &&
            String(other.Timestamp).slice(0, 10) === String(row.Timestamp).slice(0, 10));
        const matches = possible.map(other => ({ other, match: scoreTransactionMatch(other, row) }))
            .filter(entry => entry.match).sort((a, b) => b.match.score - a.match.score);
        if (noticePairs.length > 1 || (noticePairs.length && !matches.length)) {
            held.set(row.id, { id: row.id, reason: 'possible_duplicate', candidates: noticePairs.map(r => r.id) });
            continue;
        }
        if (!matches.length || (matches[1] && matches[0].match.score === matches[1].match.score)) continue;
        const other = matches[0].other;
        const canonical = isInteracDeposit(other) ? other : row;
        const duplicate = canonical === row ? other : row;
        plan.merges.push({ canonicalId: canonical.id, duplicateId: duplicate.id, amountMinor: row.AmountMinor });
        removed.add(duplicate.id);
        if (canonical.PortfolioAction && other.hasPlaidInvestmentSource) {
            canonical.PortfolioAccountId = other.PortfolioAccountId;
            canonical.BalanceAccountId = other.BalanceAccountId;
            canonical.PortfolioConfidence = canonical.BalanceAccountConfidence = 'HIGH';
            canonical.Account = other.Account;
            canonical.PortfolioAccountNumber = other.PortfolioAccountNumber;
            held.delete(canonical.id);
        }
        held.delete(duplicate.id);
    }
    const fields = ['Timestamp', 'Label', 'Reason', 'Type', 'Account', 'PortfolioAccountNumber', 'PortfolioAccountId',
        'BalanceAccountId', 'PortfolioConfidence', 'BalanceAccountConfidence', 'AccountFlow'];
    for (const row of rows) {
        const original = originals.find(r => r.id === row.id);
        const updates = Object.fromEntries(fields.filter(f => row[f] !== original[f]).map(f => [f, row[f]]));
        if (Object.keys(updates).length) plan.updates.push({ id: row.id, fields: updates });
        if (!removed.has(row.id) && row.BalanceAccountId !== original.BalanceAccountId) {
            plan.accountCorrections.push({ id: row.id, from: original.BalanceAccountId, to: row.BalanceAccountId });
        }
    }
    plan.reviews = [...held.values()].filter(review => !removed.has(review.id));
    return plan;
}

async function reverseBalanceEvent(db, userId, id) {
    const event = await db.get('SELECT * FROM account_balance_events WHERE sourceTransactionId = ? AND userId = ?', [id, userId]);
    if (!event) return 0;
    const account = await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?', [event.accountId, userId]);
    if (!account) throw new Error(`Missing account for transaction ${id}`);
    const livePosting = account.balanceSource !== 'plaid' && Number(account.balanceRevision) === Number(event.balanceRevision);
    if (livePosting) {
        const restored = Number(account.cashMinor) - Number(event.deltaMinor);
        if (!Number.isSafeInteger(restored)) throw new Error('Unsafe balance reversal');
        await db.run('UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ?', [restored, new Date().toISOString(), account.id]);
    }
    await db.run('DELETE FROM account_balance_events WHERE id = ?', [event.id]);
    return livePosting ? -Number(event.deltaMinor) : 0;
}

async function applyPlan(db, userId, month, plan) {
    const now = new Date().toISOString();
    const balanceCorrections = [];
    for (const correction of plan.accountCorrections) {
        const deltaMinor = await reverseBalanceEvent(db, userId, correction.id);
        if (deltaMinor) balanceCorrections.push({ transactionId: correction.id, accountId: correction.from, deltaMinor });
    }
    for (const update of plan.updates) {
        const keys = Object.keys(update.fields);
        await db.run(`UPDATE transactions SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND userId = ?`,
            [...Object.values(update.fields), update.id, userId]);
    }
    for (const source of plan.contexts) {
        await db.run('UPDATE transaction_sources SET contextPayloadJson = ? WHERE provider = ? AND externalId = ? AND userId = ?',
            [JSON.stringify(source.context), source.provider, source.externalId, userId]);
    }
    for (const relink of plan.sourceRelinks) {
        await db.run(`UPDATE transaction_sources SET transactionId = ?, ownsTransaction = 0, updatedAt = ?
            WHERE provider = ? AND externalId = ? AND transactionId = ? AND userId = ?`,
            [relink.to, now, relink.provider, relink.externalId, relink.from, userId]);
    }
    for (const merge of plan.merges) {
        const before = await db.all('SELECT id, cashMinor FROM investment_accounts WHERE userId = ?', [userId]);
        await mergeTransactionRows(db, await db.get('SELECT * FROM transactions WHERE id = ?', [merge.canonicalId]),
            await db.get('SELECT * FROM transactions WHERE id = ?', [merge.duplicateId]));
        for (const account of before) {
            const after = await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id]);
            if (after.cashMinor !== account.cashMinor) balanceCorrections.push({ transactionId: merge.duplicateId,
                accountId: account.id, deltaMinor: after.cashMinor - account.cashMinor });
        }
    }
    for (const review of plan.reviews) {
        await db.run(`INSERT INTO transaction_ingestion_reviews (transactionId, reason, candidateIdsJson, createdAt)
            VALUES (?, ?, ?, ?) ON CONFLICT(transactionId) DO UPDATE SET reason = excluded.reason,
            candidateIdsJson = excluded.candidateIdsJson, resolvedAt = NULL`, [review.id, review.reason, JSON.stringify(review.candidates), now]);
    }
    const heldIds = new Set(plan.reviews.map(r => r.id));
    for (const update of plan.updates) {
        if (!heldIds.has(update.id)) await db.run('UPDATE transaction_ingestion_reviews SET resolvedAt = ? WHERE transactionId = ?', [now, update.id]);
    }
    await refreshMonthlySummary(db, userId, month);
    await db.run(`INSERT INTO agent_audit_log (userId, action, status, details, createdAt) VALUES (?, ?, ?, ?, ?)`,
        [userId, 'monthly_duplicate_repair', 'success', JSON.stringify({ month, plan, balanceCorrections }), now]);
    return balanceCorrections;
}

async function main() {
    const args = process.argv.slice(2);
    const month = args[args.indexOf('--month') + 1];
    const userId = args.includes('--user') ? args[args.indexOf('--user') + 1] : process.env.BACKUP_OWNER_USER_ID || process.env.USER_ID;
    if (!args.includes('--month') || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !userId) throw new Error('Specify --month YYYY-MM and --user tenantId');
    const apply = args.includes('--apply');
    const filename = process.env.MONIMONITOR_DB_PATH || path.join(__dirname, '..', 'monimonitor.sqlite');
    const db = await open({ filename, driver: sqlite3.Database, mode: apply ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY });
    protectConnection(db);
    db.configure('busyTimeout', 10000);
    try {
        if (!apply) return console.log(JSON.stringify({ dryRun: true, month, ...(await planRepair(db, userId, month)) }, null, 2));
        const backupPath = path.join(path.dirname(filename), `monimonitor.before-duplicate-protocol-${month}-${Date.now()}.sqlite`);
        await db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
        await db.exec('PRAGMA foreign_keys = ON');
        await runMigrations(db);
        const result = await db.withTransaction(async () => {
            // Acquire the writer lock before reading the live ledger.
            await db.run('UPDATE users SET id = id WHERE id = ?', [userId]);
            const plan = await planRepair(db, userId, month);
            const balances = await applyPlan(db, userId, month, plan);
            return { plan, balances };
        });
        console.log(JSON.stringify({ applied: true, month, backupPath, ...result }, null, 2));
    } finally { await db.close(); }
}

if (require.main === module) main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
module.exports = { planRepair, applyPlan };
