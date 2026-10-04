const DAY = 86400000;
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };

function confirmedDirectionRepair(transaction, sources, override) {
    if (override) return null;
    const candidates = sources.filter(s => s.provider === 'plaid');
    if (candidates.length !== 1) return null;
    const raw = parse(candidates[0].rawPayloadJson), context = parse(candidates[0].contextPayloadJson);
    if (raw.pending || context.providerRemoved || !Number.isFinite(raw.amount) || raw.amount === 0 || raw.iso_currency_code !== transaction.Currency ||
        Math.round(Math.abs(raw.amount) * 100) !== transaction.AmountMinor || !context.account?.appAccountId ||
        Number(context.account.appAccountId) !== Number(transaction.BalanceAccountId)) return null;
    const flow = raw.amount > 0 ? 'OUT' : 'IN';
    if (transaction.AccountFlow === flow) return null;
    const updates = { AccountFlow: flow };
    if (flow === 'IN' && transaction.Category === 'Expense') {
        const expected = require('./plaidService').toAppTransaction(raw, context.account, context.institutionName);
        updates.Category = expected.Category; updates.Label = expected.Label;
    }
    return updates;
}

function assessTransaction(transaction, sources = [], override = null, now = Date.now()) {
    const issues = [];
    // Legacy ordinary income/expense entries use category-based balance posting.
    const direction = transaction.AccountFlow || (transaction.Category === 'Income' ? 'IN' : transaction.Category === 'Expense' ? 'OUT' : null);
    const add = (kind, action) => issues.push({ key: `${kind}:${transaction.id}`, kind, transactionId: transaction.id, action });
    const posted = sources.filter(s => s.provider === 'plaid' && !parse(s.rawPayloadJson).pending && Number.isFinite(parse(s.rawPayloadJson).amount));
    for (const source of posted) {
        const raw = parse(source.rawPayloadJson);
        if (parse(source.contextPayloadJson).providerRemoved) add('removed_bank_record', 'The bank removed a reviewed record. Review the original correction before reversing it.');
        const currency = raw.iso_currency_code || raw.unofficial_currency_code;
        if (currency && currency !== transaction.Currency) add('currency_conflict', 'Review the original bank currency and exchange rate before changing this transaction.');
        if (Math.round(Math.abs(raw.amount) * 100) !== transaction.AmountMinor) add('amount_conflict', 'Compare the recorded amount with the posted bank transaction.');
        if ((raw.amount > 0 ? 'OUT' : 'IN') !== direction) add('direction_conflict', 'Compare the posted bank debit or credit with the reviewed transaction direction.');
        if (raw.amount < 0 && transaction.Category === 'Expense') add('credit_as_expense', 'Review this posted bank credit; an expense classification may overstate spending.');
    }
    const age = now - Date.parse(transaction.Timestamp);
    if (transaction.Category === 'Investment' && !transaction.PortfolioAccountId && age > 3 * DAY) add('unassigned_trade', 'Assign the investment trade to its brokerage account.');
    if (transaction.Label === 'Refunds & Reversals' && direction !== 'IN') add('refund_direction', 'Review the refund direction; a refund should reduce card debt or increase cash.');
    if (!posted.length && !override && age > 7 * DAY && sources.some(s => s.provider === 'email')) add('unconfirmed_email', 'Match the email to a posted bank record or verify it against a bank statement.');
    const bankInvestment = sources.some(s => s.provider === 'plaid_investments' && Number.isFinite(parse(s.rawPayloadJson).amount) && !parse(s.rawPayloadJson).pending && parse(s.rawPayloadJson).type !== 'cancel');
    for (const source of sources.filter(s => s.provider === 'plaid_investments')) {
        const raw = parse(source.rawPayloadJson);
        if (raw.iso_currency_code && raw.iso_currency_code !== transaction.Currency) add('currency_conflict', 'Review the brokerage currency and exchange rate against the trade confirmation.');
        if (parse(source.contextPayloadJson).providerRemoved) add('removed_bank_record', 'The bank removed a reviewed trade. Review the correction before reversing it.');
    }
    if (override) {
        const fields = parse(override.fieldsJson);
        if (Object.entries(fields).some(([key, value]) => transaction[key] !== value)) add('override_conflict', 'A recorded correction no longer matches the ledger. Review the correction audit and account postings.');
    }
    return { status: issues.length ? 'Needs review' : override ? 'Reviewed correction' : posted.length || bankInvestment ? 'Bank recorded' : 'Provisional', issues };
}

function reconcileSnapshots(account, snapshots, transactions) {
    const ordered = snapshots.filter(s => s.currency === account.currency).sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf));
    const closing = ordered.at(-1), opening = ordered.at(-2);
    // Current provider balances and date-only transactions do not share a precise cutoff.
    // A numerical match is not evidence of full coverage. Statement-cutoff snapshots
    // are required for an exact reconciliation; keep collecting provider history.
    if (!opening || !closing || opening.source !== 'statement' || closing.source !== 'statement') return { accountId: account.id, status: 'Awaiting statement cutoffs', snapshots: ordered.length };
    const relevant = transactions.filter(t => t.BalanceAccountId === account.id && Date.parse(t.Timestamp) > Date.parse(opening.asOf) && Date.parse(t.Timestamp) <= Date.parse(closing.asOf));
    if (relevant.some(t => t.Currency !== account.currency || !['IN', 'OUT'].includes(t.AccountFlow))) return { accountId: account.id, status: 'Incomplete evidence' };
    const credit = account.accountType === 'Credit Card';
    const activityMinor = relevant.reduce((sum, t) => sum + t.AmountMinor * (t.AccountFlow === 'IN' ? 1 : -1) * (credit ? -1 : 1), 0);
    const differenceMinor = closing.cashMinor - opening.cashMinor - activityMinor;
    return { accountId: account.id, status: differenceMinor ? 'Needs review' : 'Reconciled', differenceMinor, openingAsOf: opening.asOf, closingAsOf: closing.asOf };
}

async function persistIncidents(db, userId, scope, issues, now = new Date().toISOString()) {
    const next = new Map(issues.map(i => [`${scope}:${i.key || i.id}`, i]));
    await db.withTransaction(async () => {
        const previous = await db.all('SELECT * FROM reliability_incidents WHERE userId = ? AND kind = ? AND resolvedAt IS NULL', [userId, scope]);
        const keys = new Set(previous.map(i => i.incidentKey));
        const transitions = [];
        const notify = async (key, issue, state) => transitions.push({ key, issue, state });
        for (const [key, issue] of next) {
            await db.run(`INSERT INTO reliability_incidents VALUES (?,?,?,?,?,?,NULL)
                ON CONFLICT(userId,incidentKey) DO UPDATE SET detailsJson=excluded.detailsJson, updatedAt=excluded.updatedAt,
                openedAt=CASE WHEN reliability_incidents.resolvedAt IS NULL THEN reliability_incidents.openedAt ELSE excluded.openedAt END, resolvedAt=NULL`,
                [userId, key, scope, JSON.stringify(issue), now, now]);
            if (!keys.has(key)) await notify(key, issue, 'needs attention');
        }
        for (const incident of previous) if (!next.has(incident.incidentKey)) {
            await db.run('UPDATE reliability_incidents SET resolvedAt=?, updatedAt=? WHERE userId=? AND incidentKey=?', [now, now, userId, incident.incidentKey]);
            await notify(incident.incidentKey, parse(incident.detailsJson), 'resolved');
        }
        if (scope === 'financial' && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
            const opened = transitions.filter(t => t.state === 'needs attention');
            const transactionIds = [...new Set(opened.map(t => t.issue.transactionId).filter(Boolean))].slice(0, 5);
            const buttons = [];
            for (const id of transactionIds) {
                const tx = await db.get('SELECT * FROM transactions WHERE userId=? AND id=?', [userId, id]);
                if (tx) buttons.push([{ text: require('./reliabilityReview').title(tx).slice(0, 100), callback_data: `review:${id}` }]);
            }
            // One quiet transaction inbox update; no resolved-count or operations chatter.
            if (buttons.length) {
                const payload = { text: require('./telegramService').e('Transactions to review\nChoose a transaction below. I’ll ask one question at a time. More are available in Profile → Transactions to review.'),
                    replyMarkup: { inline_keyboard: buttons }, silent: true, reliabilityFormatVersion: 2 };
                await db.run(`INSERT INTO telegram_outbox(action,payloadJson,status,attempts,nextAttemptAt,createdAt) VALUES ('sendMessage',?,'pending',0,?,?)`, [JSON.stringify(payload), now, now]);
            }
        }
    });
}

async function checkFinancialReliability(userId, { force = false } = {}) {
    const { getDb } = require('../database/db');
    const db = await getDb();
    const cached = await db.get('SELECT * FROM reliability_runs WHERE userId=?', [userId]);
    if (!force && cached && parse(cached.reportJson).cards && Date.now() - Date.parse(cached.checkedAt) < 15 * 60000) return parse(cached.reportJson);
    const transactions = await db.all("SELECT * FROM transactions WHERE userId=? AND Timestamp >= ?", [userId, new Date(Date.now() - 90 * DAY).toISOString()]);
    const sources = await db.all('SELECT s.* FROM transaction_sources s JOIN transactions t ON t.id=s.transactionId AND t.userId=s.userId WHERE s.userId=? AND t.Timestamp>=?', [userId, new Date(Date.now() - 90 * DAY).toISOString()]);
    const overrides = await db.all('SELECT * FROM transaction_overrides WHERE userId=?', [userId]);
    const accounts = await db.all('SELECT * FROM investment_accounts WHERE userId=?', [userId]);
    const snapshots = await db.all('SELECT * FROM balance_snapshots WHERE userId=?', [userId]);
    const sourceMap = new Map(), overrideMap = new Map(overrides.map(o => [o.transactionId, o]));
    for (const s of sources) { if (!sourceMap.has(s.transactionId)) sourceMap.set(s.transactionId, []); sourceMap.get(s.transactionId).push(s); }
    const statuses = {}, issues = [];
    for (const t of transactions) {
        const repair = confirmedDirectionRepair(t, sourceMap.get(t.id) || [], overrideMap.get(t.id));
        if (repair) await db.withTransaction(async () => {
            const service = require('../database/dbService');
            await service.updateTransactionForUser(t.id, userId, repair);
            await service.syncTransactionAccountBalance(userId, t.id, { accountId: t.BalanceAccountId, confidence: 'HIGH' });
            await db.run("INSERT INTO agent_audit_log(userId,action,status,details,createdAt) VALUES (?,'confirmed_bank_direction_repair','success',?,?)", [userId, JSON.stringify({ transactionId: t.id, fields: repair }), new Date().toISOString()]);
            Object.assign(t, repair);
        });
        const assessment = assessTransaction(t, sourceMap.get(t.id), overrideMap.get(t.id));
        statuses[t.id] = assessment.status; issues.push(...assessment.issues);
        if (t.Category === 'Internal' && t.ReferenceNumber?.startsWith('XFER-') && Date.now() - Date.parse(t.Timestamp) > 3 * DAY && !transactions.some(other => other.id !== t.id && other.ReferenceNumber === t.ReferenceNumber && other.Currency === t.Currency && other.AmountMinor === t.AmountMinor && other.AccountFlow !== t.AccountFlow)) issues.push({ key: `transfer_leg:${t.id}`, kind: 'transfer_leg', transactionId: t.id, action: 'Find the other account’s transfer entry or verify that it is outside the tracked accounts.' });
    }
    const accountChecks = accounts.map(a => reconcileSnapshots(a, snapshots.filter(s => s.accountId === a.id), transactions));
    for (const a of accountChecks) if (a.status === 'Needs review') issues.push({ key: `balance:${a.accountId}`, kind: 'balance', accountId: a.accountId, action: 'Compare opening balance, posted activity and closing statement balance at the same cutoff.' });
    // Exact bank identifiers are safe duplicate evidence; similar amounts alone are not.
    const ids = new Map();
    for (const source of sources) if (source.provider.startsWith('plaid')) {
        const raw = parse(source.rawPayloadJson), id = raw.transaction_id || raw.investment_transaction_id;
        if (!id) continue;
        const key = `${source.provider}:${source.itemId}:${id}`;
        if (ids.has(key) && ids.get(key) !== source.transactionId) issues.push({ key: `duplicate:${source.transactionId}`, kind: 'duplicate', transactionId: source.transactionId, action: 'Merge the duplicate bank entry while preserving both source records.' });
        ids.set(key, source.transactionId);
    }
    const reviews = new Map((await db.all('SELECT * FROM reliability_reviews WHERE userId=?', [userId])).map(r => [r.issueKey, r]));
    const { fingerprint } = require('./reliabilityReview');
    const unique = [...new Map(issues.map(i => [i.key, i])).values()].filter(issue => {
        const review = reviews.get(issue.key), tx = transactions.find(t => t.id === issue.transactionId);
        return !review || !tx || review.fingerprint !== fingerprint(tx, sourceMap.get(tx.id) || []);
    });
    for (const tx of transactions) {
        if (unique.some(i => i.transactionId === tx.id)) statuses[tx.id] = 'Needs review';
        else if ([...reviews.values()].some(r => r.issueKey.endsWith(`:${tx.id}`) && r.fingerprint === fingerprint(tx, sourceMap.get(tx.id) || []))) statuses[tx.id] = 'User reviewed';
    }
    const cards = [...new Set(unique.map(i => i.transactionId).filter(Boolean))].map(id => {
        const t = transactions.find(t => t.id === id);
        return { id, title: t.Reason || t.Label || 'Transaction', amount: Number(t.Amount), currency: t.Currency, date: t.Timestamp, account: t.Account || t.BankName, questions: unique.filter(i => i.transactionId === id).length };
    });
    const report = { checkedAt: new Date().toISOString(), status: unique.length ? 'Needs review' : 'No detected conflicts', issues: unique, cards, statuses, accounts: accountChecks, coverageDays: 90 };
    await persistIncidents(db, userId, 'financial', unique);
    await db.run(`INSERT INTO reliability_runs VALUES (?,?,?) ON CONFLICT(userId) DO UPDATE SET checkedAt=excluded.checkedAt,reportJson=excluded.reportJson`, [userId, report.checkedAt, JSON.stringify(report)]);
    return report;
}

module.exports = { assessTransaction, reconcileSnapshots, persistIncidents, checkFinancialReliability, confirmedDirectionRepair };
