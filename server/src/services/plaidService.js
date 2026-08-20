const crypto = require('crypto');
const dbService = require('../database/dbService');

const PLAID_ENVIRONMENTS = new Set(['sandbox', 'development', 'production']);
const syncPromises = new Map();
const USER_SYNC_COOLDOWN_MS = 10 * 60 * 1000;

function getConfig() {
    const environment = PLAID_ENVIRONMENTS.has(process.env.PLAID_ENV)
        ? process.env.PLAID_ENV
        : 'sandbox';
    return {
        clientId: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        environment,
        baseUrl: `https://${environment}.plaid.com`,
        countries: (process.env.PLAID_COUNTRY_CODES || 'CA')
            .split(',').map((value) => value.trim().toUpperCase()).filter(Boolean),
        redirectUri: process.env.PLAID_REDIRECT_URI || null,
        webhookUrl: process.env.PLAID_WEBHOOK_URL || null,
        encryptionSecret: process.env.PLAID_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET,
    };
}

function isConfigured() {
    const config = getConfig();
    return Boolean(config.clientId && config.secret && config.encryptionSecret);
}

function requireConfig() {
    const config = getConfig();
    if (!config.clientId || !config.secret) {
        const error = new Error('Plaid credentials are not configured');
        error.statusCode = 503;
        throw error;
    }
    if (!config.encryptionSecret) {
        const error = new Error('PLAID_TOKEN_ENCRYPTION_KEY or JWT_SECRET is required');
        error.statusCode = 503;
        throw error;
    }
    return config;
}

function encryptionKey(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest();
}

function encryptAccessToken(accessToken) {
    const { encryptionSecret } = requireConfig();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(encryptionSecret), iv);
    const encrypted = Buffer.concat([cipher.update(accessToken, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptAccessToken(payload) {
    const { encryptionSecret } = requireConfig();
    const [ivValue, tagValue, encryptedValue] = String(payload || '').split('.');
    if (!ivValue || !tagValue || !encryptedValue) throw new Error('Invalid encrypted Plaid token');
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm', encryptionKey(encryptionSecret), Buffer.from(ivValue, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}

async function plaidRequest(path, body = {}) {
    const config = requireConfig();
    const response = await fetch(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: config.clientId, secret: config.secret, ...body }),
        signal: AbortSignal.timeout(30000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error_message || `Plaid request failed (${response.status})`);
        error.code = data.error_code;
        error.type = data.error_type;
        error.statusCode = response.status >= 500 ? 502 : 400;
        throw error;
    }
    return data;
}

async function createLinkToken(userId) {
    const config = requireConfig();
    const request = {
        user: { client_user_id: String(userId) },
        client_name: 'MoniMonitor',
        products: ['transactions'],
        transactions: { days_requested: 90 },
        country_codes: config.countries,
        language: 'en',
    };
    if (config.redirectUri) request.redirect_uri = config.redirectUri;
    if (config.webhookUrl) request.webhook = config.webhookUrl;
    const result = await plaidRequest('/link/token/create', request);
    return { linkToken: result.link_token, expiration: result.expiration };
}

function cleanMetadata(metadata = {}) {
    const institution = metadata && typeof metadata.institution === 'object' ? metadata.institution : {};
    const compact = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) || null : null;
    return {
        institutionId: compact(institution.institution_id, 100),
        institutionName: compact(institution.name, 160),
    };
}

async function exchangePublicToken(userId, publicToken, metadata = {}) {
    if (typeof publicToken !== 'string' || !publicToken.startsWith('public-') || publicToken.length > 1000) {
        const error = new Error('Invalid Plaid public token');
        error.statusCode = 400;
        throw error;
    }
    const result = await plaidRequest('/item/public_token/exchange', { public_token: publicToken });
    const db = await dbService.getDb();
    const existing = await db.get('SELECT userId FROM plaid_items WHERE itemId = ?', [result.item_id]);
    if (existing && existing.userId !== userId) {
        const error = new Error('This bank connection belongs to another user');
        error.statusCode = 409;
        throw error;
    }
    const now = new Date().toISOString();
    const institution = cleanMetadata(metadata);
    await db.run(
        `INSERT INTO plaid_items
            (itemId, userId, accessTokenEncrypted, institutionId, institutionName, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
         ON CONFLICT(itemId) DO UPDATE SET
            accessTokenEncrypted = excluded.accessTokenEncrypted,
            institutionId = COALESCE(excluded.institutionId, plaid_items.institutionId),
            institutionName = COALESCE(excluded.institutionName, plaid_items.institutionName),
            status = 'active', lastError = NULL, updatedAt = excluded.updatedAt`,
        [result.item_id, userId, encryptAccessToken(result.access_token),
            institution.institutionId, institution.institutionName, now, now]
    );
    return { itemId: result.item_id };
}

function accountTypeLabel(account = {}) {
    if (account.type === 'credit') return 'Credit Card';
    if (account.subtype === 'savings') return 'Savings';
    if (account.subtype === 'checking') return 'Chequing';
    if (account.type === 'loan') return 'Other';
    return account.subtype || account.type || 'Bank Account';
}

function classifyPlaidTransaction(transaction = {}) {
    const primary = transaction.personal_finance_category?.primary || '';
    const detailed = transaction.personal_finance_category?.detailed || '';
    const outflow = Number(transaction.amount) > 0;
    if (!outflow) {
        if (primary === 'INCOME' && /WAGES|PAYCHECK|PAYROLL/.test(detailed)) {
            return { Category: 'Income', Label: 'Employment Income' };
        }
        if (primary === 'TRANSFER_IN') return { Category: 'Income', Label: 'Personal Transfers Received' };
        if (/REFUND|REVERSAL/.test(detailed)) return { Category: 'Income', Label: 'Refunds & Reversals' };
        return { Category: 'Income', Label: primary === 'INCOME' ? 'Other Income' : 'Refunds & Reversals' };
    }

    const labels = {
        BANK_FEES: 'Financial Charges',
        ENTERTAINMENT: 'Entertainment',
        FOOD_AND_DRINK: /GROCER/.test(detailed) ? 'Groceries' : 'Dining',
        GENERAL_MERCHANDISE: 'Shopping',
        GENERAL_SERVICES: 'Other Expense',
        GOVERNMENT_AND_NON_PROFIT: 'Government & Professional Services',
        HOME_IMPROVEMENT: 'Housing & Utilities',
        LOAN_PAYMENTS: 'Installment Payments',
        MEDICAL: 'Health & Wellness',
        PERSONAL_CARE: 'Personal Care',
        RENT_AND_UTILITIES: 'Housing & Utilities',
        TRANSPORTATION: 'Transportation',
        TRAVEL: 'Travel',
        TRANSFER_OUT: 'Personal Transfers',
    };
    return { Category: 'Expense', Label: labels[primary] || 'Other Expense' };
}

function plaidTimestamp(transaction = {}) {
    const dateTime = transaction.authorized_datetime || transaction.datetime;
    if (dateTime && Number.isFinite(new Date(dateTime).getTime())) return new Date(dateTime).toISOString();
    const date = transaction.authorized_date || transaction.date;
    return /^\d{4}-\d{2}-\d{2}$/.test(date || '')
        ? `${date}T12:00:00.000Z`
        : new Date().toISOString();
}

function toAppTransaction(transaction, account, institutionName) {
    const amountMinor = Math.abs(Math.round(Number(transaction.amount) * 100));
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
    const classification = classifyPlaidTransaction(transaction);
    return {
        AmountMinor: amountMinor,
        Amount: amountMinor / 100,
        Currency: String(transaction.iso_currency_code || transaction.unofficial_currency_code || 'CAD').toUpperCase(),
        ...classification,
        Reason: String(transaction.merchant_name || transaction.name || 'Bank transaction').slice(0, 500),
        Timestamp: plaidTimestamp(transaction),
        Type: accountTypeLabel(account),
        Account: account?.mask || account?.name || null,
        BankName: institutionName || null,
        ReferenceNumber: null,
        AccountFlow: Number(transaction.amount) > 0 ? 'OUT' : 'IN',
    };
}

function normalizedWords(value) {
    return new Set(String(value || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/).filter((word) => word.length > 2));
}

function reasonOverlap(left, right) {
    const a = normalizedWords(left);
    const b = normalizedWords(right);
    if (!a.size || !b.size) return false;
    return [...a].some((word) => b.has(word));
}

function lastFour(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : null;
}

async function findFallbackMatch(userId, appTransaction) {
    const db = await dbService.getDb();
    const timestamp = new Date(appTransaction.Timestamp);
    const from = new Date(timestamp.getTime() - 2 * 86400000).toISOString();
    const to = new Date(timestamp.getTime() + 2 * 86400000).toISOString();
    const candidates = await db.all(
        `SELECT t.* FROM transactions t
         WHERE t.userId = ? AND t.AmountMinor = ? AND t.Timestamp BETWEEN ? AND ?
           AND NOT EXISTS (
               SELECT 1 FROM transaction_sources s
               WHERE s.transactionId = t.id AND s.provider = 'plaid'
           )`,
        [userId, appTransaction.AmountMinor, from, to]
    );
    const targetAccount = lastFour(appTransaction.Account);
    return candidates.map((candidate) => {
        const sameDay = String(candidate.Timestamp).slice(0, 10) === appTransaction.Timestamp.slice(0, 10);
        const accountMatch = targetAccount && lastFour(candidate.Account) === targetAccount;
        const reasonMatch = reasonOverlap(candidate.Reason, appTransaction.Reason);
        const categoryMatch = candidate.Category === appTransaction.Category;
        const score = (sameDay ? 3 : 0) + (accountMatch ? 4 : 0) +
            (reasonMatch ? 3 : 0) + (categoryMatch ? 1 : 0) + (candidate.SourceEmailKey ? 1 : 0);
        return { candidate, score, accountMatch, reasonMatch };
    }).filter(({ score, accountMatch, reasonMatch }) => score >= 6 && (accountMatch || reasonMatch))
        .sort((a, b) => b.score - a.score)[0]?.candidate || null;
}

async function upsertPlaidAccounts(userId, item, accounts = []) {
    const db = await dbService.getDb();
    const accountMap = new Map();
    for (const account of accounts) {
        const accountRef = account.mask || account.name || account.account_id;
        const resolution = await dbService.ensureTransactionAccount(userId, {
            Account: accountRef,
            BankName: item.institutionName,
            Type: accountTypeLabel(account),
            Currency: account.balances?.iso_currency_code || 'CAD',
            Timestamp: new Date().toISOString(),
        });
        const now = new Date().toISOString();
        await db.run(
            `INSERT INTO plaid_accounts
                (plaidAccountId, itemId, userId, appAccountId, name, officialName, mask, type, subtype, currency, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(plaidAccountId) DO UPDATE SET
                appAccountId = COALESCE(excluded.appAccountId, plaid_accounts.appAccountId),
                name = excluded.name, officialName = excluded.officialName, mask = excluded.mask,
                type = excluded.type, subtype = excluded.subtype, currency = excluded.currency,
                updatedAt = excluded.updatedAt`,
            [account.account_id, item.itemId, userId, resolution.account?.id || null,
                account.name || null, account.official_name || null, account.mask || null,
                account.type || null, account.subtype || null,
                account.balances?.iso_currency_code || account.balances?.unofficial_currency_code || null, now]
        );
        accountMap.set(account.account_id, { ...account, appAccountId: resolution.account?.id || null });
    }
    return accountMap;
}

function plaidBalanceMinor(account = {}) {
    const rawCurrent = account.balances?.current;
    if (rawCurrent === null || rawCurrent === undefined || rawCurrent === '') return null;
    const current = Number(rawCurrent);
    return Number.isFinite(current)
        ? Math.sign(current) * Math.round(Math.abs(current) * 100)
        : null;
}

async function applyAuthoritativeBalances(userId, accountMap) {
    const db = await dbService.getDb();
    const now = new Date().toISOString();
    let updated = 0;
    for (const account of accountMap.values()) {
        const totalBalanceMinor = plaidBalanceMinor(account);
        if (!account.appAccountId || totalBalanceMinor === null) continue;
        const holdings = account.type === 'investment'
            ? await db.get(
                `SELECT COALESCE(SUM(ROUND(quantity * COALESCE(priceMicros, priceMinor * 10000) / 10000.0)), 0)
                    AS valueMinor
                 FROM investment_holdings WHERE accountId = ? AND userId = ?`,
                [account.appAccountId, userId]
            )
            : null;
        const balanceMinor = account.type === 'investment'
            ? totalBalanceMinor - Number(holdings?.valueMinor || 0)
            : totalBalanceMinor;
        const currency = String(
            account.balances?.iso_currency_code || account.balances?.unofficial_currency_code || 'CAD'
        ).toUpperCase();
        const result = await db.run(
            `UPDATE investment_accounts
             SET cashMinor = ?, currency = ?, updatedAt = ?
             WHERE id = ? AND userId = ?`,
            [balanceMinor, currency, now, account.appAccountId, userId]
        );
        updated += result.changes;
    }
    return updated;
}

async function linkSource(userId, itemId, externalId, transactionId, ownsTransaction) {
    const db = await dbService.getDb();
    const now = new Date().toISOString();
    await db.run(
        `INSERT INTO transaction_sources
            (provider, externalId, userId, transactionId, itemId, ownsTransaction, createdAt, updatedAt)
         VALUES ('plaid', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, externalId) DO UPDATE SET
            transactionId = excluded.transactionId, itemId = excluded.itemId,
            ownsTransaction = excluded.ownsTransaction, updatedAt = excluded.updatedAt`,
        [externalId, userId, transactionId, itemId, ownsTransaction ? 1 : 0, now, now]
    );
}

async function importAddedTransaction(userId, item, transaction, accountMap) {
    const db = await dbService.getDb();
    const existingSource = await db.get(
        `SELECT * FROM transaction_sources WHERE provider = 'plaid' AND externalId = ? AND userId = ?`,
        [transaction.transaction_id, userId]
    );
    if (existingSource) return { status: 'known', transactionId: existingSource.transactionId };

    const account = accountMap.get(transaction.account_id) || {};
    const appTransaction = toAppTransaction(transaction, account, item.institutionName);
    if (!appTransaction) return { status: 'ignored' };

    let replacement = null;
    if (transaction.pending_transaction_id) {
        replacement = await db.get(
            `SELECT s.*, t.SourceEmailKey FROM transaction_sources s
             JOIN transactions t ON t.id = s.transactionId AND t.userId = s.userId
             WHERE s.provider = 'plaid' AND s.externalId = ? AND s.userId = ?`,
            [transaction.pending_transaction_id, userId]
        );
    }

    const match = replacement
        ? await dbService.getTransactionById(replacement.transactionId, userId)
        : await findFallbackMatch(userId, appTransaction);
    if (match) {
        if (replacement?.ownsTransaction && !match.SourceEmailKey) {
            await dbService.updateTransactionForUser(match.id, userId, appTransaction);
        }
        await linkSource(userId, item.itemId, transaction.transaction_id, match.id, Boolean(replacement?.ownsTransaction));
        if (replacement) {
            await db.run(
                `DELETE FROM transaction_sources WHERE provider = 'plaid' AND externalId = ? AND userId = ?`,
                [transaction.pending_transaction_id, userId]
            );
        }
        return { status: replacement ? 'replaced_pending' : 'matched_email', transactionId: match.id };
    }

    const transactionId = await dbService.addTransaction({ ...appTransaction, userId });
    await linkSource(userId, item.itemId, transaction.transaction_id, transactionId, true);
    if (account.appAccountId) {
        await dbService.syncTransactionAccountBalance(userId, transactionId, {
            accountId: account.appAccountId,
            confidence: 'HIGH',
        });
    }
    await dbService.detectAndMarkRecurring(userId, transactionId).catch(() => {});
    return { status: 'imported', transactionId };
}

async function applyModifiedTransaction(userId, item, transaction, accountMap) {
    const db = await dbService.getDb();
    const source = await db.get(
        `SELECT s.*, t.SourceEmailKey FROM transaction_sources s
         JOIN transactions t ON t.id = s.transactionId AND t.userId = s.userId
         WHERE s.provider = 'plaid' AND s.externalId = ? AND s.userId = ?`,
        [transaction.transaction_id, userId]
    );
    if (!source) return importAddedTransaction(userId, item, transaction, accountMap);
    if (!source.ownsTransaction || source.SourceEmailKey) return { status: 'linked_source_preserved' };
    const account = accountMap.get(transaction.account_id) || {};
    const appTransaction = toAppTransaction(transaction, account, item.institutionName);
    if (!appTransaction) return { status: 'ignored' };
    await dbService.updateTransactionForUser(source.transactionId, userId, appTransaction);
    if (account.appAccountId) {
        await dbService.syncTransactionAccountBalance(userId, source.transactionId, {
            accountId: account.appAccountId, confidence: 'HIGH',
        });
    }
    return { status: 'updated' };
}

async function applyRemovedTransaction(userId, removed) {
    const db = await dbService.getDb();
    const source = await db.get(
        `SELECT s.*, t.SourceEmailKey FROM transaction_sources s
         JOIN transactions t ON t.id = s.transactionId AND t.userId = s.userId
         WHERE s.provider = 'plaid' AND s.externalId = ? AND s.userId = ?`,
        [removed.transaction_id, userId]
    );
    if (!source) return;
    await db.run(
        `DELETE FROM transaction_sources WHERE provider = 'plaid' AND externalId = ? AND userId = ?`,
        [removed.transaction_id, userId]
    );
    const remaining = await db.get('SELECT COUNT(*) AS count FROM transaction_sources WHERE transactionId = ?', [source.transactionId]);
    if (source.ownsTransaction && !source.SourceEmailKey && !remaining.count) {
        await dbService.deleteTransaction(source.transactionId, userId);
    }
}

async function fetchSyncPages(accessToken, startingCursor) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        let cursor = startingCursor || undefined;
        const changes = { added: [], modified: [], removed: [], accounts: new Map(), nextCursor: startingCursor || null };
        try {
            do {
                const page = await plaidRequest('/transactions/sync', {
                    access_token: accessToken,
                    ...(cursor ? { cursor } : {}),
                    options: { include_personal_finance_category: true },
                });
                changes.added.push(...(page.added || []));
                changes.modified.push(...(page.modified || []));
                changes.removed.push(...(page.removed || []));
                (page.accounts || []).forEach((account) => changes.accounts.set(account.account_id, account));
                cursor = page.next_cursor;
                changes.nextCursor = page.next_cursor;
                if (!page.has_more) return changes;
            } while (true);
        } catch (error) {
            if (error.code !== 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' || attempt === 2) throw error;
        }
    }
    throw new Error('Unable to complete Plaid pagination');
}

async function performItemSync(item) {
    const db = await dbService.getDb();
    try {
        const accessToken = decryptAccessToken(item.accessTokenEncrypted);
        const [changes, accountResponse] = await Promise.all([
            fetchSyncPages(accessToken, item.cursor),
            plaidRequest('/accounts/get', { access_token: accessToken }),
        ]);
        const accounts = accountResponse.accounts?.length
            ? accountResponse.accounts
            : [...changes.accounts.values()];
        const accountMap = await upsertPlaidAccounts(item.userId, item, accounts);
        const totals = { imported: 0, matched: 0, updated: 0, removed: changes.removed.length };
        for (const transaction of changes.added) {
            const result = await importAddedTransaction(item.userId, item, transaction, accountMap);
            if (result.status === 'imported') totals.imported += 1;
            if (result.status === 'matched_email' || result.status === 'replaced_pending') totals.matched += 1;
        }
        for (const transaction of changes.modified) {
            const result = await applyModifiedTransaction(item.userId, item, transaction, accountMap);
            if (result.status === 'updated') totals.updated += 1;
        }
        for (const transaction of changes.removed) await applyRemovedTransaction(item.userId, transaction);
        // Transaction events preserve edit/delete behavior, but a partial history
        // cannot reconstruct an account's opening balance. Plaid's current balance
        // is the authoritative anchor after every completed sync.
        totals.balancesUpdated = await applyAuthoritativeBalances(item.userId, accountMap);
        const now = new Date().toISOString();
        await db.run(
            `UPDATE plaid_items SET cursor = ?, status = 'active', lastSyncedAt = ?,
                lastError = NULL, updatedAt = ? WHERE itemId = ? AND userId = ?`,
            [changes.nextCursor, now, now, item.itemId, item.userId]
        );
        return totals;
    } catch (error) {
        const status = error.code === 'ITEM_LOGIN_REQUIRED' ? 'login_required' : 'error';
        await db.run(
            `UPDATE plaid_items SET status = ?, lastError = ?, updatedAt = ? WHERE itemId = ? AND userId = ?`,
            [status, String(error.message || 'Plaid sync failed').slice(0, 500), new Date().toISOString(), item.itemId, item.userId]
        );
        throw error;
    }
}

async function syncItem(item) {
    if (syncPromises.has(item.itemId)) return syncPromises.get(item.itemId);
    const promise = performItemSync(item).finally(() => syncPromises.delete(item.itemId));
    syncPromises.set(item.itemId, promise);
    return promise;
}

async function syncUserItems(userId, { force = false } = {}) {
    if (!isConfigured()) return { configured: false, results: [] };
    const db = await dbService.getDb();
    const items = await db.all('SELECT * FROM plaid_items WHERE userId = ?', [userId]);
    const cutoff = Date.now() - USER_SYNC_COOLDOWN_MS;
    const eligible = force ? items : items.filter((item) => !item.lastSyncedAt || new Date(item.lastSyncedAt).getTime() < cutoff);
    const results = [];
    for (const item of eligible) {
        try {
            results.push({ itemId: item.itemId, ok: true, ...(await syncItem(item)) });
        } catch (error) {
            console.error(`[Plaid] Sync failed for item ${item.itemId}:`, error.message);
            results.push({ itemId: item.itemId, ok: false, error: error.message });
        }
    }
    return { configured: true, results };
}

async function getStatus(userId) {
    const config = getConfig();
    if (!isConfigured()) return { configured: false, environment: config.environment, items: [] };
    const db = await dbService.getDb();
    const items = await db.all(
        `SELECT i.itemId, i.institutionId, i.institutionName, i.status, i.lastSyncedAt,
                i.lastError, i.createdAt, COUNT(a.plaidAccountId) AS accountCount
         FROM plaid_items i LEFT JOIN plaid_accounts a ON a.itemId = i.itemId
         WHERE i.userId = ? GROUP BY i.itemId ORDER BY i.createdAt DESC`,
        [userId]
    );
    return { configured: true, environment: config.environment, items };
}

async function disconnectItem(userId, itemId) {
    const db = await dbService.getDb();
    const item = await db.get('SELECT * FROM plaid_items WHERE itemId = ? AND userId = ?', [itemId, userId]);
    if (!item) return false;
    try {
        await plaidRequest('/item/remove', { access_token: decryptAccessToken(item.accessTokenEncrypted) });
    } catch (error) {
        console.warn(`[Plaid] Remote item removal failed; removing local credentials: ${error.message}`);
    }
    await db.run('BEGIN IMMEDIATE');
    try {
        await db.run(`DELETE FROM transaction_sources WHERE provider = 'plaid' AND itemId = ? AND userId = ?`, [itemId, userId]);
        await db.run('DELETE FROM plaid_accounts WHERE itemId = ? AND userId = ?', [itemId, userId]);
        await db.run('DELETE FROM plaid_items WHERE itemId = ? AND userId = ?', [itemId, userId]);
        await db.run('COMMIT');
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
    return true;
}

module.exports = {
    isConfigured,
    createLinkToken,
    exchangePublicToken,
    syncUserItems,
    getStatus,
    disconnectItem,
    classifyPlaidTransaction,
    toAppTransaction,
    plaidBalanceMinor,
    encryptAccessToken,
    decryptAccessToken,
};
