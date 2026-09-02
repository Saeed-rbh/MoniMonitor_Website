const { getDb } = require('./db');
const { accountMatchScore, transactionBalanceDelta } = require('../services/accountMatching');
const {
    describeDiscoveredAccount,
    getAccountReference,
    resolveAccountCandidate,
} = require('../services/accountDiscovery');
const { CATEGORY_LABELS } = require('../services/transactionCategories');
const { findTransactionMatch } = require('../services/transactionDeduplication');
const {
    isCreditCardPayment,
    isOutgoingEmailTransfer,
} = require('../services/transactionSemantics');
const {
    getStoredMonthlySummaries,
    refreshTransactionMonths,
} = require('./monthlySummaries');
const { encryptString, decryptString, isEncrypted } = require('../services/encryptionService');

const portfolioActivityCategories = new Set(['Saving', 'SavingWithdrawal', 'Investment']);
const portfolioActivityLabels = new Set([
    ...CATEGORY_LABELS.Saving,
    ...CATEGORY_LABELS.Investment,
    'Savings',
    'Investment',
    'Investment Activity',
    'TFSA Withdrawal',
]);
const securityTradeLabels = new Set([
    'ETF & Stock Purchase',
    'ETF & Stock Sale',
    'Crypto Purchase',
    'Crypto Sale',
    'Investment',
    'Investment Activity',
]);

function toMinorUnits(amount) {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) throw new Error('Amount must be a finite number');
    return Math.round(numericAmount * 100);
}

function withDisplayAmount(transaction) {
    if (!transaction) return transaction;
    const amountMinor = Number.isSafeInteger(transaction.AmountMinor)
        ? transaction.AmountMinor
        : toMinorUnits(transaction.Amount);
    return { ...transaction, AmountMinor: amountMinor, Amount: amountMinor / 100 };
}

function withDisplayAmounts(transactions) {
    return transactions.map(withDisplayAmount);
}

function serializeSourcePayload(payload, { encrypt = false } = {}) {
    if (payload === undefined || payload === null) return null;
    const serialized = JSON.stringify(payload);
    return encrypt ? encryptString(serialized, 'EMAIL_SOURCE_ENCRYPTION_KEY') : serialized;
}

function parseSourcePayload(payload, { encrypted = false } = {}) {
    if (!payload) return null;
    try {
        return JSON.parse(encrypted ? decryptString(payload, 'EMAIL_SOURCE_ENCRYPTION_KEY') : payload);
    } catch {
        return { raw: payload };
    }
}

async function createUser(id, username, hashedPassword) {
    const db = await getDb();
    const configuredOwnerId = String(process.env.BACKUP_OWNER_USER_ID || process.env.USER_ID || '').trim();
    const role = configuredOwnerId && String(id) === configuredOwnerId ? 'owner' : 'user';
    await db.run(
        'INSERT INTO users (id, username, password, role, createdAt) VALUES (?, ?, ?, ?, ?)',
        [id, username, hashedPassword, role, new Date().toISOString()]
    );
}

async function getUserCount() {
    const db = await getDb();
    const row = await db.get('SELECT COUNT(*) AS count FROM users');
    return Number(row?.count || 0);
}

async function getUserByUsername(username) {
    const db = await getDb();
    return await db.get('SELECT * FROM users WHERE username = ?', [username]);
}

async function getUserById(id) {
    const db = await getDb();
    return await db.get('SELECT * FROM users WHERE id = ?', [id]);
}

async function updateUserProfilePhoto(userId, profilePhotoUrl) {
    const db = await getDb();
    await db.run(
        'UPDATE users SET profilePhotoUrl = ? WHERE id = ?',
        [profilePhotoUrl, userId]
    );
}

async function getAllTransactionsForUser(userId, filters = {}) {
    const db = await getDb();
    let query = 'SELECT * FROM transactions WHERE userId = ?';
    const params = [userId];

    if (filters.category) { query += ' AND Category = ?'; params.push(filters.category); }
    if (filters.label)    { query += ' AND Label = ?';    params.push(filters.label); }
    if (filters.account)  { query += ' AND Account = ?';  params.push(filters.account); }
    if (filters.from)     { query += ' AND Timestamp >= ?'; params.push(filters.from); }
    if (filters.to)       { query += ' AND Timestamp <= ?'; params.push(filters.to); }

    // Backend Search Option
    if (filters.search) {
        query += ' AND (Reason LIKE ? OR Label LIKE ? OR BankName LIKE ? OR Type LIKE ? OR Account LIKE ?)';
        const searchVal = `%${filters.search}%`;
        params.push(searchVal, searchVal, searchVal, searchVal, searchVal);
    }

    query += ' ORDER BY Timestamp DESC';

    // Backend Pagination Option
    if (filters.limit) {
        query += ' LIMIT ?';
        params.push(parseInt(filters.limit));
        if (filters.page) {
            const offset = (parseInt(filters.page) - 1) * parseInt(filters.limit);
            query += ' OFFSET ?';
            params.push(offset);
        }
    }

    return withDisplayAmounts(await db.all(query, params));
}

async function addTransaction(transaction) {
    const db = await getDb();
    const result = await db.run(
        `INSERT INTO transactions
            (userId, Amount, AmountMinor, Currency, Category, Label, Reason, Timestamp, ReceivedAt,
             Type, Account, BankName, ReferenceNumber, Frequency, TelegramMessageId, PortfolioAction,
             PortfolioAccountId, PortfolioConfidence, PortfolioSymbol, PortfolioQuantity, PortfolioPrice,
             BalanceAccountConfidence, PortfolioAccountNumber, PortfolioToSymbol, PortfolioToQuantity, AccountFlow,
             SourceEmailKey)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            transaction.userId,
            (Number.isSafeInteger(transaction.AmountMinor) ? transaction.AmountMinor : toMinorUnits(transaction.Amount)) / 100,
            Number.isSafeInteger(transaction.AmountMinor) ? transaction.AmountMinor : toMinorUnits(transaction.Amount),
            transaction.Currency || 'CAD',
            transaction.Category,
            transaction.Label,
            transaction.Reason,
            transaction.Timestamp,
            transaction.ReceivedAt || null,
            transaction.Type,
            transaction.Account,
            transaction.BankName,
            transaction.ReferenceNumber || null,
            transaction.Frequency || 'OneTime',
            transaction.TelegramMessageId || null,
            transaction.PortfolioAction || null,
            transaction.PortfolioAccountId || null,
            transaction.PortfolioConfidence || null,
            transaction.PortfolioSymbol || null,
            transaction.PortfolioQuantity || null,
            transaction.PortfolioPrice || null,
            transaction.BalanceAccountConfidence || null,
            transaction.PortfolioAccountNumber || null,
            transaction.PortfolioToSymbol || null,
            transaction.PortfolioToQuantity || null,
            transaction.AccountFlow || null,
            transaction.SourceEmailKey || null,
        ]
    );
    if (transaction.BalanceAccountId !== undefined && transaction.BalanceAccountId !== null) {
        await db.run(
            'UPDATE transactions SET BalanceAccountId = ? WHERE id = ?',
            [transaction.BalanceAccountId, result.lastID]
        );
    }
    await refreshTransactionMonths(db, [transaction]);
    return result.lastID;
}

/**
 * The durable boundary for a newly-ingested email. A crash cannot leave a
 * normalized transaction without its source record, balance event, or alert
 * intent (or the inverse). Ambiguous balance matches remain intentionally
 * deferred to the idempotent reconciliation path.
 */
async function commitEmailTransaction({ transaction, source, balance = null, outbox = null }) {
    const db = await getDb();
    await db.run('BEGIN IMMEDIATE');
    try {
        const transactionId = await addTransaction(transaction);
        if (balance?.accountId) {
            const account = await db.get(
                'SELECT * FROM investment_accounts WHERE id = ? AND userId = ?',
                [balance.accountId, transaction.userId]
            );
            const amountMinor = Number.isSafeInteger(transaction.AmountMinor)
                ? transaction.AmountMinor
                : toMinorUnits(transaction.Amount);
            const deltaMinor = account ? transactionBalanceDelta(transaction, account, amountMinor) : null;
            const nextCashMinor = account ? Number(account.cashMinor) + Number(deltaMinor) : null;
            if (deltaMinor !== null && nextCashMinor >= 0) {
                const occurredAt = transaction.Timestamp || new Date().toISOString();
                await db.run(
                    'UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ? AND userId = ?',
                    [nextCashMinor, occurredAt, account.id, transaction.userId]
                );
                await db.run(
                    `INSERT INTO account_balance_events
                        (userId, accountId, sourceTransactionId, deltaMinor, occurredAt)
                     VALUES (?, ?, ?, ?, ?)`,
                    [transaction.userId, account.id, transactionId, deltaMinor, occurredAt]
                );
            }
        }
        if (source) {
            await upsertTransactionSource({
                ...source,
                userId: transaction.userId,
                transactionId,
                provider: source.provider || 'email',
                ownsTransaction: source.ownsTransaction !== false,
            });
        }
        if (outbox) {
            const payload = typeof outbox.payload === 'function'
                ? outbox.payload(transactionId)
                : outbox.payload;
            await enqueueTelegramOutbox(outbox.action || 'sendMessage', payload, { transactionId });
        }
        await db.run('COMMIT');
        return transactionId;
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

async function getTransactionById(id, userId) {
    const db = await getDb();
    return withDisplayAmount(await db.get('SELECT * FROM transactions WHERE id = ? AND userId = ?', [id, userId]));
}

function normalizeTransactionUpdate(updates) {
    const normalized = { ...updates };
    if (normalized.Amount !== undefined) {
        const amountMinor = toMinorUnits(normalized.Amount);
        normalized.AmountMinor = amountMinor;
        normalized.Amount = amountMinor / 100;
    }
    return normalized;
}

async function updateTransaction(id, updates) {
    const db = await getDb();
    const previous = await db.get('SELECT userId, Timestamp FROM transactions WHERE id = ?', [id]);
    const normalized = normalizeTransactionUpdate(updates);
    const keys = Object.keys(normalized);
    const values = Object.values(normalized);
    if (keys.length === 0) return;
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    values.push(id);
    await db.run(`UPDATE transactions SET ${setClause} WHERE id = ?`, values);
    const current = await db.get('SELECT userId, Timestamp FROM transactions WHERE id = ?', [id]);
    await refreshTransactionMonths(db, [previous, current]);
}

async function updateTransactionForUser(id, userId, updates) {
    const db = await getDb();
    const previous = await db.get(
        'SELECT userId, Timestamp FROM transactions WHERE id = ? AND userId = ?',
        [id, userId]
    );
    const normalized = normalizeTransactionUpdate(updates);
    const keys = Object.keys(normalized);
    if (keys.length === 0) return false;
    const values = Object.values(normalized);
    const setClause = keys.map((key) => key + " = ?").join(", ");
    values.push(id, userId);
    const result = await db.run("UPDATE transactions SET " + setClause + " WHERE id = ? AND userId = ?", values);
    if (result.changes > 0) {
        const current = await db.get(
            'SELECT userId, Timestamp FROM transactions WHERE id = ? AND userId = ?',
            [id, userId]
        );
        await refreshTransactionMonths(db, [previous, current]);
    }
    return result.changes > 0;
}

async function deleteTransaction(id, userId) {
    const db = await getDb();
    const previous = await db.get(
        'SELECT userId, Timestamp FROM transactions WHERE id = ? AND userId = ?',
        [id, userId]
    );
    await removeTransactionAccountBalance(userId, id);
    const result = await db.run(
        'DELETE FROM transactions WHERE id = ? AND userId = ?',
        [id, userId]
    );
    if (result.changes > 0) await refreshTransactionMonths(db, [previous]);
    return result.changes > 0;
}

// For deduplication in email agent.
// Match a reference only within the same dated amount. Some bank exports reuse a
// reference for related adjustments, and internal transfers legitimately have two sides.
async function findDuplicateTransaction(userId, amount, category, datePrefix, reason, referenceNumber, account, metadata = {}) {
    const db = await getDb();
    const amountMinor = toMinorUnits(amount);

    if (referenceNumber) {
        const byRef = await db.all(
            `SELECT * FROM transactions
             WHERE userId = ? AND ReferenceNumber = ? AND AmountMinor = ? AND Timestamp LIKE ?`,
            [userId, referenceNumber, amountMinor, datePrefix + '%']
        );
        if (byRef.length) {
            const accountMatch = account && byRef.find(
                (transaction) => String(transaction.Account || '').trim().toLowerCase() ===
                    String(account).trim().toLowerCase()
            );
            return withDisplayAmount(accountMatch || byRef[0]);
        }
    }

    // Fallback: exact reason, amount, category, and day. Prefer the same account
    // so equal purchases from different accounts are not collapsed together.
    const exactReasonMatch = await db.get(
        `SELECT * FROM transactions
         WHERE userId = ? AND AmountMinor = ? AND Category = ? AND Timestamp LIKE ?
           AND Reason = ? COLLATE NOCASE
         ORDER BY CASE WHEN LOWER(TRIM(COALESCE(Account, ''))) = LOWER(TRIM(COALESCE(?, '')))
                       THEN 0 ELSE 1 END, id
         LIMIT 1`,
        [userId, amountMinor, category, datePrefix + '%', reason, account || null]
    );
    if (exactReasonMatch) return withDisplayAmount(exactReasonMatch);

    // Email and Plaid often describe the same bank event differently. Use the
    // shared cross-provider matcher as a final fallback so a transfer reference
    // embedded in a Plaid description can match an email's ReferenceNumber.
    const crossProviderMatch = await findTransactionMatch(db, userId, {
        ...metadata,
        Amount: amount,
        AmountMinor: amountMinor,
        Category: category,
        Reason: reason,
        ReferenceNumber: referenceNumber,
        Account: account,
        Timestamp: `${datePrefix}T12:00:00.000Z`,
    }, { mode: 'bank' });
    return withDisplayAmount(crossProviderMatch);
}

async function getTransactionBySourceEmailKey(userId, sourceEmailKey) {
    if (!sourceEmailKey) return null;
    const db = await getDb();
    return withDisplayAmount(await db.get(
        'SELECT * FROM transactions WHERE userId = ? AND SourceEmailKey = ?',
        [userId, sourceEmailKey]
    ));
}

/**
 * Store the complete source record separately from the normalized transaction.
 * A transaction may have both an email source and a Plaid source, so the
 * provider/externalId pair remains the source record's identity.
 */
async function upsertTransactionSource({
    userId,
    provider,
    externalId,
    transactionId,
    itemId = null,
    ownsTransaction = false,
    rawPayload = null,
    contextPayload = null,
}) {
    if (!userId || !provider || !externalId || !transactionId) return false;
    const db = await getDb();
    const now = new Date().toISOString();
    await db.run(
        `INSERT INTO transaction_sources
            (provider, externalId, userId, transactionId, itemId, ownsTransaction,
             rawPayloadJson, contextPayloadJson, capturedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, externalId) DO UPDATE SET
            userId = excluded.userId,
            transactionId = excluded.transactionId,
            itemId = excluded.itemId,
            ownsTransaction = excluded.ownsTransaction,
            rawPayloadJson = COALESCE(excluded.rawPayloadJson, transaction_sources.rawPayloadJson),
            contextPayloadJson = COALESCE(excluded.contextPayloadJson, transaction_sources.contextPayloadJson),
            capturedAt = COALESCE(excluded.capturedAt, transaction_sources.capturedAt),
            updatedAt = excluded.updatedAt`,
        [provider, String(externalId), userId, transactionId, itemId, ownsTransaction ? 1 : 0,
            serializeSourcePayload(rawPayload, { encrypt: provider === 'email' }), serializeSourcePayload(contextPayload), now, now, now]
    );
    return true;
}

async function getTransactionSourcesForUser(transactionId, userId) {
    const db = await getDb();
    const rows = await db.all(
        `SELECT provider, externalId, itemId, ownsTransaction,
                rawPayloadJson, contextPayloadJson, capturedAt, createdAt, updatedAt
         FROM transaction_sources
         WHERE transactionId = ? AND userId = ?
         ORDER BY provider, createdAt`,
        [transactionId, userId]
    );
    return rows.map((row) => ({
        provider: row.provider,
        externalId: row.externalId,
        itemId: row.itemId,
        ownsTransaction: Boolean(row.ownsTransaction),
        rawPayload: parseSourcePayload(row.rawPayloadJson, { encrypted: row.provider === 'email' }),
        contextPayload: parseSourcePayload(row.contextPayloadJson),
        capturedAt: row.capturedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }));
}

async function migrateAndPruneRawEmailSources() {
    const db = await getDb();
    const retentionDays = Math.max(1, Number(process.env.EMAIL_SOURCE_RETENTION_DAYS) || 90);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = await db.all(
        `SELECT provider, externalId, rawPayloadJson FROM transaction_sources
         WHERE provider = 'email' AND rawPayloadJson IS NOT NULL AND rawPayloadJson <> ''`
    );
    let encrypted = 0;
    for (const row of rows) {
        if (isEncrypted(row.rawPayloadJson)) continue;
        await db.run(
            'UPDATE transaction_sources SET rawPayloadJson = ?, updatedAt = ? WHERE provider = ? AND externalId = ?',
            [encryptString(row.rawPayloadJson, 'EMAIL_SOURCE_ENCRYPTION_KEY'), new Date().toISOString(), row.provider, row.externalId]
        );
        encrypted += 1;
    }
    const pruned = await db.run(
        `UPDATE transaction_sources SET rawPayloadJson = NULL, updatedAt = ?
         WHERE provider = 'email' AND rawPayloadJson IS NOT NULL AND capturedAt IS NOT NULL AND capturedAt < ?`,
        [new Date().toISOString(), cutoff]
    );
    return { encrypted, pruned: Number(pruned.changes || 0), retentionDays };
}

async function getEmailSourceKeysNeedingReplay(userId, mailboxKey, limit = 250) {
    const normalizedMailboxKey = String(mailboxKey || '').trim();
    if (!userId || !normalizedMailboxKey) return [];
    const safeLimit = Number.isSafeInteger(limit) ? Math.min(1000, Math.max(1, limit)) : 250;
    const prefix = `${normalizedMailboxKey}:`;
    const db = await getDb();
    const rows = await db.all(
        `SELECT s.externalId FROM transaction_sources s
         JOIN transactions t ON t.id = s.transactionId AND t.userId = s.userId
         WHERE s.provider = 'email' AND s.userId = ?
           AND substr(s.externalId, 1, ?) = ?
           AND (
               s.rawPayloadJson IS NULL OR length(s.rawPayloadJson) <= 2 OR
               lower(trim(COALESCE(t.Reason, ''))) IN (
                   'deposit', 'deposit notice', 'withdrawal', 'bank deposit',
                   'bank withdrawal', 'e-transfer', 'interac e-transfer',
                   'electronic transfer', 'funds transfer', 'transfer',
                   'transfer in', 'transfer out'
               )
           )
         ORDER BY s.createdAt ASC LIMIT ?`,
        [userId, prefix.length, prefix, safeLimit]
    );
    return rows.map(({ externalId }) => externalId);
}

async function getAccountsForUser(userId) {
    const db = await getDb();
    return await db.all('SELECT * FROM accounts WHERE userId = ?', [userId]);
}

async function trackAccount(userId, account, bankName, type, firstSeen) {
    const db = await getDb();
    try {
        await db.run(
            `INSERT INTO accounts (userId, Account, BankName, Type, FirstSeen) VALUES (?, ?, ?, ?, ?)`,
            [userId, account, bankName, type, firstSeen]
        );
        return true;
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT') return false;
        throw err;
    }
}

async function ensureTransactionAccount(userId, transaction = {}) {
    const accountRef = getAccountReference(transaction);
    if (!accountRef) return { status: 'insufficient_identity', account: null, created: false };

    const db = await getDb();
    await db.run('BEGIN IMMEDIATE');
    try {
        const accounts = await db.all('SELECT * FROM investment_accounts WHERE userId = ?', [userId]);
        const matchTransaction = { ...transaction, Account: accountRef };
        const preferredAccountId = transaction.PortfolioAccountId || transaction.BalanceAccountId || null;
        const preferredConfidence = transaction.PortfolioConfidence === 'HIGH' || transaction.BalanceAccountConfidence === 'HIGH'
            ? 'HIGH'
            : null;
        const resolved = resolveAccountCandidate(
            matchTransaction,
            accounts,
            preferredAccountId,
            preferredConfidence
        );

        let account;
        let created = false;
        let status = 'matched';
        if (resolved) {
            account = resolved.account;
            if (!account.accountRef) {
                await db.run(
                    'UPDATE investment_accounts SET accountRef = ?, updatedAt = ? WHERE id = ? AND userId = ?',
                    [accountRef, new Date().toISOString(), account.id, userId]
                );
                account = { ...account, accountRef };
                status = 'linked';
            }
        } else {
            const discovered = describeDiscoveredAccount(matchTransaction);
            if (!discovered) {
                await db.run('COMMIT');
                return { status: 'insufficient_identity', account: null, created: false };
            }
            const settings = await db.get('SELECT currency FROM user_settings WHERE userId = ?', [userId]);
            const currency = settings?.currency || transaction.Currency || 'CAD';
            const now = new Date().toISOString();
            const result = await db.run(
                `INSERT INTO investment_accounts
                    (userId, name, institution, accountType, accountRef, currency, cashMinor, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
                [userId, discovered.name, discovered.institution, discovered.accountType,
                    discovered.accountRef, currency, now, now]
            );
            account = await db.get(
                'SELECT * FROM investment_accounts WHERE id = ? AND userId = ?',
                [result.lastID, userId]
            );
            created = true;
            status = 'created';
        }

        await db.run(
            `INSERT INTO accounts (userId, Account, BankName, Type, FirstSeen)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(userId, Account) DO UPDATE SET
                 BankName = COALESCE(excluded.BankName, accounts.BankName),
                 Type = COALESCE(excluded.Type, accounts.Type)`,
            [userId, accountRef, transaction.BankName || account.institution,
                transaction.Type || account.accountType, transaction.Timestamp || new Date().toISOString()]
        );
        await db.run('COMMIT');
        return { status, account, created };
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

const portfolioAccountSelect = `
    SELECT a.*,
           COALESCE(SUM(ROUND(h.quantity * COALESCE(h.priceMicros, h.priceMinor * 10000) / 10000.0)), 0) AS holdingsValueMinor,
           COALESCE(SUM(ROUND(h.quantity * COALESCE(h.averageCostMicros, h.averageCostMinor * 10000) / 10000.0)), 0) AS holdingsCostMinor,
           COUNT(h.id) AS holdingCount
    FROM investment_accounts a
    LEFT JOIN investment_holdings h ON h.accountId = a.id AND h.userId = a.userId
`;

async function getInvestmentAccounts(userId) {
    const db = await getDb();
    const accounts = await db.all(`${portfolioAccountSelect}
        WHERE a.userId = ? GROUP BY a.id ORDER BY a.createdAt ASC`, [userId]);
    const holdings = await db.all('SELECT * FROM investment_holdings WHERE userId = ? ORDER BY symbol ASC', [userId]);
    const byAccount = holdings.reduce((result, holding) => {
        (result[holding.accountId] ||= []).push(holding);
        return result;
    }, {});
    return accounts.map((account) => ({
        ...account,
        totalValueMinor: account.accountType === 'Credit Card'
            ? -account.cashMinor
            : account.cashMinor + account.holdingsValueMinor,
        gainLossMinor: account.holdingsValueMinor - account.holdingsCostMinor,
        holdings: byAccount[account.id] || [],
    }));
}

async function syncTransactionAccountBalance(userId, transactionId, preferred = {}) {
    const db = await getDb();
    await db.run('BEGIN IMMEDIATE');
    try {
        const transaction = await db.get(
            'SELECT * FROM transactions WHERE id = ? AND userId = ?',
            [transactionId, userId]
        );
        if (!transaction) {
            await db.run('COMMIT');
            return { status: 'missing_transaction' };
        }

        const existing = await db.get(
            'SELECT * FROM account_balance_events WHERE sourceTransactionId = ? AND userId = ?',
            [transactionId, userId]
        );

        const isInterac = /interac|e-transfer/i.test(transaction.Type || '') || /interac|e-transfer/i.test(transaction.Reason || '');
        const accounts = await db.all('SELECT * FROM investment_accounts WHERE userId = ?', [userId]);
        const ranked = accounts
            .map((account) => ({
                account,
                score: accountMatchScore(transaction, account, preferred.accountId, preferred.confidence),
            }))
            .filter(({ score }) => score > 0)
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (isInterac) return (Number(b.account.cashMinor) || 0) - (Number(a.account.cashMinor) || 0);
                return 0;
            });
            
        const best = ranked[0];
        if (!best || best.score < 30) {
            await db.run('COMMIT');
            return { status: ranked.length ? 'ambiguous_account' : 'unmatched_account' };
        }
        
        if (ranked[1] && ranked[1].score === best.score) {
            if (!isInterac || Number(ranked[0].account.cashMinor) === Number(ranked[1].account.cashMinor)) {
                await db.run('COMMIT');
                return { status: 'ambiguous_account' };
            }
        }

        const amountMinor = Number.isSafeInteger(transaction.AmountMinor)
            ? transaction.AmountMinor
            : toMinorUnits(transaction.Amount);
        const deltaMinor = transactionBalanceDelta(transaction, best.account, amountMinor);
        if (deltaMinor === null) {
            if (existing) {
                const oldAccount = accounts.find((account) => Number(account.id) === Number(existing.accountId));
                const restoredCashMinor = Number(oldAccount?.cashMinor) - Number(existing.deltaMinor);
                if (!oldAccount || restoredCashMinor < 0) {
                    await db.run('COMMIT');
                    return { status: 'review_required', reason: 'Existing balance event cannot be safely reversed' };
                }
                await db.run(
                    'UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ? AND userId = ?',
                    [restoredCashMinor, new Date().toISOString(), existing.accountId, userId]
                );
                await db.run('DELETE FROM account_balance_events WHERE id = ? AND userId = ?', [existing.id, userId]);
            }
            await db.run('COMMIT');
            return { status: 'not_balance_posting' };
        }

        // Re-syncing an unchanged transaction must be idempotent. Previously the
        // existing delta was reversed with MAX(0, cashMinor - delta), which could
        // discard the account's opening balance when a deposit exceeded the
        // current balance. Reapplying the event then inflated the displayed cash.
        if (existing && Number(existing.accountId) === Number(best.account.id) &&
            Number(existing.deltaMinor) === Number(deltaMinor)) {
            await db.run('COMMIT');
            return {
                status: 'applied', accountId: best.account.id, accountName: best.account.name,
                deltaMinor, cashMinor: Number(best.account.cashMinor), unchanged: true,
            };
        }

        const oldAccount = existing
            ? accounts.find((account) => Number(account.id) === Number(existing.accountId))
            : null;
        const oldAccountCashMinor = oldAccount
            ? Number(oldAccount.cashMinor) - Number(existing.deltaMinor)
            : null;
        if (existing && (!oldAccount || oldAccountCashMinor < 0)) {
            await db.run('COMMIT');
            return { status: 'review_required', reason: 'Existing balance event cannot be safely reversed' };
        }

        const targetCashMinor = existing && Number(existing.accountId) === Number(best.account.id)
            ? oldAccountCashMinor
            : Number(best.account.cashMinor);
        const nextCashMinor = targetCashMinor + deltaMinor;
        if (nextCashMinor < 0) {
            await db.run('COMMIT');
            return { status: 'review_required', reason: 'Transaction would make the account balance negative' };
        }

        const occurredAt = transaction.Timestamp || new Date().toISOString();
        if (existing && Number(existing.accountId) !== Number(best.account.id)) {
            await db.run(
                'UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ? AND userId = ?',
                [oldAccountCashMinor, new Date().toISOString(), existing.accountId, userId]
            );
        }
        await db.run(
            'UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ? AND userId = ?',
            [nextCashMinor, occurredAt, best.account.id, userId]
        );
        if (existing) {
            await db.run(
                `UPDATE account_balance_events
                 SET accountId = ?, deltaMinor = ?, occurredAt = ?
                 WHERE id = ? AND userId = ?`,
                [best.account.id, deltaMinor, occurredAt, existing.id, userId]
            );
        } else {
            await db.run(
                `INSERT INTO account_balance_events
                    (userId, accountId, sourceTransactionId, deltaMinor, occurredAt)
                 VALUES (?, ?, ?, ?, ?)`,
                [userId, best.account.id, transactionId, deltaMinor, occurredAt]
            );
        }
        await db.run('COMMIT');
        return {
            status: 'applied', accountId: best.account.id, accountName: best.account.name,
            deltaMinor, cashMinor: nextCashMinor,
        };
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

async function removeTransactionAccountBalance(userId, transactionId) {
    const db = await getDb();
    await db.run('BEGIN IMMEDIATE');
    try {
        const existing = await db.get(
            'SELECT * FROM account_balance_events WHERE sourceTransactionId = ? AND userId = ?',
            [transactionId, userId]
        );
        if (existing) {
            await db.run(
                // The authoritative balance can be lower than the old event
                // after a Plaid refresh; never write a negative cash balance.
                'UPDATE investment_accounts SET cashMinor = MAX(0, cashMinor - ?), updatedAt = ? WHERE id = ? AND userId = ?',
                [existing.deltaMinor, new Date().toISOString(), existing.accountId, userId]
            );
            await db.run('DELETE FROM account_balance_events WHERE id = ? AND userId = ?', [existing.id, userId]);
        }
        await db.run('COMMIT');
        return Boolean(existing);
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

async function reconcileTransactionAccountBalances(userId) {
    const db = await getDb();
    const transactions = await db.all(
        `SELECT id FROM transactions
         WHERE userId = ? AND ReceivedAt IS NOT NULL
           AND (AccountFlow IN ('IN', 'OUT') OR Category IN ('Expense', 'Income')
                OR (Category = 'Saving' AND Label = 'Debt Payment'))
           AND id NOT IN (
             SELECT sourceTransactionId FROM account_balance_events WHERE userId = ?
         ) ORDER BY Timestamp ASC`,
        [userId, userId]
    );
    const results = [];
    for (const transaction of transactions) {
        results.push({ transactionId: transaction.id, ...(await syncTransactionAccountBalance(userId, transaction.id)) });
    }
    return results;
}

async function reconcileEmailPortfolioActivities(userId) {
    const db = await getDb();
    const transactions = await db.all(
        `SELECT * FROM transactions
         WHERE userId = ? AND ReceivedAt IS NOT NULL
           AND Category IN ('Saving', 'SavingWithdrawal', 'Investment') AND PortfolioAction IS NOT NULL
           AND id NOT IN (
               SELECT sourceTransactionId FROM portfolio_transactions
               WHERE userId = ? AND sourceTransactionId IS NOT NULL
           )
         ORDER BY Timestamp ASC`,
        [userId, userId]
    );
    const results = [];
    for (const transaction of transactions) {
        results.push({
            transactionId: transaction.id,
            ...(await applyEmailPortfolioActivity(userId, transaction.id, {
                accountId: transaction.PortfolioAccountId,
                action: transaction.PortfolioAction,
                confidence: transaction.PortfolioConfidence,
                symbol: transaction.PortfolioSymbol,
                quantity: transaction.PortfolioQuantity,
                price: transaction.PortfolioPrice,
                toSymbol: transaction.PortfolioToSymbol,
                toQuantity: transaction.PortfolioToQuantity,
                accountFlow: transaction.AccountFlow,
            })),
        });
    }
    return results;
}

async function getPortfolioSummary(userId) {
    const db = await getDb();
    const accounts = await getInvestmentAccounts(userId);
    const emailActivities = await db.all(
        `SELECT t.id AS sourceTransactionId, t.AmountMinor AS amountMinor, t.Currency AS currency,
                t.Timestamp AS occurredAt, t.Label AS label, t.Reason AS reason,
                t.Account AS sourceAccount, t.BankName AS bankName, t.ReferenceNumber AS referenceNumber,
                p.kind, p.accountId, p.symbol, p.quantity, p.priceMinor, p.priceMicros, a.name AS accountName
         FROM transactions t
         LEFT JOIN portfolio_transactions p
                ON p.sourceTransactionId = t.id AND p.userId = t.userId
         LEFT JOIN investment_accounts a
                ON a.id = p.accountId AND a.userId = t.userId
         WHERE t.userId = ? AND t.ReceivedAt IS NOT NULL
               AND t.Category IN ('Saving', 'SavingWithdrawal', 'Investment')
               AND t.PortfolioAction IS NOT NULL
         ORDER BY t.Timestamp DESC
         LIMIT 20`,
        [userId]
    );
    return {
        totalValueMinor: accounts.reduce((sum, account) => sum + account.totalValueMinor, 0),
        totalCashMinor: accounts.reduce((sum, account) =>
            sum + (account.accountType === 'Credit Card' ? 0 : account.cashMinor), 0),
        totalLiabilitiesMinor: accounts.reduce((sum, account) =>
            sum + (account.accountType === 'Credit Card' ? account.cashMinor : 0), 0),
        holdingsValueMinor: accounts.reduce((sum, account) => sum + account.holdingsValueMinor, 0),
        holdingsCostMinor: accounts.reduce((sum, account) => sum + account.holdingsCostMinor, 0),
        gainLossMinor: accounts.reduce((sum, account) => sum + account.gainLossMinor, 0),
        accountCount: accounts.length,
        accounts,
        emailActivities,
    };
}

async function createInvestmentAccount(userId, account) {
    const db = await getDb();
    const now = new Date().toISOString();
    const result = await db.run(
        `INSERT INTO investment_accounts (userId, name, institution, accountType, accountRef, currency, cashMinor, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, account.name, account.institution || null, account.accountType, account.accountRef || null,
            account.currency, account.cashMinor, now, now]
    );
    return await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?', [result.lastID, userId]);
}

async function updateInvestmentAccount(userId, id, updates) {
    const db = await getDb();
    const allowed = ['name', 'institution', 'accountType', 'currency', 'cashMinor'];
    const entries = Object.entries(updates).filter(([key]) => allowed.includes(key));
    if (!entries.length) return null;
    entries.push(['updatedAt', new Date().toISOString()]);
    const result = await db.run(
        `UPDATE investment_accounts SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ? AND userId = ?`,
        [...entries.map(([, value]) => value), id, userId]
    );
    if (!result.changes) return null;
    return await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?', [id, userId]);
}

async function deleteInvestmentAccount(userId, id) {
    const db = await getDb();
    const owned = await db.get('SELECT id FROM investment_accounts WHERE id = ? AND userId = ?', [id, userId]);
    if (!owned) return false;
    await db.run('BEGIN');
    try {
        await db.run('DELETE FROM account_balance_events WHERE accountId = ? AND userId = ?', [id, userId]);
        await db.run('DELETE FROM investment_holdings WHERE accountId = ? AND userId = ?', [id, userId]);
        await db.run('DELETE FROM portfolio_transactions WHERE accountId = ? AND userId = ?', [id, userId]);
        await db.run('DELETE FROM investment_accounts WHERE id = ? AND userId = ?', [id, userId]);
        await db.run('COMMIT');
        return true;
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

async function upsertInvestmentHolding(userId, accountId, holding) {
    const db = await getDb();
    const account = await db.get('SELECT id FROM investment_accounts WHERE id = ? AND userId = ?', [accountId, userId]);
    if (!account) return null;
    const now = new Date().toISOString();
    const averageCostMicros = Number.isSafeInteger(holding.averageCostMicros)
        ? holding.averageCostMicros
        : holding.averageCostMinor * 10000;
    const priceMicros = Number.isSafeInteger(holding.priceMicros)
        ? holding.priceMicros
        : holding.priceMinor * 10000;
    await db.run(
        `INSERT INTO investment_holdings (userId, accountId, symbol, name, quantity, averageCostMinor, averageCostMicros, priceMinor, priceMicros, currency, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(accountId, symbol) DO UPDATE SET
            name = excluded.name, quantity = excluded.quantity, averageCostMinor = excluded.averageCostMinor,
            averageCostMicros = excluded.averageCostMicros, priceMinor = excluded.priceMinor,
            priceMicros = excluded.priceMicros, currency = excluded.currency, updatedAt = excluded.updatedAt`,
        [userId, accountId, holding.symbol, holding.name || null, holding.quantity, holding.averageCostMinor,
            averageCostMicros, holding.priceMinor, priceMicros, holding.currency, now]
    );
    return await db.get('SELECT * FROM investment_holdings WHERE accountId = ? AND symbol = ? AND userId = ?', [accountId, holding.symbol, userId]);
}

async function deleteInvestmentHolding(userId, accountId, holdingId) {
    const db = await getDb();
    const result = await db.run('DELETE FROM investment_holdings WHERE id = ? AND accountId = ? AND userId = ?', [holdingId, accountId, userId]);
    return result.changes > 0;
}


const emailCashActions = Object.freeze({
    DEPOSIT: 1,
    CONTRIBUTION: 1,
    INTEREST: 1,
    DIVIDEND: 1,
    REIMBURSEMENT: 1,
    WITHDRAWAL: -1,
    FEE: -1,
    TAX: -1,
});

const portfolioQuantityActions = new Set(['REWARD', 'DISTRIBUTION', 'FEE', 'SWAP']);
const portfolioNoBalanceActions = new Set(['TRANSFER', 'LOAN', 'RECALL', 'STAKE', 'UNSTAKE']);

async function applyEmailPortfolioActivity(userId, transactionId, activity = {}) {
    const { accountId, action, confidence, symbol, quantity, price, toSymbol, toQuantity, accountFlow } = activity;
    if (!action) return { status: 'ignored' };
    const isTrade = action === 'BUY' || action === 'SELL';
    if (!Object.hasOwn(emailCashActions, action) && !isTrade &&
        !portfolioQuantityActions.has(action) && !portfolioNoBalanceActions.has(action)) {
        return { status: 'review_required', reason: 'Unsupported portfolio action' };
    }

    const normalizedSymbol = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    const normalizedToSymbol = typeof toSymbol === 'string' ? toSymbol.trim().toUpperCase() : '';
    const tradeQuantity = Number(quantity);
    const tradePrice = Number(price);
    if (isTrade && (
        !/^[A-Z0-9.\-]{1,15}$/.test(normalizedSymbol) ||
        !Number.isFinite(tradeQuantity) || tradeQuantity <= 0 ||
        !Number.isFinite(tradePrice) || tradePrice <= 0
    )) {
        return { status: 'review_required', reason: 'Trade is missing a valid symbol, share quantity, or execution price' };
    }

    const db = await getDb();
    const source = await db.get(
        'SELECT * FROM transactions WHERE id = ? AND userId = ?',
        [transactionId, userId]
    );
    if (!source || !portfolioActivityCategories.has(source.Category)) return { status: 'ignored' };
    if (!portfolioActivityLabels.has(source.Label)) return { status: 'ignored' };

    await db.run('BEGIN IMMEDIATE');
    try {
        const alreadyApplied = await db.get(
            'SELECT id FROM portfolio_transactions WHERE sourceTransactionId = ?',
            [transactionId]
        );
        if (alreadyApplied) {
            await db.run('COMMIT');
            return { status: 'duplicate' };
        }

        let resolvedAccountId = confidence === 'HIGH' ? Number(accountId) : null;
        if (!resolvedAccountId) {
            const investmentTypes = new Set(['TFSA', 'RRSP', 'Brokerage', '401(k)', 'IRA', 'Crypto']);
            const candidates = (await db.all('SELECT * FROM investment_accounts WHERE userId = ?', [userId]))
                .filter((candidate) => !isTrade || investmentTypes.has(candidate.accountType))
                .map((candidate) => ({
                    account: candidate,
                    score: accountMatchScore(source, candidate, null, null),
                }))
                .filter(({ score }) => score >= 30)
                .sort((a, b) => b.score - a.score);
            if (candidates.length === 1 || (candidates[0] && candidates[1] && candidates[0].score > candidates[1].score)) {
                resolvedAccountId = candidates[0].account.id;
            }
        }

        const account = resolvedAccountId ? await db.get(
            'SELECT * FROM investment_accounts WHERE id = ? AND userId = ?',
            [resolvedAccountId, userId]
        ) : null;
        if (!account) {
            await db.run('COMMIT');
            return { status: 'unmatched_account' };
        }

        const amountMinor = Number.isSafeInteger(source.AmountMinor)
            ? source.AmountMinor
            : toMinorUnits(source.Amount);
        const occurredAt = source.Timestamp || new Date().toISOString();

        if (!isTrade) {
            const explicitFlow = accountFlow || source.AccountFlow;
            const cashMultiplier = explicitFlow === 'IN'
                ? 1
                : explicitFlow === 'OUT'
                    ? -1
                    : explicitFlow === 'NONE'
                        ? 0
                        : (emailCashActions[action] || 0);
            const nextCashMinor = account.cashMinor + (cashMultiplier * amountMinor);
            if (nextCashMinor < 0) {
                await db.run('COMMIT');
                return { status: 'review_required', reason: 'Portfolio action exceeds the recorded cash balance' };
            }

            const adjustHolding = async (holdingSymbol, delta) => {
                if (!holdingSymbol || !Number.isFinite(delta) || Math.abs(delta) <= 1e-12) return;
                const holding = await db.get(
                    'SELECT * FROM investment_holdings WHERE accountId = ? AND symbol = ? AND userId = ?',
                    [resolvedAccountId, holdingSymbol, userId]
                );
                const nextQuantity = Number(holding?.quantity || 0) + delta;
                if (nextQuantity < -1e-8) throw new Error(`Portfolio action would make ${holdingSymbol} negative`);
                if (nextQuantity <= 1e-8) {
                    if (holding) await db.run('DELETE FROM investment_holdings WHERE id = ? AND userId = ?', [holding.id, userId]);
                    return;
                }
                const actionPriceMicros = Number.isFinite(tradePrice) && tradePrice > 0
                    ? Math.round(tradePrice * 1000000)
                    : Number(holding?.priceMicros || 0);
                await db.run(
                    `INSERT INTO investment_holdings
                        (userId, accountId, symbol, name, quantity, averageCostMinor, averageCostMicros,
                         priceMinor, priceMicros, currency, updatedAt)
                     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(accountId, symbol) DO UPDATE SET
                        quantity = excluded.quantity, priceMinor = excluded.priceMinor,
                        priceMicros = excluded.priceMicros, updatedAt = excluded.updatedAt`,
                    [
                        userId, resolvedAccountId, holdingSymbol, nextQuantity,
                        Number(holding?.averageCostMinor || 0), Number(holding?.averageCostMicros || 0),
                        Math.round(actionPriceMicros / 10000), actionPriceMicros, account.currency, occurredAt,
                    ]
                );
            };

            if (portfolioQuantityActions.has(action)) {
                if (!normalizedSymbol || !Number.isFinite(tradeQuantity)) {
                    await db.run('COMMIT');
                    return { status: 'review_required', reason: 'Portfolio action is missing an asset quantity' };
                }
                const primaryDelta = action === 'REWARD'
                    ? Math.abs(tradeQuantity)
                    : action === 'FEE'
                        ? -Math.abs(tradeQuantity)
                        : action === 'SWAP'
                            ? -Math.abs(tradeQuantity)
                            : tradeQuantity;
                await adjustHolding(normalizedSymbol, primaryDelta);
                if (action === 'SWAP') {
                    const receivedQuantity = Number(toQuantity);
                    if (!normalizedToSymbol || !Number.isFinite(receivedQuantity) || receivedQuantity <= 0) {
                        throw new Error('Swap is missing the received asset quantity');
                    }
                    await adjustHolding(normalizedToSymbol, receivedQuantity);
                }
            }

            await db.run(
                'UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ? AND userId = ?',
                [nextCashMinor, occurredAt, resolvedAccountId, userId]
            );
            await db.run(
                `INSERT INTO portfolio_transactions
                    (userId, accountId, sourceTransactionId, kind, amountMinor, symbol, quantity,
                     toSymbol, toQuantity, occurredAt, note)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, resolvedAccountId, transactionId, 'EMAIL_' + action, amountMinor,
                    normalizedSymbol || null, Number.isFinite(tradeQuantity) ? tradeQuantity : null,
                    normalizedToSymbol || null, Number.isFinite(Number(toQuantity)) ? Number(toQuantity) : null,
                    occurredAt, source.Reason || null]
            );
            await db.run('COMMIT');
            return { status: 'applied', accountId: resolvedAccountId, action, amountMinor, cashMinor: nextCashMinor };
        }

        if (!securityTradeLabels.has(source.Label)) {
            await db.run('COMMIT');
            return { status: 'review_required', reason: 'Security trades must be classified as Investment' };
        }

        const priceMinor = Math.round(tradePrice * 100);
        const priceMicros = Math.round(tradePrice * 1000000);
        const expectedAmountMinor = Math.round(tradeQuantity * tradePrice * 100);
        const allowedDifference = Math.max(2, Math.round(amountMinor * 0.02));
        if (Math.abs(expectedAmountMinor - amountMinor) > allowedDifference) {
            await db.run('COMMIT');
            return { status: 'review_required', reason: 'Trade total does not match shares multiplied by execution price' };
        }

        const holding = await db.get(
            'SELECT * FROM investment_holdings WHERE accountId = ? AND symbol = ? AND userId = ?',
            [resolvedAccountId, normalizedSymbol, userId]
        );
        const existingQuantity = Number(holding?.quantity || 0);
        let nextCashMinor;
        let totalShares;
        let averageCostMinor;
        let averageCostMicros;

        if (action === 'BUY') {
            nextCashMinor = account.cashMinor - amountMinor;
            if (nextCashMinor < 0) {
                await db.run('COMMIT');
                return { status: 'review_required', reason: 'Buy exceeds the recorded cash balance' };
            }

            totalShares = existingQuantity + tradeQuantity;
            const existingAverageCostMicros = Number(
                holding?.averageCostMicros ?? (holding?.averageCostMinor || 0) * 10000
            );
            averageCostMicros = Math.round(((existingQuantity * existingAverageCostMicros) + (tradeQuantity * priceMicros)) / totalShares);
            averageCostMinor = Math.round(averageCostMicros / 10000);
            await db.run(
                `INSERT INTO investment_holdings
                    (userId, accountId, symbol, name, quantity, averageCostMinor, averageCostMicros, priceMinor, priceMicros, currency, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(accountId, symbol) DO UPDATE SET
                    quantity = excluded.quantity,
                    averageCostMinor = excluded.averageCostMinor,
                    averageCostMicros = excluded.averageCostMicros,
                    priceMinor = excluded.priceMinor,
                    priceMicros = excluded.priceMicros,
                    currency = excluded.currency,
                    updatedAt = excluded.updatedAt`,
                [
                    userId, resolvedAccountId, normalizedSymbol, holding?.name || null,
                    totalShares, averageCostMinor, averageCostMicros, priceMinor, priceMicros, account.currency, occurredAt,
                ]
            );
        } else {
            if (!holding || tradeQuantity > existingQuantity + 1e-9) {
                await db.run('COMMIT');
                return { status: 'review_required', reason: 'Sell exceeds the recorded number of shares' };
            }

            nextCashMinor = account.cashMinor + amountMinor;
            totalShares = Math.max(0, existingQuantity - tradeQuantity);
            averageCostMinor = Number(holding.averageCostMinor || 0);
            averageCostMicros = Number(holding.averageCostMicros ?? averageCostMinor * 10000);
            if (totalShares <= 1e-9) {
                totalShares = 0;
                await db.run(
                    'DELETE FROM investment_holdings WHERE id = ? AND userId = ?',
                    [holding.id, userId]
                );
            } else {
                await db.run(
                    'UPDATE investment_holdings SET quantity = ?, priceMinor = ?, priceMicros = ?, updatedAt = ? WHERE id = ? AND userId = ?',
                    [totalShares, priceMinor, priceMicros, occurredAt, holding.id, userId]
                );
            }
        }

        await db.run(
            'UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ? AND userId = ?',
            [nextCashMinor, occurredAt, resolvedAccountId, userId]
        );
        await db.run(
            `INSERT INTO portfolio_transactions
                (userId, accountId, sourceTransactionId, kind, amountMinor, symbol, quantity, priceMinor, priceMicros, occurredAt, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId, resolvedAccountId, transactionId, 'EMAIL_' + action, amountMinor,
                normalizedSymbol, tradeQuantity, priceMinor, priceMicros, occurredAt, source.Reason || null,
            ]
        );
        await db.run('COMMIT');
        return {
            status: 'applied',
            accountId: resolvedAccountId,
            action,
            amountMinor,
            cashMinor: nextCashMinor,
            symbol: normalizedSymbol,
            quantity: tradeQuantity,
            totalShares,
            priceMinor,
            averageCostMinor,
            priceMicros,
            averageCostMicros,
        };
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}
async function getUserSettings(userId) {
    const db = await getDb();
    return await db.get('SELECT * FROM user_settings WHERE userId = ?', [userId]);
}

async function saveUserSettings(userId, settings) {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.run(
        `INSERT INTO user_settings (userId, currency, timezone, notificationsEnabled, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET
            currency = excluded.currency,
            timezone = excluded.timezone,
            notificationsEnabled = excluded.notificationsEnabled,
            updatedAt = excluded.updatedAt`,
        [userId, settings.currency, settings.timezone || null, settings.notificationsEnabled ? 1 : 0, now]
    );
    return await getUserSettings(userId);
}

async function getBudgetsForUser(userId, month) {
    const db = await getDb();
    return await db.all(
        'SELECT * FROM budgets WHERE userId = ? AND month = ? ORDER BY category ASC',
        [userId, month]
    );
}

async function saveBudget(userId, budget) {
    const db = await getDb();
    await db.run(
        `INSERT INTO budgets (userId, category, month, amountMinor, currency)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(userId, category, month) DO UPDATE SET
            amountMinor = excluded.amountMinor,
            currency = excluded.currency`,
        [userId, budget.category, budget.month, budget.amountMinor, budget.currency]
    );
    return await db.get(
        'SELECT * FROM budgets WHERE userId = ? AND category = ? AND month = ?',
        [userId, budget.category, budget.month]
    );
}

async function getGoalsForUser(userId) {
    const db = await getDb();
    return await db.all('SELECT * FROM goals WHERE userId = ? ORDER BY createdAt DESC', [userId]);
}

async function createGoal(userId, goal) {
    const db = await getDb();
    const result = await db.run(
        'INSERT INTO goals (userId, name, targetMinor, currentMinor, currency, targetDate, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, goal.name, goal.targetMinor, goal.currentMinor || 0, goal.currency, goal.targetDate || null, new Date().toISOString()]
    );
    return await db.get('SELECT * FROM goals WHERE id = ? AND userId = ?', [result.lastID, userId]);
}

async function updateGoal(userId, id, updates) {
    const keys = Object.keys(updates);
    if (keys.length === 0) return null;
    const db = await getDb();
    const values = Object.values(updates);
    values.push(id, userId);
    await db.run(`UPDATE goals SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ? AND userId = ?`, values);
    return await db.get('SELECT * FROM goals WHERE id = ? AND userId = ?', [id, userId]);
}

async function deleteGoal(userId, id) {
    const db = await getDb();
    const result = await db.run('DELETE FROM goals WHERE id = ? AND userId = ?', [id, userId]);
    return result.changes > 0;
}
async function writeAgentAudit(userId, action, status, details = null) {
    const db = await getDb();
    await db.run(
        'INSERT INTO agent_audit_log (userId, action, status, details, createdAt) VALUES (?, ?, ?, ?, ?)',
        [userId, action, status, details ? JSON.stringify(details) : null, new Date().toISOString()]
    );
}

async function getSummaryForUser(userId) {
    const db = await getDb();
    const [byMonth, byLabel] = await Promise.all([
        getStoredMonthlySummaries(db, userId),
        db.all(`
            SELECT Label, Category,
                SUM(AmountMinor) / 100.0 as total,
                COUNT(*) as count
            FROM transactions WHERE userId = ?
            GROUP BY Label, Category
            ORDER BY total DESC
        `, [userId]),
    ]);
    const totals = byMonth.reduce((result, month) => ({
        totalIncome: result.totalIncome + month.income,
        totalExpenses: result.totalExpenses + month.expenses,
        totalSavings: result.totalSavings + month.savings,
    }), { totalIncome: 0, totalExpenses: 0, totalSavings: 0 });

    return {
        totalIncome: totals.totalIncome,
        totalExpenses: totals.totalExpenses,
        totalSavings: totals.totalSavings,
        balance: totals.totalIncome - totals.totalExpenses - totals.totalSavings,
        byLabel,
        byMonth
    };
}

async function getDashboardBootstrapForUser(userId, month) {
    const db = await getDb();
    const normalizedMonth = String(month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(normalizedMonth)) {
        throw new Error('month must be YYYY-MM');
    }

    const start = `${normalizedMonth}-01`;
    const nextMonthDate = new Date(`${start}T00:00:00.000Z`);
    nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
    const nextMonth = nextMonthDate.toISOString().slice(0, 10);

    const [byMonth, currentTransactions] = await Promise.all([
        getStoredMonthlySummaries(db, userId),
        getAllTransactionsForUser(userId, { from: start, to: nextMonth }),
    ]);

    return {
        currentMonth: normalizedMonth,
        transactions: currentTransactions.filter(
            (transaction) => String(transaction.Timestamp || '').slice(0, 7) === normalizedMonth
        ),
        byMonth,
        generatedAt: new Date().toISOString(),
    };
}

function normalizeEmailUid(uid) {
    const numericUid = Number(uid);
    if (!Number.isSafeInteger(numericUid) || numericUid <= 0) throw new Error('Invalid email UID');
    return numericUid;
}

async function prepareEmailSync(mailboxKey, uidValidity) {
    const normalizedMailboxKey = String(mailboxKey || '').trim();
    const normalizedUidValidity = String(uidValidity || '').trim();
    if (!normalizedMailboxKey || !normalizedUidValidity) throw new Error('Mailbox identity is required');

    const db = await getDb();
    const now = new Date().toISOString();
    const current = await db.get(
        'SELECT * FROM email_sync_state WHERE mailboxKey = ?',
        [normalizedMailboxKey]
    );
    if (!current) {
        await db.run(
            `INSERT INTO email_sync_state
                (mailboxKey, uidValidity, lastDiscoveredUid, initializedAt, updatedAt)
             VALUES (?, ?, 0, ?, ?)`,
            [normalizedMailboxKey, normalizedUidValidity, now, now]
        );
        return {
            mailboxKey: normalizedMailboxKey,
            uidValidity: normalizedUidValidity,
            lastDiscoveredUid: 0,
            initialSync: true,
            adoptLegacyProcessed: true,
        };
    }
    if (String(current.uidValidity) !== normalizedUidValidity) {
        await db.run(
            `UPDATE email_sync_state
             SET uidValidity = ?, lastDiscoveredUid = 0, initializedAt = ?, updatedAt = ?
             WHERE mailboxKey = ?`,
            [normalizedUidValidity, now, now, normalizedMailboxKey]
        );
        return {
            mailboxKey: normalizedMailboxKey,
            uidValidity: normalizedUidValidity,
            lastDiscoveredUid: 0,
            initialSync: true,
            adoptLegacyProcessed: false,
        };
    }
    return {
        ...current,
        lastDiscoveredUid: Number(current.lastDiscoveredUid || 0),
        initialSync: false,
        adoptLegacyProcessed: false,
    };
}

async function enqueueDiscoveredEmails(mailboxKey, uidValidity, uids, options = {}) {
    const normalizedUids = [...new Set((uids || []).map(normalizeEmailUid))].sort((left, right) => left - right);
    if (!normalizedUids.length) return 0;

    const db = await getDb();
    const now = new Date().toISOString();
    const adoptLegacyProcessed = options.adoptLegacyProcessed === true;
    await db.run('BEGIN IMMEDIATE');
    try {
        for (const uid of normalizedUids) {
            const legacyProcessed = adoptLegacyProcessed && Boolean(await db.get(
                'SELECT uid FROM processed_emails WHERE uid = ?',
                [uid]
            ));
            await db.run(
                `INSERT OR IGNORE INTO email_ingestion_queue
                    (mailboxKey, uidValidity, uid, status, attempts, discoveredAt, nextAttemptAt, processedAt)
                 VALUES (?, ?, ?, ?, 0, ?, ?, ?)` ,
                [mailboxKey, String(uidValidity), uid, legacyProcessed ? 'processed' : 'pending',
                    now, legacyProcessed ? null : now, legacyProcessed ? now : null]
            );
        }
        await db.run(
            `UPDATE email_sync_state
             SET lastDiscoveredUid = MAX(lastDiscoveredUid, ?), updatedAt = ?
             WHERE mailboxKey = ? AND uidValidity = ?`,
            [normalizedUids.at(-1), now, mailboxKey, String(uidValidity)]
        );
        await db.run('COMMIT');
        return normalizedUids.length;
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

const EMAIL_QUEUE_MAX_ATTEMPTS = Number(process.env.EMAIL_QUEUE_MAX_ATTEMPTS || 8);
const EMAIL_QUEUE_LEASE_MS = Number(process.env.EMAIL_QUEUE_LEASE_MS || 5 * 60 * 1000);
const EMAIL_QUEUE_BACKOFF_CAP_MS = Number(process.env.EMAIL_QUEUE_BACKOFF_CAP_MS || 60 * 60 * 1000);

function retryDelayMs(attempts, baseMs = 1000, capMs = EMAIL_QUEUE_BACKOFF_CAP_MS) {
    const boundedAttempts = Math.max(0, Math.min(30, Number(attempts) || 0));
    return Math.min(capMs, baseMs * (2 ** boundedAttempts));
}

async function getPendingEmails(mailboxKey, uidValidity, limit = 250) {
    const safeLimit = Number.isSafeInteger(limit) ? Math.min(1000, Math.max(1, limit)) : 250;
    const db = await getDb();
    const now = new Date().toISOString();
    return await db.all(
        `SELECT uid, attempts, lastError, discoveredAt, nextAttemptAt
         FROM email_ingestion_queue
         WHERE mailboxKey = ? AND uidValidity = ?
           AND ((status IN ('pending', 'retry') AND COALESCE(nextAttemptAt, discoveredAt) <= ?)
             OR (status = 'processing' AND leaseExpiresAt <= ?))
         ORDER BY COALESCE(nextAttemptAt, discoveredAt) ASC, uid ASC LIMIT ?`,
        [mailboxKey, String(uidValidity), now, now, safeLimit]
    );
}

async function claimPendingEmails(mailboxKey, uidValidity, workerId, limit = 250, now = new Date()) {
    const safeLimit = Number.isSafeInteger(limit) ? Math.min(1000, Math.max(1, limit)) : 250;
    const owner = String(workerId || '').trim();
    if (!owner) throw new Error('A queue worker id is required to claim email ingestion work');
    const db = await getDb();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + EMAIL_QUEUE_LEASE_MS).toISOString();
    await db.run('BEGIN IMMEDIATE');
    try {
        const rows = await db.all(
            `SELECT uid, attempts, lastError, discoveredAt, nextAttemptAt
             FROM email_ingestion_queue
             WHERE mailboxKey = ? AND uidValidity = ?
               AND ((status IN ('pending', 'retry') AND COALESCE(nextAttemptAt, discoveredAt) <= ?)
                 OR (status = 'processing' AND leaseExpiresAt <= ?))
             ORDER BY COALESCE(nextAttemptAt, discoveredAt) ASC, uid ASC LIMIT ?`,
            [mailboxKey, String(uidValidity), nowIso, nowIso, safeLimit]
        );
        for (const row of rows) {
            await db.run(
                `UPDATE email_ingestion_queue
                 SET status = 'processing', attempts = attempts + 1, leaseOwner = ?, leaseExpiresAt = ?
                 WHERE mailboxKey = ? AND uidValidity = ? AND uid = ?`,
                [owner, leaseExpiresAt, mailboxKey, String(uidValidity), row.uid]
            );
            row.attempts += 1;
        }
        await db.run('COMMIT');
        return rows;
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

async function completeEmailQueueItem(uid, mailboxKey, uidValidity, workerId = null) {
    const db = await getDb();
    const normalizedUid = normalizeEmailUid(uid);
    const now = new Date().toISOString();
    const ownershipClause = workerId ? ' AND leaseOwner = ?' : '';
    const params = [now, mailboxKey, String(uidValidity), normalizedUid];
    if (workerId) params.push(String(workerId));
    const result = await db.run(
        `UPDATE email_ingestion_queue
         SET status = 'processed', lastError = NULL, processedAt = ?, nextAttemptAt = NULL,
             leaseOwner = NULL, leaseExpiresAt = NULL
         WHERE mailboxKey = ? AND uidValidity = ? AND uid = ? AND status = 'processing'${ownershipClause}`,
        params
    );
    if (result.changes) {
        await db.run('INSERT OR IGNORE INTO processed_emails (uid, processedAt) VALUES (?, ?)', [normalizedUid, now]);
    }
    return result.changes > 0;
}

async function failEmailQueueItem(uid, mailboxKey, uidValidity, workerId, error, now = new Date()) {
    const db = await getDb();
    const normalizedUid = normalizeEmailUid(uid);
    const row = await db.get(
        `SELECT attempts FROM email_ingestion_queue
         WHERE mailboxKey = ? AND uidValidity = ? AND uid = ? AND status = 'processing' AND leaseOwner = ?`,
        [mailboxKey, String(uidValidity), normalizedUid, String(workerId)]
    );
    if (!row) return { status: 'lost_lease' };
    const attempts = Number(row.attempts || 0);
    const dead = attempts >= EMAIL_QUEUE_MAX_ATTEMPTS;
    const nextAttemptAt = dead ? null : new Date(now.getTime() + retryDelayMs(attempts)).toISOString();
    await db.run(
        `UPDATE email_ingestion_queue
         SET status = ?, lastError = ?, nextAttemptAt = ?, leaseOwner = NULL, leaseExpiresAt = NULL
         WHERE mailboxKey = ? AND uidValidity = ? AND uid = ? AND status = 'processing' AND leaseOwner = ?`,
        [dead ? 'dead' : 'retry', String(error?.message || error || 'Processing failed').slice(0, 1000),
            nextAttemptAt, mailboxKey, String(uidValidity), normalizedUid, String(workerId)]
    );
    return { status: dead ? 'dead' : 'retry', attempts, nextAttemptAt };
}

const TELEGRAM_OUTBOX_MAX_ATTEMPTS = Number(process.env.TELEGRAM_OUTBOX_MAX_ATTEMPTS || 8);
const TELEGRAM_OUTBOX_LEASE_MS = Number(process.env.TELEGRAM_OUTBOX_LEASE_MS || 2 * 60 * 1000);

async function enqueueTelegramOutbox(action, payload, { transactionId = null } = {}) {
    const db = await getDb();
    const now = new Date().toISOString();
    const result = await db.run(
        `INSERT INTO telegram_outbox
            (action, payloadJson, transactionId, status, attempts, nextAttemptAt, createdAt)
         VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
        [String(action), JSON.stringify(payload || {}), transactionId, now, now]
    );
    return result.lastID;
}

async function claimTelegramOutbox(workerId, limit = 50, now = new Date()) {
    const owner = String(workerId || '').trim();
    if (!owner) throw new Error('A queue worker id is required to claim Telegram outbox work');
    const safeLimit = Number.isSafeInteger(limit) ? Math.min(500, Math.max(1, limit)) : 50;
    const db = await getDb();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + TELEGRAM_OUTBOX_LEASE_MS).toISOString();
    await db.run('BEGIN IMMEDIATE');
    try {
        const rows = await db.all(
            `SELECT id, action, payloadJson, transactionId, attempts
             FROM telegram_outbox
             WHERE (status IN ('pending', 'retry') AND nextAttemptAt <= ?)
                OR (status = 'processing' AND leaseExpiresAt <= ?)
             ORDER BY nextAttemptAt ASC, id ASC LIMIT ?`,
            [nowIso, nowIso, safeLimit]
        );
        for (const row of rows) {
            await db.run(
                `UPDATE telegram_outbox
                 SET status = 'processing', attempts = attempts + 1, leaseOwner = ?, leaseExpiresAt = ?
                 WHERE id = ?`,
                [owner, leaseExpiresAt, row.id]
            );
            row.attempts += 1;
            try { row.payload = JSON.parse(row.payloadJson); } catch { row.payload = {}; }
            delete row.payloadJson;
        }
        await db.run('COMMIT');
        return rows;
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

async function completeTelegramOutbox(id, workerId, telegramMessageId = null) {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.run('BEGIN IMMEDIATE');
    try {
        const row = await db.get(
            `SELECT transactionId FROM telegram_outbox
             WHERE id = ? AND status = 'processing' AND leaseOwner = ?`,
            [id, String(workerId)]
        );
        if (!row) {
            await db.run('ROLLBACK');
            return false;
        }
        await db.run(
            `UPDATE telegram_outbox
             SET status = 'processed', processedAt = ?, lastError = NULL, nextAttemptAt = NULL,
                 leaseOwner = NULL, leaseExpiresAt = NULL
             WHERE id = ?`,
            [now, id]
        );
        if (row.transactionId && telegramMessageId) {
            await db.run('UPDATE transactions SET TelegramMessageId = ? WHERE id = ?', [telegramMessageId, row.transactionId]);
        }
        await db.run('COMMIT');
        return true;
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

async function failTelegramOutbox(id, workerId, error, now = new Date()) {
    const db = await getDb();
    const row = await db.get(
        `SELECT attempts FROM telegram_outbox WHERE id = ? AND status = 'processing' AND leaseOwner = ?`,
        [id, String(workerId)]
    );
    if (!row) return { status: 'lost_lease' };
    const attempts = Number(row.attempts || 0);
    const dead = attempts >= TELEGRAM_OUTBOX_MAX_ATTEMPTS;
    const nextAttemptAt = dead ? null : new Date(now.getTime() + retryDelayMs(attempts)).toISOString();
    await db.run(
        `UPDATE telegram_outbox
         SET status = ?, lastError = ?, nextAttemptAt = ?, leaseOwner = NULL, leaseExpiresAt = NULL
         WHERE id = ? AND leaseOwner = ?`,
        [dead ? 'dead' : 'retry', String(error?.message || error || 'Telegram delivery failed').slice(0, 1000),
            nextAttemptAt, id, String(workerId)]
    );
    return { status: dead ? 'dead' : 'retry', attempts, nextAttemptAt };
}

async function getQueueHealth() {
    const db = await getDb();
    const [email, telegram] = await Promise.all([
        db.all("SELECT status, COUNT(*) AS count FROM email_ingestion_queue GROUP BY status"),
        db.all("SELECT status, COUNT(*) AS count FROM telegram_outbox GROUP BY status"),
    ]);
    const summarize = (rows) => Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
    return { email: summarize(email), telegram: summarize(telegram) };
}

async function isEmailProcessed(uid, mailboxKey = null, uidValidity = null) {
    const db = await getDb();
    if (mailboxKey && uidValidity !== null && uidValidity !== undefined) {
        const row = await db.get(
            `SELECT uid FROM email_ingestion_queue
             WHERE mailboxKey = ? AND uidValidity = ? AND uid = ? AND status = 'processed'`,
            [mailboxKey, String(uidValidity), normalizeEmailUid(uid)]
        );
        return !!row;
    }
    const row = await db.get('SELECT uid FROM processed_emails WHERE uid = ?', [uid]);
    return !!row;
}

async function markEmailProcessed(uid, mailboxKey = null, uidValidity = null) {
    const db = await getDb();
    const normalizedUid = normalizeEmailUid(uid);
    const now = new Date().toISOString();
    if (mailboxKey && uidValidity !== null && uidValidity !== undefined) {
        await db.run(
            `UPDATE email_ingestion_queue
             SET status = 'processed', attempts = attempts + 1, lastError = NULL, processedAt = ?,
                 nextAttemptAt = NULL, leaseOwner = NULL, leaseExpiresAt = NULL
             WHERE mailboxKey = ? AND uidValidity = ? AND uid = ?`,
            [now, mailboxKey, String(uidValidity), normalizedUid]
        );
    }
    await db.run(
        'INSERT OR IGNORE INTO processed_emails (uid, processedAt) VALUES (?, ?)',
        [normalizedUid, now]
    );
}

async function markEmailFailed(uid, mailboxKey, uidValidity, error) {
    const db = await getDb();
    await db.run(
        `UPDATE email_ingestion_queue
         SET attempts = attempts + 1, lastError = ?, status = 'retry',
             nextAttemptAt = ?, leaseOwner = NULL, leaseExpiresAt = NULL
        WHERE mailboxKey = ? AND uidValidity = ? AND uid = ? AND status IN ('pending', 'retry', 'processing')`,
        [String(error?.message || error || 'Processing failed').slice(0, 1000),
            new Date().toISOString(), mailboxKey, String(uidValidity), normalizeEmailUid(uid)]
    );
}

// ─── MERCHANT RULES (AI LEARNING FROM USER EDITS) ──────────────────────────
async function saveMerchantRule(userId, pattern, category, label) {
    const db = await getDb();
    const cleanPattern = pattern.trim().toLowerCase();
    if (!cleanPattern) return;

    await db.run(
        `INSERT INTO merchant_rules (userId, pattern, category, label)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(userId, pattern) DO UPDATE SET
         category = excluded.category,
         label = excluded.label`,
        [userId, cleanPattern, category, label]
    );
    console.log(`[Rules] Learned: "${cleanPattern}" -> Category: ${category}, Label: ${label}`);
}

async function getMerchantRuleForReason(userId, reason) {
    const db = await getDb();
    if (!reason) return null;
    const cleanReason = reason.trim().toLowerCase();

    // Fetch rules and search for any pattern that matches as a substring of cleanReason
    const rules = await db.all('SELECT * FROM merchant_rules WHERE userId = ?', [userId]);
    const matchingRule = rules.find(rule => cleanReason.includes(rule.pattern.toLowerCase()));
    return matchingRule || null;
}

// ─── AUTOMATIC RECURRING DETECTION ─────────────────────────────────────────
async function detectAndMarkRecurring(userId, transactionId) {
    const db = await getDb();
    const tx = await db.get('SELECT * FROM transactions WHERE id = ? AND userId = ?', [transactionId, userId]);
    if (!tx || !tx.Reason) return;

    // Normalize reason (lowercase, remove store #s and digits/punctuation)
    const cleanReason = tx.Reason.toLowerCase()
        .replace(/#[0-9]+/g, '')
        .replace(/[0-9]/g, '')
        .replace(/[\*\-\_\:\.]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (cleanReason.length < 3) return;

    // Fetch all user transactions to find matches
    const allTx = await db.all('SELECT * FROM transactions WHERE userId = ?', [userId]);
    const matches = allTx.filter(t => {
        if (!t.Reason) return false;
        const targetClean = t.Reason.toLowerCase()
            .replace(/#[0-9]+/g, '')
            .replace(/[0-9]/g, '')
            .replace(/[\*\-\_\:\.]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return targetClean.includes(cleanReason) || cleanReason.includes(targetClean);
    });

    if (matches.length >= 2) {
        const sortedMatches = matches.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));
        const months = new Set(sortedMatches.map(t => t.Timestamp.substring(0, 7)));

        if (months.size >= 2) {
            let totalGap = 0;
            let gapCount = 0;
            for (let i = 1; i < sortedMatches.length; i++) {
                const diffMs = new Date(sortedMatches[i].Timestamp) - new Date(sortedMatches[i-1].Timestamp);
                const diffDays = diffMs / (1000 * 60 * 60 * 24);
                totalGap += diffDays;
                gapCount++;
            }

            const avgGap = gapCount > 0 ? (totalGap / gapCount) : 30;
            let frequency = 'OneTime';

            if (avgGap >= 25 && avgGap <= 35) {
                frequency = 'Monthly';
            } else if (avgGap >= 5 && avgGap <= 9) {
                frequency = 'Weekly';
            } else if (avgGap >= 12 && avgGap <= 16) {
                frequency = 'Bi-Weekly';
            } else if (avgGap >= 1 && avgGap <= 2) {
                frequency = 'Daily';
            } else {
                frequency = 'Monthly'; // fallback default for irregular multi-month recurrence
            }

            const matchIds = sortedMatches.map(t => t.id);
            const placeholders = matchIds.map(() => '?').join(',');
            await db.run(
                `UPDATE transactions SET Frequency = ? WHERE id IN (${placeholders})`,
                [frequency, ...matchIds]
            );
            console.log(`[Recurring] Detected recurrence: marked ${matchIds.length} transactions as "${frequency}" (pattern: "${cleanReason}").`);
        }
    }
}

// ─── Internal Transfer Auto-Detection ─────────────────────────────────────
// Time window (ms) within which transactions of the same amount can form
// a valid internal self-transfer group.
const INTERNAL_PAIRING_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

function isTemporaryInternalTransfer(tx) {
    if (!tx) return false;
    if (tx.Category !== 'Internal') return false;
    if (tx.ReferenceNumber && /^XFER-/i.test(tx.ReferenceNumber)) return false;
    const reason = String(tx.Reason || '');
    return /temporary/i.test(reason) || /temporary/i.test(String(tx.Account || ''));
}

/**
 * Returns true if an Internal transaction is a genuine bank/Interac email alert
 * or an unpaired temporary internal transfer.
 */
function isEmailSourcedInternalTransfer(tx) {
    if (!tx.ReceivedAt && !tx.Timestamp) return false;
    if (tx.ReferenceNumber && /^XFER-/i.test(tx.ReferenceNumber)) return false;
    if (/^Internal transfer:/i.test(String(tx.Reason || ''))) {
        return isTemporaryInternalTransfer(tx);
    }
    return true;
}

/** Normalised account identity for grouping transactions by account. */
function normalizeAccountKey(bankName, account) {
    const bank = String(bankName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const digits = String(account || '').replace(/\D/g, '');
    const accountIdentity = digits.length >= 4
        ? `last4:${digits.slice(-4)}`
        : String(account || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${bank}|${accountIdentity}`;
}

function normalizeBankKey(bankName) {
    return String(bankName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function receivedTime(transaction) {
    const value = new Date(transaction?.ReceivedAt || '').getTime();
    return Number.isFinite(value) ? value : null;
}

/**
 * Match the two emails emitted for one credit-card payment. This deliberately
 * uses stronger evidence than ordinary amount matching: one explicit outgoing
 * e-Transfer, one explicit credit-card payment, same institution/currency and
 * amount, different accounts, and email receipt times within ten minutes.
 */
async function pairCreditCardPaymentEmails(db, userId, transactions, amountMinor) {
    const unlinked = transactions.filter(t => !/^XFER-/i.test(String(t.ReferenceNumber || '')));
    const transferCandidates = unlinked.filter(t => t.ReceivedAt && isOutgoingEmailTransfer(t));
    const cardCandidates = unlinked.filter(t => t.ReceivedAt && isCreditCardPayment(t));
    if (transferCandidates.length !== 1 || cardCandidates.length !== 1) return [];

    const outgoing = transferCandidates[0];
    const cardPayment = cardCandidates[0];
    if (outgoing.id === cardPayment.id) return [];
    if (normalizeAccountKey(outgoing.BankName, outgoing.Account) ===
        normalizeAccountKey(cardPayment.BankName, cardPayment.Account)) return [];

    const outgoingBank = normalizeBankKey(outgoing.BankName);
    const cardBank = normalizeBankKey(cardPayment.BankName);
    if (!outgoingBank || outgoingBank !== cardBank) return [];

    const outgoingReceived = receivedTime(outgoing);
    const cardReceived = receivedTime(cardPayment);
    const maxReceiptGapMs = 10 * 60 * 1000;
    if (outgoingReceived === null || cardReceived === null ||
        Math.abs(outgoingReceived - cardReceived) > maxReceiptGapMs) return [];

    const source = describeDiscoveredAccount(outgoing)?.name || outgoing.Account || outgoing.BankName || 'Bank account';
    const destination = describeDiscoveredAccount(cardPayment)?.name || cardPayment.Account || 'Credit card';
    const reason = `Internal transfer: ${source} -> ${destination}`;
    const groupTime = Math.min(outgoingReceived, cardReceived);
    const reference = `XFER-CARD-${groupTime}-${amountMinor}`;

    await db.run(
        `UPDATE transactions
         SET Category = 'Internal', Label = 'Internal Transfer', Reason = ?,
             ReferenceNumber = ?, AccountFlow = 'OUT'
         WHERE id = ? AND userId = ?`,
        [reason, reference, outgoing.id, userId]
    );
    await db.run(
        `UPDATE transactions
         SET Category = 'Internal', Label = 'Internal Transfer', Reason = ?,
             ReferenceNumber = ?, AccountFlow = 'IN'
         WHERE id = ? AND userId = ?`,
        [reason, reference, cardPayment.id, userId]
    );

    // The card email may already have posted with the wrong OUT direction.
    // Re-syncing is idempotent and reverses that event before applying IN.
    await syncTransactionAccountBalance(userId, cardPayment.id);
    await refreshTransactionMonths(db, [outgoing, cardPayment]);

    return [outgoing, cardPayment].map(leg => ({
        id: leg.id,
        oldCategory: leg.Category,
        oldLabel: leg.Label,
        newCategory: 'Internal',
        newLabel: 'Internal Transfer',
    }));
}

/**
 * After any transaction is saved or marked, detect whether it is part of an
 * internal transfer (including Temporary transfers and multi-email transfers)
 * and reclassify / link the relevant counterparts.
 */
async function detectAndReclassifyInternalCounterparts(userId, transactionId) {
    const db = await getDb();
    const tx = await db.get(
        'SELECT * FROM transactions WHERE id = ? AND userId = ?',
        [transactionId, userId]
    );
    if (!tx) return [];
    if (!tx.ReceivedAt && !tx.Timestamp) return [];

    const txTime = new Date(tx.Timestamp || tx.ReceivedAt).getTime();
    if (!Number.isFinite(txTime)) return [];

    const isTemporary = isTemporaryInternalTransfer(tx);
    const isInterac = tx.Category === 'Internal' && isEmailSourcedInternalTransfer(tx);
    const isBankAlert = tx.Category === 'Income' || tx.Category === 'Expense';
    if (!isInterac && !isBankAlert && !isTemporary) return [];

    const windowHours = isTemporary ? 30 * 24 : INTERNAL_PAIRING_WINDOW_MS / 3600000;

    // ── Step 1: collect all same-amount email-sourced siblings within window ──
    const siblings = await db.all(
        `SELECT * FROM transactions
         WHERE userId = ? AND AmountMinor = ? AND Currency = ?
           AND id != ?
           AND ABS(JULIANDAY(Timestamp) - JULIANDAY(?)) * 24 <= ?`,
        [userId, tx.AmountMinor, tx.Currency || 'CAD', transactionId, tx.Timestamp, windowHours]
    );

    let all = [tx, ...siblings];

    // Transaction timestamps can use different provider conventions (posting
    // date at midnight versus an actual event time). For this strict email
    // pattern, collect by receipt time so timezone differences cannot hide the
    // counterpart. The evidence checks below still require a unique pair.
    let cardPaymentEmailCandidates = all;
    if (tx.ReceivedAt) {
        const receivedSiblings = await db.all(
            `SELECT * FROM transactions
             WHERE userId = ? AND AmountMinor = ? AND Currency = ?
               AND id != ? AND ReceivedAt IS NOT NULL
               AND ABS(JULIANDAY(ReceivedAt) - JULIANDAY(?)) * 24 <= ?`,
            [userId, tx.AmountMinor, tx.Currency || 'CAD', transactionId, tx.ReceivedAt, 10 / 60]
        );
        cardPaymentEmailCandidates = [...new Map(
            [tx, ...receivedSiblings].map(candidate => [candidate.id, candidate])
        ).values()];
    }

    const cardPaymentPair = await pairCreditCardPaymentEmails(
        db, userId, cardPaymentEmailCandidates, tx.AmountMinor
    );
    if (cardPaymentPair.length) return cardPaymentPair;

    // If neither tx nor siblings are temporary, check if an unpaired temporary transfer exists in a 30-day window
    const hasTemporary = all.some(t => isTemporaryInternalTransfer(t));
    if (!hasTemporary) {
        const tempSiblings = await db.all(
            `SELECT * FROM transactions
             WHERE userId = ? AND AmountMinor = ? AND Currency = ?
               AND id != ?
               AND Category = 'Internal'
               AND (ReferenceNumber IS NULL OR ReferenceNumber NOT LIKE 'XFER-%')
               AND (Reason LIKE '%Temporary%' OR Account = 'Temporary')
               AND ABS(JULIANDAY(Timestamp) - JULIANDAY(?)) * 24 <= 720`,
            [userId, tx.AmountMinor, tx.Currency || 'CAD', transactionId, tx.Timestamp]
        );
        if (tempSiblings.length > 0) {
            all = [tx, ...tempSiblings];
        }
    }

    // ── Handle Temporary Transfer Pairing ─────────────────────────────────────
    if (all.some(t => isTemporaryInternalTransfer(t))) {
        const outCandidate = all.find(
            t => (!t.ReferenceNumber || !/^XFER-/i.test(t.ReferenceNumber)) &&
                 (t.AccountFlow === 'OUT' || t.Category === 'Expense' || /->\s*Temporary/i.test(String(t.Reason || '')))
        );
        const inCandidate = all.find(
            t => t.id !== outCandidate?.id &&
                 (!t.ReferenceNumber || !/^XFER-/i.test(t.ReferenceNumber)) &&
                 (t.AccountFlow === 'IN' || t.Category === 'Income' || /Temporary\s*->/i.test(String(t.Reason || '')))
        );

        if (outCandidate && inCandidate) {
            const extractAccount = (leg, isOut) => {
                const reason = String(leg.Reason || '');
                const m = reason.match(/^Internal transfer:\s*(.*?)\s*->\s*(.*?)(?:\s*\[|$)/i);
                if (m) {
                    const target = isOut ? m[1].trim() : m[2].trim();
                    if (target && !/temporary/i.test(target)) return target;
                }
                const desc = describeDiscoveredAccount(leg);
                if (desc?.name && !/temporary/i.test(desc.name)) return desc.name;
                if (leg.Account && !/temporary/i.test(leg.Account)) return leg.Account;
                if (leg.BankName && !/temporary/i.test(leg.BankName)) return leg.BankName;
                return 'Account';
            };

            const sourceStr = extractAccount(outCandidate, true);
            const destStr = extractAccount(inCandidate, false);

            const isSameAccount = sourceStr.toLowerCase() === destStr.toLowerCase() && sourceStr !== 'Account';
            const sharedReason = isSameAccount
                ? `Internal transfer: ${sourceStr} -> Temporary -> ${destStr}`
                : `Internal transfer: ${sourceStr} -> ${destStr}`;

            const groupTime = Math.min(
                new Date(outCandidate.Timestamp || outCandidate.ReceivedAt).getTime(),
                new Date(inCandidate.Timestamp || inCandidate.ReceivedAt).getTime()
            );
            const sharedRef = `XFER-${groupTime}-${tx.AmountMinor}`;

            const reclassified = [];
            for (const leg of [outCandidate, inCandidate]) {
                const isAlreadyInternal = leg.Category === 'Internal' && leg.Label === 'Internal Transfer';
                await db.run(
                    `UPDATE transactions SET Category = 'Internal', Label = 'Internal Transfer', Reason = ?, ReferenceNumber = ?
                     WHERE id = ? AND userId = ?`,
                    [sharedReason, sharedRef, leg.id, userId]
                );

                console.log(
                    `[InternalPairing] Paired temporary transfer tx ${leg.id} ` +
                    `(${leg.Category}/${leg.Label} $${leg.Amount}) → Internal/Internal Transfer (linked as ${sharedRef}: ${sharedReason}).`
                );
                reclassified.push({
                    id: leg.id,
                    oldCategory: leg.Category,
                    oldLabel: leg.Label,
                    newCategory: 'Internal',
                    newLabel: 'Internal Transfer',
                });
            }
            await refreshTransactionMonths(db, [outCandidate, inCandidate]);
            return reclassified;
        }
    }

    // ── Step 2: identify the Interac notification (among siblings or tx itself) ──
    const interac = all.find(t => t.Category === 'Internal' && isEmailSourcedInternalTransfer(t));

    // ── Step 3: collect reclassifiable bank-alert siblings and occupied accounts ──
    const alreadyPairedBankAlertSiblings = siblings.filter(
        s => s.Category === 'Internal' && s.ReceivedAt &&
             !/^Internal transfer:/i.test(String(s.Reason || '')) &&
             (interac ? s.id !== interac.id : true) &&
             (s.AccountFlow === 'IN' || s.AccountFlow === 'OUT' || s.BankName !== 'Interac')
    );
    const occupiedAccountKeys = new Set(
        alreadyPairedBankAlertSiblings.map(s => normalizeAccountKey(s.BankName, s.Account))
    );

    const candidates = all.filter(
        s => (s.Category === 'Income' || s.Category === 'Expense') && s.ReceivedAt
    );

    if (candidates.length === 0) return [];

    // Remove candidates whose account is already occupied by an existing Internal pairing
    const availableCandidates = candidates.filter(
        c => !occupiedAccountKeys.has(normalizeAccountKey(c.BankName, c.Account))
    );

    if (availableCandidates.length === 0) return [];

    // ── Step 4: group candidates by account, then choose pairIN + pairOUT ────
    const byAccount = new Map();
    for (const c of availableCandidates) {
        const key = normalizeAccountKey(c.BankName, c.Account);
        if (!byAccount.has(key)) byAccount.set(key, { key, ins: [], outs: [] });
        const g = byAccount.get(key);
        if (c.AccountFlow === 'OUT') g.outs.push(c);
        else g.ins.push(c);
    }

    const accountGroups = [...byAccount.values()];
    let pairIN  = null;
    let pairOUT = null;

    if (accountGroups.length > 1) {
        for (const group of accountGroups) {
            if (!pairIN && group.ins.length === 1 && group.outs.length === 0) {
                pairIN = group.ins[0];
                break;
            }
        }
        for (const group of accountGroups) {
            if (!pairOUT && group.outs.length === 1 && group.ins.length === 0) {
                if (!pairIN || group.key !== normalizeAccountKey(pairIN.BankName, pairIN.Account)) {
                    pairOUT = group.outs[0];
                    break;
                }
            }
        }

        if (!pairIN || !pairOUT) return [];
    }
    // Never classify two standard bank alert legs from the same account as an internal transfer
    if (!pairIN || !pairOUT ||
        normalizeAccountKey(pairIN.BankName, pairIN.Account) ===
        normalizeAccountKey(pairOUT.BankName, pairOUT.Account)) return [];

    // ── Step 5: reclassify and link the selected pair ──────────────────────────────────
    let sourceStr = "External";
    if (pairOUT) {
        const desc = describeDiscoveredAccount(pairOUT);
        sourceStr = desc ? desc.name : (pairOUT.BankName || "External");
    } else if (interac && interac.Reason) {
        const m = String(interac.Reason).match(/E-Transfer\s*-\s*(.+)/i);
        if (m) sourceStr = m[1].trim();
        else sourceStr = "Interac";
    }

    let destStr = "External";
    if (pairIN) {
        const desc = describeDiscoveredAccount(pairIN);
        destStr = desc ? desc.name : (pairIN.BankName || "External");
    } else if (interac && interac.Reason) {
        const m = String(interac.Reason).match(/E-Transfer\s*-\s*(.+)/i);
        if (m) destStr = m[1].trim();
        else destStr = "Interac";
    }

    if (sourceStr === destStr && sourceStr === "Interac") {
        destStr = "Account";
    }

    const sharedReason = `Internal transfer: ${sourceStr} -> ${destStr}`;
    const groupTime = Math.min(...[pairIN, pairOUT, interac].filter(Boolean).map(t => new Date(t.Timestamp).getTime()));
    const sharedRef = `XFER-${groupTime}-${tx.AmountMinor}`;

    const reclassified = [];
    const legsToUpdate = [pairIN, pairOUT, interac].filter(Boolean);

    for (const leg of legsToUpdate) {
        const isAlreadyInternal = leg.Category === 'Internal';

        await db.run(
            `UPDATE transactions SET Category = 'Internal', Label = 'Internal Transfer', Reason = ?, ReferenceNumber = ?
             WHERE id = ? AND userId = ?`,
            [sharedReason, sharedRef, leg.id, userId]
        );

        if (!isAlreadyInternal) {
            console.log(
                `[InternalPairing] Reclassified tx ${leg.id} ` +
                `(${leg.Category}/${leg.Label} $${leg.Amount} ` +
                `AccountFlow=${leg.AccountFlow} ${leg.BankName} ${leg.Account}) ` +
                `→ Internal/Internal Transfer (linked as ${sharedRef}).`
            );
            reclassified.push({
                id: leg.id,
                oldCategory: leg.Category,
                oldLabel: leg.Label,
                newCategory: 'Internal',
                newLabel: 'Internal Transfer',
            });
        } else {
            console.log(
                `[InternalPairing] Linked already-Internal tx ${leg.id} ` +
                `to transfer group ${sharedRef}.`
            );
        }
    }

    await refreshTransactionMonths(db, legsToUpdate);
    return reclassified;
}

module.exports = {
    getDb,
    createUser,
    getUserCount,
    getUserByUsername,
    getUserById,
    updateUserProfilePhoto,
    getAllTransactionsForUser,
    addTransaction,
    commitEmailTransaction,
    getTransactionById,
    getTransactionBySourceEmailKey,
    upsertTransactionSource,
    getTransactionSourcesForUser,
    migrateAndPruneRawEmailSources,
    getEmailSourceKeysNeedingReplay,
    updateTransaction,
    updateTransactionForUser,
    deleteTransaction,
    findDuplicateTransaction,
    getAccountsForUser,
    trackAccount,
    ensureTransactionAccount,
    getInvestmentAccounts,
    getPortfolioSummary,
    createInvestmentAccount,
    updateInvestmentAccount,
    deleteInvestmentAccount,
    upsertInvestmentHolding,
    deleteInvestmentHolding,
    applyEmailPortfolioActivity,
    syncTransactionAccountBalance,
    removeTransactionAccountBalance,
    reconcileTransactionAccountBalances,
    reconcileEmailPortfolioActivities,
    getUserSettings,
    saveUserSettings,
    getBudgetsForUser,
    saveBudget,
    getGoalsForUser,
    createGoal,
    updateGoal,
    deleteGoal,
    writeAgentAudit,
    getSummaryForUser,
    getDashboardBootstrapForUser,
    prepareEmailSync,
    enqueueDiscoveredEmails,
    getPendingEmails,
    claimPendingEmails,
    completeEmailQueueItem,
    failEmailQueueItem,
    isEmailProcessed,
    markEmailProcessed,
    markEmailFailed,
    enqueueTelegramOutbox,
    claimTelegramOutbox,
    completeTelegramOutbox,
    failTelegramOutbox,
    getQueueHealth,
    retryDelayMs,
    saveMerchantRule,
    getMerchantRuleForReason,
    detectAndMarkRecurring,
    detectAndReclassifyInternalCounterparts
};
