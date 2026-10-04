const crypto = require('node:crypto');
const service = require('../database/dbService');
const { TransactionMutationError } = require('./transactionMutations');

const questions = {
    unconfirmed_email: 'Does this transaction appear on your bank statement with this amount, currency and date?',
    currency_conflict: 'Which currency does your statement or trade confirmation show for this amount?',
    amount_conflict: 'Does your statement confirm the amount shown here?',
    transfer_leg: 'Where is the other side of this transfer?',
    unassigned_trade: 'Which brokerage account was this trade made in?',
    direction_conflict: 'Did money come into this account or leave it?',
    credit_as_expense: 'Was this a refund credited back to your account?',
    refund_direction: 'Was this a refund credited back to your account?',
    removed_bank_record: 'The bank removed this record. Does your statement still confirm it?',
    override_conflict: 'Does your statement confirm the transaction currently shown?',
    duplicate: 'Is this a separate real transaction on your statement?',
};
function fingerprint(transaction, sources) {
    // Ignore display/worker metadata; reopen the question when financial evidence changes.
    const fields = ['AmountMinor', 'Currency', 'Category', 'Label', 'Timestamp', 'AccountFlow', 'BalanceAccountId', 'PortfolioAccountId', 'ReferenceNumber'];
    return crypto.createHash('sha256').update(JSON.stringify([
        fields.map(k => transaction[k] ?? null),
        sources.map(s => [s.provider, s.externalId, s.rawPayloadJson, s.contextPayloadJson]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ])).digest('hex');
}
function title(t) { return `${t.Reason || t.Label || 'Transaction'} · ${t.Currency} ${Number(t.Amount).toFixed(2)}`; }

async function getReview(userId, id) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new TransactionMutationError('Invalid transaction id');
    const db = await service.getDb();
    const transaction = await service.getTransactionById(id, userId);
    if (!transaction) throw new TransactionMutationError('Transaction not found', 404);
    const report = await require('./financialReliability').checkFinancialReliability(userId);
    const issue = report.issues.find(i => i.transactionId === id);
    if (!issue) return { transaction, resolved: true, question: 'This transaction has no open review questions.', options: [] };
    const sources = await db.all('SELECT * FROM transaction_sources WHERE userId=? AND transactionId=?', [userId, id]);
    const options = [];
    if (issue.kind === 'transfer_leg') {
        const candidates = await db.all(`SELECT * FROM transactions WHERE userId=? AND id<>? AND Category='Internal'
            AND Currency=? AND AmountMinor=? AND AccountFlow IN ('IN','OUT') AND AccountFlow<>?
            AND BalanceAccountId IS NOT NULL AND BalanceAccountId<>?
            AND ABS(julianday(Timestamp)-julianday(?))<=7 ORDER BY Timestamp DESC LIMIT 8`,
            [userId, id, transaction.Currency, transaction.AmountMinor, transaction.AccountFlow, transaction.BalanceAccountId, transaction.Timestamp]);
        for (const t of candidates) options.push({ value: `pair-${t.id}`, label: `Link ${title(t)} · ${t.Account || t.BankName || 'Other account'} · ${t.Timestamp.slice(0, 10)}` });
        options.push({ value: 'outside', label: 'The other account is outside MoniMonitor' });
    } else if (issue.kind === 'unassigned_trade') {
        const accounts = await db.all("SELECT * FROM investment_accounts WHERE userId=? AND accountType NOT IN ('Credit Card','Chequing','Checking','Savings') ORDER BY name LIMIT 30", [userId]);
        for (const a of accounts) options.push({ value: `account-${a.id}`, label: `${a.name || a.accountName || a.institutionName || 'Account'} (${a.currency})` });
    } else {
        options.push({ value: 'confirm', label: issue.kind === 'currency_conflict' ? `My statement confirms ${transaction.Currency} ${Number(transaction.Amount).toFixed(2)}` : ['direction_conflict', 'credit_as_expense', 'refund_direction'].includes(issue.kind) ? `Keep this record: my statement confirms money ${transaction.AccountFlow === 'IN' || transaction.Category === 'Income' ? 'coming in' : 'going out'}` : 'Yes, my statement confirms this transaction' });
        for (const source of sources) {
            let raw; try { raw = JSON.parse(source.rawPayloadJson || '{}'); } catch { continue; }
            if (!source.provider.startsWith('plaid') || raw.pending) continue;
            const currency = raw.iso_currency_code;
            if (issue.kind === 'currency_conflict' && /^[A-Z]{3}$/.test(currency || '') && currency !== transaction.Currency && !options.some(o => o.value === `currency-${currency}`)) options.push({ value: `currency-${currency}`, label: `My statement confirms ${currency} for this amount` });
            if (issue.kind === 'amount_conflict' && Number.isFinite(raw.amount) && raw.amount !== 0 && !options.some(o => o.value === `amount-${Math.round(Math.abs(raw.amount) * 100)}`)) options.push({ value: `amount-${Math.round(Math.abs(raw.amount) * 100)}`, label: `Use the bank amount: ${currency || transaction.Currency} ${Math.abs(raw.amount).toFixed(2)}` });
        }
        if (['direction_conflict', 'credit_as_expense', 'refund_direction'].includes(issue.kind)) {
            options.push({ value: 'refund', label: 'It was a refund / money coming in' });
            if (issue.kind === 'direction_conflict') options.push({ value: 'expense', label: 'It was a payment / money going out' });
        }
    }
    options.push({ value: 'later', label: 'I need to check first' });
    return { transaction, issueKey: issue.key, question: questions[issue.kind] || 'Does your statement confirm this transaction?', options, fingerprint: fingerprint(transaction, sources) };
}

async function answerReview(userId, id, input) {
    const db = await service.getDb();
    await db.withTransaction(async () => {
        const review = await getReview(userId, id);
        if (review.resolved) return;
        if (input.issueKey !== review.issueKey || !input.fingerprint || ![review.fingerprint, review.fingerprint.slice(0, 12)].includes(input.fingerprint)) throw new TransactionMutationError('The transaction changed. Reopen the question before answering.', 409);
        if (!review.options.some(o => o.value === input.answer)) throw new TransactionMutationError('Choose an available answer');
        if (input.answer === 'later') return;
        const tx = review.transaction;
        if (input.answer.startsWith('pair-')) {
            const otherId = Number(input.answer.slice(5));
            const reference = `XFER-REVIEW-${Math.min(id, otherId)}-${Math.max(id, otherId)}`;
            for (const txId of [id, otherId]) await service.updateTransactionForUser(txId, userId, { ReferenceNumber: reference }, { reviewed: true });
        } else if (input.answer.startsWith('account-')) {
            if (await db.get('SELECT id FROM portfolio_transactions WHERE sourceTransactionId=? AND userId=? AND reversedAt IS NULL', [id, userId])) throw new TransactionMutationError('Review the existing portfolio posting before changing its account', 409);
            await service.updateTransactionForUser(id, userId, { PortfolioAccountId: Number(input.answer.slice(8)) }, { reviewed: true });
        } else if (input.answer.startsWith('currency-') || input.answer.startsWith('amount-')) {
            await require('./transactionMutations').updateTransaction(userId, id, input.answer.startsWith('currency-') ? { Currency: input.answer.slice(9) } : { Amount: Number(input.answer.slice(7)) / 100 });
        } else if (input.answer === 'refund' || input.answer === 'expense') {
            // Reuse existing posting guards; do not change linked portfolio activity.
            if (await db.get('SELECT id FROM portfolio_transactions WHERE sourceTransactionId=? AND userId=? AND reversedAt IS NULL', [id, userId])) throw new TransactionMutationError('Reverse the linked portfolio activity before changing its direction', 409);
            const incoming = input.answer === 'refund';
            await service.updateTransactionForUser(id, userId, { Category: incoming ? 'Income' : 'Expense', Label: incoming ? 'Refunds & Reversals' : 'Other Expense', AccountFlow: incoming ? 'IN' : 'OUT' }, { reviewed: true });
            const posting = await service.syncTransactionAccountBalance(userId, id, { accountId: tx.BalanceAccountId, confidence: 'HIGH' });
            if (!['applied', 'not_balance_posting', 'snapshot_preserved'].includes(posting.status)) throw new TransactionMutationError(posting.reason || 'Account posting needs review', 409);
        }
        const current = await service.getTransactionById(id, userId);
        const sources = await db.all('SELECT * FROM transaction_sources WHERE userId=? AND transactionId=?', [userId, id]);
        await db.run(`INSERT INTO reliability_reviews VALUES (?,?,?,?,?) ON CONFLICT(userId,issueKey)
            DO UPDATE SET fingerprint=excluded.fingerprint,answer=excluded.answer,reviewedAt=excluded.reviewedAt`,
            [userId, review.issueKey, fingerprint(current, sources), input.answer, new Date().toISOString()]);
        await db.run("INSERT INTO agent_audit_log(userId,action,status,details,createdAt) VALUES (?,'reliability_review','success',?,?)",
            [userId, JSON.stringify({ transactionId: id, issueKey: review.issueKey, answer: input.answer }), new Date().toISOString()]);
    });
    await require('./financialReliability').checkFinancialReliability(userId, { force: true });
    return getReview(userId, id);
}
function telegramCard(review) {
    const { e } = require('./telegramService');
    const tx = review.transaction;
    return { text: e(`${title(tx)}\n${tx.Timestamp?.slice(0, 10)} · ${tx.Account || tx.BankName || 'Account'}\n\n${review.question}`),
        replyMarkup: { inline_keyboard: [...review.options.filter(o => o.value !== 'later').map(o => [{ text: o.label.slice(0, 120), callback_data: `review:${tx.id}:${review.issueKey.split(':')[0]}:${o.value}:${review.fingerprint.slice(0, 12)}` }]),
            [{ text: review.resolved ? 'Review another transaction' : 'Check later / Back to transactions', callback_data: 'review:inbox' }]] } };
}
async function telegramInbox(userId) {
    const report = await require('./financialReliability').checkFinancialReliability(userId);
    const { e } = require('./telegramService');
    return { text: e(report.cards.length ? 'Transactions to review\nChoose a transaction. I’ll ask one question at a time. More are in Profile → Transactions to review.' : 'No transactions need your review.'),
        replyMarkup: { inline_keyboard: report.cards.slice(0, 5).map(c => [{ text: `${c.title} · ${c.currency} ${c.amount.toFixed(2)} · ${c.date.slice(0, 10)}`.slice(0, 120), callback_data: `review:${c.id}` }]) } };
}
module.exports = { getReview, answerReview, fingerprint, title, telegramCard, telegramInbox };
