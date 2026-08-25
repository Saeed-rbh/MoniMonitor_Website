const crypto = require('crypto');
const dbService = require('../database/dbService');
const { reconcileHistoricalInternalTransfers } = require('../database/historicalTransferReconciliation');
const { findTransactionMatch, reasonOverlap } = require('./transactionDeduplication');
const { isExplicitSelfTransferDescription } = require('./selfTransfer');

const PLAID_ENVIRONMENTS = new Set(['sandbox', 'development', 'production']);
const syncPromises = new Map();
const webhookVerificationKeys = new Map();
let reconciliationTimer = null;
let reconciliationStartupTimer = null;
let reconciliationPromise = null;
let webhookWorkerTimer = null;
let webhookProcessingPromise = null;
let marketPriceTimer = null;
let marketPriceRefreshPromise = null;
const USER_SYNC_COOLDOWN_MS = 10 * 60 * 1000;
const INVESTMENT_HOLDINGS_REFRESH_MS = 10 * 60 * 1000;
const WEBHOOK_MAX_AGE_SECONDS = 5 * 60;
const WEBHOOK_KEY_CACHE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_RECONCILIATION_HOURS = 24;
const RECONCILIATION_STARTUP_DELAY_MS = 15 * 1000;
const WEBHOOK_WORKER_INTERVAL_MS = 60 * 1000;
const WEBHOOK_PROCESSING_STALE_MS = 5 * 60 * 1000;
const WEBHOOK_MAX_RETRY_MS = 6 * 60 * 60 * 1000;
const MARKET_PRICE_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const MARKET_QUOTES_TIMEZONE = process.env.MARKET_QUOTES_TIMEZONE || 'America/Toronto';
const MARKET_QUOTES_START_MINUTE = 9 * 60;
const MARKET_QUOTES_END_MINUTE = 14 * 60;

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

const decodeJwtPart = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

async function getWebhookVerificationKey(keyId) {
    const cached = webhookVerificationKeys.get(keyId);
    if (cached && cached.cachedAt > Date.now() - WEBHOOK_KEY_CACHE_MS) return cached.key;
    const result = await plaidRequest('/webhook_verification_key/get', { key_id: keyId });
    if (!result.key) throw new Error('Plaid webhook verification key is unavailable');
    webhookVerificationKeys.set(keyId, { key: result.key, cachedAt: Date.now() });
    return result.key;
}

async function verifyPlaidWebhook(rawBody, signedJwt, keyProvider = getWebhookVerificationKey) {
    if (!Buffer.isBuffer(rawBody) || !rawBody.length || typeof signedJwt !== 'string') return false;
    const parts = signedJwt.split('.');
    if (parts.length !== 3) return false;
    try {
        const header = decodeJwtPart(parts[0]);
        const payload = decodeJwtPart(parts[1]);
        if (header.alg !== 'ES256' || typeof header.kid !== 'string' || !header.kid) return false;
        const issuedAt = Number(payload.iat);
        const age = Math.floor(Date.now() / 1000) - issuedAt;
        if (!Number.isFinite(issuedAt) || age < -60 || age > WEBHOOK_MAX_AGE_SECONDS) return false;

        const jwk = await keyProvider(header.kid);
        if (!jwk || jwk.alg !== 'ES256' || jwk.kid !== header.kid || jwk.kty !== 'EC') return false;
        const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
        const validSignature = crypto.verify(
            'sha256', Buffer.from(`${parts[0]}.${parts[1]}`),
            { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url')
        );
        if (!validSignature) return false;

        const expectedHash = Buffer.from(String(payload.request_body_sha256 || ''), 'hex');
        const actualHash = crypto.createHash('sha256').update(rawBody).digest();
        return expectedHash.length === actualHash.length && crypto.timingSafeEqual(expectedHash, actualHash);
    } catch {
        return false;
    }
}

async function createLinkToken(userId, itemId = null) {
    const config = requireConfig();
    const request = {
        user: { client_user_id: String(userId) },
        client_name: 'MoniMonitor',
        country_codes: config.countries,
        language: 'en',
    };
    if (itemId) {
        const db = await dbService.getDb();
        const item = await db.get(
            'SELECT accessTokenEncrypted FROM plaid_items WHERE itemId = ? AND userId = ?',
            [itemId, userId]
        );
        if (!item) {
            const error = new Error('Bank connection not found');
            error.statusCode = 404;
            throw error;
        }
        request.access_token = decryptAccessToken(item.accessTokenEncrypted);
        request.additional_consented_products = ['investments'];
    } else {
        request.products = ['transactions'];
        request.transactions = { days_requested: 90 };
        request.additional_consented_products = ['investments'];
    }
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

const genericPlaidDescriptions = new Set([
    'transfer', 'transfer in', 'transfer out', 'deposit', 'withdrawal',
    'bank deposit', 'bank withdrawal', 'e-transfer', 'electronic transfer',
]);

function firstNonEmpty(...values) {
    return values.find((value) => value !== null && value !== undefined && String(value).trim()) || null;
}

function plaidCounterpartyName(transaction = {}) {
    return transaction.counterparties?.find((counterparty) => counterparty?.name)?.name || null;
}

function plaidTransactionReason(transaction = {}, account = {}, institutionName = null) {
    const merchantName = firstNonEmpty(transaction.merchant_name);
    const counterparty = firstNonEmpty(plaidCounterpartyName(transaction));
    const paymentParty = firstNonEmpty(
        transaction.payment_meta?.payee,
        transaction.payment_meta?.payer,
        transaction.payment_meta?.by_order_of
    );
    const originalDescription = firstNonEmpty(transaction.original_description);
    const primary = firstNonEmpty(merchantName, counterparty, paymentParty, transaction.name);
    const isGeneric = genericPlaidDescriptions.has(String(primary || '').trim().toLowerCase());
    const specificParty = firstNonEmpty(counterparty, paymentParty);
    const accountMask = String(account.mask || '').replace(/[^a-z0-9]/gi, '');
    const accountHint = accountMask ? `••••${accountMask.slice(-4)}` : null;
    const sourceContext = [institutionName, account.name, accountHint]
        .map((value) => String(value || '').trim())
        .filter((value, index, values) => value && values.indexOf(value) === index)
        .join(' ');
    const contextualReason = isGeneric && primary && sourceContext ? `${primary} - ${sourceContext}` : null;
    return String(firstNonEmpty(
        isGeneric ? originalDescription : null,
        isGeneric ? specificParty : null,
        contextualReason,
        primary,
        originalDescription,
        'Bank transaction'
    )).slice(0, 500);
}

function plaidReferenceNumber(transaction = {}) {
    return firstNonEmpty(transaction.payment_meta?.reference_number, transaction.reference_number);
}

function classifyPlaidTransaction(transaction = {}, { ownerUsername = null } = {}) {
    const primary = transaction.personal_finance_category?.primary || '';
    const detailed = transaction.personal_finance_category?.detailed || '';
    const outflow = Number(transaction.amount) > 0;
    const transferReason = plaidTransactionReason(transaction);
    if (isExplicitSelfTransferDescription(transferReason, ownerUsername)) {
        return { Category: 'Internal', Label: 'Internal Transfer' };
    }
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

function toAppTransaction(transaction, account, institutionName, options = {}) {
    const amountMinor = Math.abs(Math.round(Number(transaction.amount) * 100));
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
    const classification = classifyPlaidTransaction(transaction, options);
    return {
        AmountMinor: amountMinor,
        Amount: amountMinor / 100,
        Currency: String(transaction.iso_currency_code || transaction.unofficial_currency_code || 'CAD').toUpperCase(),
        ...classification,
        Reason: plaidTransactionReason(transaction, account, institutionName),
        Timestamp: plaidTimestamp(transaction),
        Type: accountTypeLabel(account),
        Account: account?.mask || account?.name || null,
        BankName: institutionName || null,
        ReferenceNumber: plaidReferenceNumber(transaction),
        AccountFlow: Number(transaction.amount) > 0 ? 'OUT' : 'IN',
    };
}

function preserveLinkedInternalTransfer(existing, updates) {
    const reference = String(existing?.ReferenceNumber || '').trim();
    const isLinkedInternal = existing?.Category === 'Internal' &&
        existing?.Label === 'Internal Transfer' && /^XFER-/i.test(reference);
    if (!isLinkedInternal) return updates;
    return {
        ...updates,
        Category: existing.Category,
        Label: existing.Label,
        Reason: existing.Reason,
        ReferenceNumber: existing.ReferenceNumber,
    };
}

async function findFallbackMatch(userId, appTransaction) {
    const db = await dbService.getDb();
    return findTransactionMatch(db, userId, appTransaction, { mode: 'bank' });
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

function plaidAvailableBalanceMinor(account = {}) {
    const rawAvailable = account.balances?.available;
    if (rawAvailable === null || rawAvailable === undefined || rawAvailable === '') return null;
    const available = Number(rawAvailable);
    return Number.isFinite(available)
        ? Math.sign(available) * Math.round(Math.abs(available) * 100)
        : null;
}

async function applyAuthoritativeBalances(userId, accountMap) {
    const db = await dbService.getDb();
    const now = new Date().toISOString();
    let updated = 0;
    for (const account of accountMap.values()) {
        const totalBalanceMinor = plaidBalanceMinor(account);
        // An investment account's current balance is its total value, not cash.
        // Without the Investments product, subtracting locally reconstructed
        // positions mixes two different snapshots and corrupts the cash value.
        if (!account.appAccountId || totalBalanceMinor === null || account.type === 'investment') continue;
        const balanceMinor = totalBalanceMinor;
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

const toMicros = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number * 1000000) : 0;
};

const yahooSymbol = (ticker, currency) => {
    const normalized = String(ticker || '').trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,20}$/.test(normalized)) return null;
    return currency === 'CAD' && !normalized.includes('.') ? `${normalized}.TO` : normalized;
};

async function fetchYahooMarketPrice(ticker, currency = 'CAD', fetchImpl = fetch) {
    const normalizedCurrency = String(currency || 'CAD').trim().toUpperCase();
    const symbol = yahooSymbol(ticker, normalizedCurrency);
    if (!symbol) return null;
    try {
        const response = await fetchImpl(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`,
            { headers: { 'User-Agent': 'MoniMonitor/1.0' }, signal: AbortSignal.timeout(5000) }
        );
        if (!response.ok) return null;
        const result = (await response.json())?.chart?.result?.[0];
        const price = Number(result?.meta?.regularMarketPrice);
        if (!(price > 0)) return null;
        const marketTime = Number(result?.meta?.regularMarketTime);
        return {
            price,
            updatedAt: Number.isFinite(marketTime)
                ? new Date(marketTime * 1000).toISOString()
                : new Date().toISOString(),
        };
    } catch {
        return null;
    }
}

async function fetchCurrentMarketPrices(snapshot = {}, fetchImpl = fetch) {
    if (process.env.MARKET_QUOTES_ENABLED === 'false') return new Map();
    const securities = new Map((snapshot.securities || []).map((security) => [security.security_id, security]));
    const targets = (snapshot.holdings || []).filter((holding) => {
        const institutionPrice = Number(holding.institution_price);
        const institutionValue = Number(holding.institution_value);
        return !(institutionPrice > 0) && !(institutionValue > 0) && Number(holding.quantity) > 0;
    });
    const prices = new Map();
    await Promise.all(targets.map(async (holding) => {
        const security = securities.get(holding.security_id) || {};
        const currency = String(
            holding.iso_currency_code || holding.unofficial_currency_code ||
            security.iso_currency_code || security.unofficial_currency_code || ''
        ).toUpperCase();
        const quote = await fetchYahooMarketPrice(security.ticker_symbol, currency, fetchImpl);
        if (quote) prices.set(holding.security_id, quote);
    }));
    return prices;
}

function zonedMarketClock(value = new Date(), timeZone = MARKET_QUOTES_TIMEZONE) {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(value);
        const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
        return {
            weekday: values.weekday,
            hour: Number(values.hour),
            minute: Number(values.minute),
        };
    } catch {
        return null;
    }
}

function isMarketPriceRefreshWindow(value = new Date(), timeZone = MARKET_QUOTES_TIMEZONE) {
    const clock = zonedMarketClock(value, timeZone);
    if (!clock || ['Sat', 'Sun'].includes(clock.weekday)) return false;
    const minute = clock.hour * 60 + clock.minute;
    return minute >= MARKET_QUOTES_START_MINUTE && minute <= MARKET_QUOTES_END_MINUTE;
}

async function refreshStoredMarketPrices({ fetchImpl = fetch } = {}) {
    if (process.env.MARKET_QUOTES_ENABLED === 'false') {
        return { enabled: false, holdings: 0, updated: 0, unavailable: 0 };
    }
    const db = await dbService.getDb();
    const holdings = await db.all(
        `SELECT h.id, h.userId, h.symbol, h.quantity,
                COALESCE(NULLIF(h.currency, ''), NULLIF(a.currency, ''), 'CAD') AS currency
         FROM investment_holdings h
         JOIN investment_accounts a ON a.id = h.accountId AND a.userId = h.userId
         WHERE h.quantity > 0
         ORDER BY h.userId, h.id`
    );
    const quoteKeys = new Map();
    for (const holding of holdings) {
        const currency = String(holding.currency || 'CAD').toUpperCase();
        const symbol = yahooSymbol(holding.symbol, currency);
        if (symbol) quoteKeys.set(`${holding.symbol}|${currency}`, { ticker: holding.symbol, currency });
    }
    const quotes = new Map();
    await Promise.all([...quoteKeys.entries()].map(async ([key, target]) => {
        const quote = await fetchYahooMarketPrice(target.ticker, target.currency, fetchImpl);
        if (quote) quotes.set(key, quote);
    }));

    let updated = 0;
    let unavailable = 0;
    for (const holding of holdings) {
        const currency = String(holding.currency || 'CAD').toUpperCase();
        const quote = quotes.get(`${holding.symbol}|${currency}`);
        if (!quote) {
            unavailable += 1;
            continue;
        }
        const priceMicros = toMicros(quote.price);
        const result = await db.run(
            `UPDATE investment_holdings
             SET priceMinor = ?, priceMicros = ?, updatedAt = ?
             WHERE id = ? AND userId = ?`,
            [Math.round(priceMicros / 10000), priceMicros, quote.updatedAt, holding.id, holding.userId]
        );
        updated += result.changes;
    }
    return { enabled: true, holdings: holdings.length, updated, unavailable };
}

function nextMarketPriceRefreshDelayMs(value = Date.now()) {
    const remainder = Number(value) % MARKET_PRICE_REFRESH_INTERVAL_MS;
    return remainder === 0
        ? MARKET_PRICE_REFRESH_INTERVAL_MS
        : MARKET_PRICE_REFRESH_INTERVAL_MS - remainder;
}

function startAutomaticMarketPriceRefresh() {
    if (marketPriceTimer) return marketPriceTimer;
    const run = () => {
        if (!isMarketPriceRefreshWindow()) return Promise.resolve({ skipped: 'outside_market_window' });
        if (marketPriceRefreshPromise) return marketPriceRefreshPromise;
        marketPriceRefreshPromise = refreshStoredMarketPrices()
            .then((summary) => {
                console.log(`[Market] CAD price refresh updated ${summary.updated}/${summary.holdings} holding(s).`);
                return summary;
            })
            .catch((error) => {
                console.error('[Market] CAD price refresh failed:', error.message);
                return { enabled: true, updated: 0, error: error.message };
            })
            .finally(() => { marketPriceRefreshPromise = null; });
        return marketPriceRefreshPromise;
    };
    const schedule = () => {
        marketPriceTimer = setTimeout(() => {
            marketPriceTimer = null;
            run().finally(schedule);
        }, nextMarketPriceRefreshDelayMs());
        marketPriceTimer.unref?.();
    };
    if (isMarketPriceRefreshWindow()) run();
    schedule();
    return marketPriceTimer;
}

function normalizeInvestmentSnapshot(snapshot = {}, marketPrices = new Map()) {
    const securities = new Map((snapshot.securities || []).map((security) => [security.security_id, security]));
    const byAccount = new Map();
    for (const holding of snapshot.holdings || []) {
        const security = securities.get(holding.security_id) || {};
        const entry = byAccount.get(holding.account_id) || { cashMinor: 0, hasExplicitCash: false, holdings: [] };
        const quantity = Number(holding.quantity) || 0;
        const institutionPrice = Number(holding.institution_price);
        const institutionValue = Number(holding.institution_value);
        const valuePrice = quantity > 0 && Number.isFinite(institutionValue) && institutionValue > 0
            ? institutionValue / quantity
            : 0;
        const marketQuote = marketPrices.get(holding.security_id);
        const marketPrice = Number(marketQuote?.price);
        const closePrice = Number(security.close_price);
        const effectivePrice = Number.isFinite(institutionPrice) && institutionPrice > 0
            ? institutionPrice
            : valuePrice > 0
                ? valuePrice
                : Number.isFinite(marketPrice) && marketPrice > 0
                    ? marketPrice
                    : Number.isFinite(closePrice) && closePrice > 0
                        ? closePrice
                        : 0;
        const effectiveValue = Number.isFinite(institutionValue) && institutionValue > 0
            ? institutionValue
            : quantity * effectivePrice;
        const valueMinor = Math.round(effectiveValue * 100);
        if (security.is_cash_equivalent || security.type === 'cash') {
            entry.cashMinor += valueMinor;
            entry.hasExplicitCash = true;
        } else {
            const totalCost = Number(holding.cost_basis);
            const averageCost = quantity > 0 && Number.isFinite(totalCost) ? totalCost / quantity : 0;
            entry.holdings.push({
                symbol: String(security.ticker_symbol || security.name || holding.security_id || 'Holding').trim().slice(0, 40),
                name: security.name ? String(security.name).trim().slice(0, 160) : null,
                quantity,
                averageCostMicros: toMicros(averageCost),
                priceMicros: toMicros(effectivePrice),
                currency: String(holding.iso_currency_code || holding.unofficial_currency_code || 'CAD').toUpperCase(),
                updatedAt: holding.institution_price_datetime || holding.institution_price_as_of ||
                    marketQuote?.updatedAt ||
                    security.update_datetime || security.close_price_as_of || new Date().toISOString(),
                valueMinor,
            });
        }
        byAccount.set(holding.account_id, entry);
    }
    for (const account of snapshot.accounts || []) {
        const entry = byAccount.get(account.account_id) || { cashMinor: 0, hasExplicitCash: false, holdings: [] };
        const availableMinor = plaidAvailableBalanceMinor(account);
        const totalMinor = plaidBalanceMinor(account);
        const investedMinor = entry.holdings.reduce((sum, holding) => sum + holding.valueMinor, 0);
        // For investment accounts Plaid defines `available` as cash available
        // to withdraw, while `current` is the total value of all assets. Use
        // the institution-reported cash value whenever it is present, then
        // fall back to an explicit cash holding or the derived remainder.
        if (availableMinor !== null) entry.cashMinor = Math.max(0, availableMinor);
        else if (!entry.hasExplicitCash && totalMinor !== null) {
            entry.cashMinor = Math.max(0, totalMinor - investedMinor);
        }
        byAccount.set(account.account_id, entry);
    }
    return byAccount;
}

async function applyInvestmentSnapshot(userId, accountMap, snapshot) {
    const db = await dbService.getDb();
    const marketPrices = await fetchCurrentMarketPrices(snapshot);
    const normalized = normalizeInvestmentSnapshot(snapshot, marketPrices);
    let accountsUpdated = 0;
    await db.run('BEGIN IMMEDIATE');
    try {
        for (const [plaidAccountId, entry] of normalized) {
            const account = accountMap.get(plaidAccountId);
            if (!account?.appAccountId || account.type !== 'investment') continue;
            await db.run('DELETE FROM investment_holdings WHERE accountId = ? AND userId = ?', [account.appAccountId, userId]);
            for (const holding of entry.holdings) {
                await db.run(
                    `INSERT INTO investment_holdings
                        (userId, accountId, symbol, name, quantity, averageCostMinor, averageCostMicros,
                         priceMinor, priceMicros, currency, updatedAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [userId, account.appAccountId, holding.symbol, holding.name, holding.quantity,
                        Math.round(holding.averageCostMicros / 10000), holding.averageCostMicros,
                        Math.round(holding.priceMicros / 10000), holding.priceMicros,
                        holding.currency, holding.updatedAt]
                );
            }
            const sourceAccount = (snapshot.accounts || []).find((item) => item.account_id === plaidAccountId);
            const currency = String(sourceAccount?.balances?.iso_currency_code || sourceAccount?.balances?.unofficial_currency_code || account.currency || 'CAD').toUpperCase();
            await db.run(
                'UPDATE investment_accounts SET cashMinor = ?, currency = ?, updatedAt = ? WHERE id = ? AND userId = ?',
                [entry.cashMinor, currency, new Date().toISOString(), account.appAccountId, userId]
            );
            accountsUpdated += 1;
        }
        await db.run('COMMIT');
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
    return accountsUpdated;
}

async function linkSource(userId, itemId, externalId, transactionId, ownsTransaction, provider = 'plaid', rawPayload = null, contextPayload = null) {
    await dbService.upsertTransactionSource({
        userId, provider, externalId, transactionId, itemId, ownsTransaction,
        rawPayload, contextPayload,
    });
}

async function importAddedTransaction(userId, item, transaction, accountMap, ownerUsername = null) {
    const db = await dbService.getDb();
    const existingSource = await db.get(
        `SELECT * FROM transaction_sources WHERE provider = 'plaid' AND externalId = ? AND userId = ?`,
        [transaction.transaction_id, userId]
    );
    const account = accountMap.get(transaction.account_id) || {};
    const sourceContext = { account, institutionName: item.institutionName };
    if (existingSource) {
        await linkSource(
            userId, item.itemId, transaction.transaction_id, existingSource.transactionId,
            Boolean(existingSource.ownsTransaction), 'plaid', transaction, sourceContext
        );
        const existingTransaction = await dbService.getTransactionById(existingSource.transactionId, userId);
        const appTransaction = toAppTransaction(transaction, account, item.institutionName, { ownerUsername });
        if (existingTransaction && appTransaction && existingSource.ownsTransaction && !existingTransaction.SourceEmailKey) {
            await dbService.updateTransactionForUser(
                existingSource.transactionId, userId,
                preserveLinkedInternalTransfer(existingTransaction, appTransaction)
            );
            return { status: 'updated', transactionId: existingSource.transactionId };
        }
        return { status: 'known', transactionId: existingSource.transactionId };
    }
    const appTransaction = toAppTransaction(transaction, account, item.institutionName, { ownerUsername });
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
            await dbService.updateTransactionForUser(
                match.id, userId, preserveLinkedInternalTransfer(match, appTransaction)
            );
        }
        await linkSource(
            userId, item.itemId, transaction.transaction_id, match.id,
            Boolean(replacement?.ownsTransaction), 'plaid', transaction, sourceContext
        );
        if (replacement) {
            await db.run(
                `DELETE FROM transaction_sources WHERE provider = 'plaid' AND externalId = ? AND userId = ?`,
                [transaction.pending_transaction_id, userId]
            );
        }
        return { status: replacement ? 'replaced_pending' : 'matched_email', transactionId: match.id };
    }

    const transactionId = await dbService.addTransaction({ ...appTransaction, userId });
    await linkSource(userId, item.itemId, transaction.transaction_id, transactionId, true, 'plaid', transaction, sourceContext);
    if (account.appAccountId) {
        await dbService.syncTransactionAccountBalance(userId, transactionId, {
            accountId: account.appAccountId,
            confidence: 'HIGH',
        });
    }
    await dbService.detectAndMarkRecurring(userId, transactionId).catch(() => {});
    return { status: 'imported', transactionId };
}

async function applyModifiedTransaction(userId, item, transaction, accountMap, ownerUsername = null) {
    const db = await dbService.getDb();
    const source = await db.get(
        `SELECT s.*, t.SourceEmailKey, t.Category, t.Label, t.Reason, t.ReferenceNumber
         FROM transaction_sources s
         JOIN transactions t ON t.id = s.transactionId AND t.userId = s.userId
         WHERE s.provider = 'plaid' AND s.externalId = ? AND s.userId = ?`,
        [transaction.transaction_id, userId]
    );
    const account = accountMap.get(transaction.account_id) || {};
    const sourceContext = { account, institutionName: item.institutionName };
    if (!source) return importAddedTransaction(userId, item, transaction, accountMap, ownerUsername);
    await linkSource(
        userId, item.itemId, transaction.transaction_id, source.transactionId,
        Boolean(source.ownsTransaction), 'plaid', transaction, sourceContext
    );
    if (!source.ownsTransaction || source.SourceEmailKey) return { status: 'linked_source_preserved' };
    const appTransaction = toAppTransaction(transaction, account, item.institutionName, { ownerUsername });
    if (!appTransaction) return { status: 'ignored' };
    await dbService.updateTransactionForUser(
        source.transactionId, userId, preserveLinkedInternalTransfer(source, appTransaction)
    );
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
        `SELECT s.*, t.SourceEmailKey
         FROM transaction_sources s
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
                    options: {
                        include_personal_finance_category: true,
                        include_original_description: true,
                    },
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

const investmentFeeSubtypes = new Set([
    'account fee', 'fund fee', 'legal fee', 'management fee', 'margin expense',
    'miscellaneous fee', 'transfer fee', 'trust fee',
]);
const investmentTaxSubtypes = new Set(['non-resident tax', 'tax', 'tax withheld']);
const investmentDividendSubtypes = new Set([
    'dividend', 'non-qualified dividend', 'qualified dividend', 'return of principal',
    'short-term capital gain', 'long-term capital gain',
]);

function toAppInvestmentTransaction(transaction, account = {}, security = {}, institutionName = null) {
    const type = String(transaction.type || '').toLowerCase();
    const subtype = String(transaction.subtype || '').toLowerCase();
    if (type === 'cancel') return null;
    const signedAmount = Number(transaction.amount);
    const amountMinor = Number.isFinite(signedAmount) ? Math.abs(Math.round(signedAmount * 100)) : 0;
    const flow = type === 'transfer' ? 'NONE' : signedAmount > 0 ? 'OUT' : signedAmount < 0 ? 'IN' : 'NONE';
    let Category = 'Investment';
    let Label = flow === 'IN' ? 'Investment Reimbursements' : 'Investment Fees';
    let PortfolioAction = flow === 'IN' ? 'REIMBURSEMENT' : 'FEE';

    if (type === 'buy') {
        Label = 'ETF & Stock Purchase';
        PortfolioAction = 'BUY';
    } else if (type === 'sell') {
        Label = 'ETF & Stock Sale';
        PortfolioAction = 'SELL';
    } else if (type === 'transfer') {
        Label = 'Asset Distribution';
        PortfolioAction = 'TRANSFER';
    } else if (investmentFeeSubtypes.has(subtype) || type === 'fee') {
        Label = 'Investment Fees';
        PortfolioAction = 'FEE';
    } else if (investmentTaxSubtypes.has(subtype)) {
        Label = 'Investment Taxes';
        PortfolioAction = 'TAX';
    } else if (investmentDividendSubtypes.has(subtype)) {
        Label = 'Dividends';
        PortfolioAction = 'DIVIDEND';
    } else if (subtype.includes('interest')) {
        Label = 'Investment Interest';
        PortfolioAction = 'INTEREST';
    } else if (subtype === 'contribution' || subtype === 'deposit') {
        Category = 'Saving';
        Label = 'Savings Contributions';
        PortfolioAction = subtype === 'contribution' ? 'CONTRIBUTION' : 'DEPOSIT';
    } else if (subtype === 'withdrawal' || subtype === 'distribution') {
        Label = 'Asset Distribution';
        PortfolioAction = subtype === 'withdrawal' ? 'WITHDRAWAL' : 'DISTRIBUTION';
    }

    const transactionDate = transaction.transaction_datetime ||
        (/^\d{4}-\d{2}-\d{2}$/.test(transaction.date || '') ? `${transaction.date}T12:00:00.000Z` : new Date().toISOString());
    const quantity = Math.abs(Number(transaction.quantity) || 0);
    const price = Number(transaction.price);
    const primaryReason = firstNonEmpty(transaction.name, subtype, type, 'Investment transaction');
    const genericReason = genericPlaidDescriptions.has(String(primaryReason).trim().toLowerCase());
    const reasonDetail = firstNonEmpty(
        security.ticker_symbol,
        security.name,
        subtype && subtype !== String(primaryReason).trim().toLowerCase() &&
            !genericPlaidDescriptions.has(subtype) ? subtype : null,
        account.officialName,
        account.name
    );
    const reason = genericReason && reasonDetail
        ? `${primaryReason} - ${reasonDetail}`
        : primaryReason;
    return {
        AmountMinor: amountMinor,
        Amount: amountMinor / 100,
        Currency: String(transaction.iso_currency_code || transaction.unofficial_currency_code || account.currency || 'CAD').toUpperCase(),
        Category,
        Label,
        Reason: String(reason).slice(0, 500),
        Timestamp: transactionDate,
        Type: accountTypeLabel(account),
        Account: account.mask || account.name || null,
        BankName: institutionName,
        AccountFlow: flow,
        PortfolioAction,
        PortfolioAccountId: account.appAccountId || null,
        PortfolioConfidence: account.appAccountId ? 'HIGH' : null,
        PortfolioAccountNumber: account.mask || null,
        PortfolioSymbol: security.ticker_symbol || null,
        PortfolioQuantity: quantity > 0 ? quantity : null,
        PortfolioPrice: Number.isFinite(price) && price > 0 ? price : null,
    };
}

function investmentWindow() {
    const end = new Date();
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 2);
    return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

async function fetchInvestmentTransactionPages(accessToken) {
    const { startDate, endDate } = investmentWindow();
    const result = { transactions: [], securities: new Map(), startDate, endDate };
    let offset = 0;
    do {
        const page = await plaidRequest('/investments/transactions/get', {
            access_token: accessToken,
            start_date: startDate,
            end_date: endDate,
            options: { count: 500, offset, async_update: true },
        });
        result.transactions.push(...(page.investment_transactions || []));
        (page.securities || []).forEach((security) => result.securities.set(security.security_id, security));
        offset = result.transactions.length;
        if (offset >= Number(page.total_investment_transactions || 0)) return result;
    } while (true);
}

async function findInvestmentFallbackMatch(userId, appTransaction) {
    const db = await dbService.getDb();
    const timestamp = new Date(appTransaction.Timestamp);
    const from = new Date(timestamp.getTime() - 5 * 86400000).toISOString();
    const to = new Date(timestamp.getTime() + 5 * 86400000).toISOString();
    const candidates = await db.all(
        `SELECT t.* FROM transactions t
         WHERE t.userId = ? AND t.AmountMinor = ? AND t.Timestamp BETWEEN ? AND ?
           AND NOT EXISTS (
               SELECT 1 FROM transaction_sources s
               WHERE s.transactionId = t.id AND s.provider = 'plaid_investments'
           )`,
        [userId, appTransaction.AmountMinor, from, to]
    );
    const ranked = candidates.map((candidate) => {
        const sameDate = String(candidate.Timestamp).slice(0, 10) === String(appTransaction.Timestamp).slice(0, 10);
        const sameAccount = Number(candidate.PortfolioAccountId) === Number(appTransaction.PortfolioAccountId);
        const sameAction = candidate.PortfolioAction === appTransaction.PortfolioAction;
        const sameSymbol = appTransaction.PortfolioSymbol && candidate.PortfolioSymbol === appTransaction.PortfolioSymbol;
        const quantities = [Number(candidate.PortfolioQuantity), Number(appTransaction.PortfolioQuantity)];
        const sameQuantity = quantities.every(Number.isFinite) && Math.abs(quantities[0] - quantities[1]) < 1e-8;
        const score = (sameDate ? 4 : 0) + (sameAccount ? 6 : 0) + (sameAction ? 5 : 0) +
            (sameSymbol ? 5 : 0) + (sameQuantity ? 5 : 0) +
            (reasonOverlap(candidate.Reason, appTransaction.Reason).length > 0 ? 1 : 0);
        return { candidate, score };
    }).filter(({ score }) => score >= 10).sort((a, b) => b.score - a.score);
    if (!ranked.length || ranked[0].score === ranked[1]?.score) return null;
    return ranked[0].candidate;
}

async function importInvestmentTransaction(userId, item, transaction, accountMap, securities) {
    const db = await dbService.getDb();
    const externalId = transaction.investment_transaction_id;
    const existing = await db.get(
        `SELECT s.*, t.SourceEmailKey, t.Category, t.Label, t.Reason, t.ReferenceNumber
         FROM transaction_sources s
         JOIN transactions t ON t.id = s.transactionId AND t.userId = s.userId
         WHERE s.provider = 'plaid_investments' AND s.externalId = ? AND s.userId = ?`,
        [externalId, userId]
    );
    const account = accountMap.get(transaction.account_id) || {};
    const security = securities.get(transaction.security_id) || {};
    const sourceContext = {
        account,
        security,
        institutionName: item.institutionName,
    };
    const appTransaction = toAppInvestmentTransaction(
        transaction, account, security, item.institutionName
    );
    if (!appTransaction) return { status: 'ignored' };
    if (existing) {
        await linkSource(
            userId, item.itemId, externalId, existing.transactionId,
            Boolean(existing.ownsTransaction), 'plaid_investments', transaction, sourceContext
        );
        if (existing.ownsTransaction && !existing.SourceEmailKey) {
            await dbService.updateTransactionForUser(
                existing.transactionId, userId,
                preserveLinkedInternalTransfer(existing, appTransaction)
            );
            return { status: 'updated', transactionId: existing.transactionId };
        }
        return { status: 'known', transactionId: existing.transactionId };
    }
    const match = await findInvestmentFallbackMatch(userId, appTransaction);
    if (match) {
        await linkSource(
            userId, item.itemId, externalId, match.id, false,
            'plaid_investments', transaction, sourceContext
        );
        return { status: 'matched_email', transactionId: match.id };
    }
    const transactionId = await dbService.addTransaction({ ...appTransaction, userId });
    await linkSource(
        userId, item.itemId, externalId, transactionId, true,
        'plaid_investments', transaction, sourceContext
    );
    return { status: 'imported', transactionId };
}

async function removeMissingInvestmentTransactions(userId, itemId, startDate, currentIds) {
    const db = await dbService.getDb();
    const sources = await db.all(
        `SELECT s.*, t.SourceEmailKey FROM transaction_sources s
         JOIN transactions t ON t.id = s.transactionId AND t.userId = s.userId
         WHERE s.provider = 'plaid_investments' AND s.itemId = ? AND s.userId = ? AND t.Timestamp >= ?`,
        [itemId, userId, `${startDate}T00:00:00.000Z`]
    );
    let removed = 0;
    for (const source of sources) {
        if (currentIds.has(source.externalId)) continue;
        await db.run(
            `DELETE FROM transaction_sources WHERE provider = 'plaid_investments' AND externalId = ? AND userId = ?`,
            [source.externalId, userId]
        );
        const remaining = await db.get('SELECT COUNT(*) AS count FROM transaction_sources WHERE transactionId = ?', [source.transactionId]);
        if (source.ownsTransaction && !source.SourceEmailKey && !remaining.count) {
            await dbService.deleteTransaction(source.transactionId, userId);
        }
        removed += 1;
    }
    return removed;
}

function parseStoredSourcePayload(value) {
    if (!value) return null;
    try { return JSON.parse(value); }
    catch { return null; }
}

async function refreshStoredPlaidSourceDetails(userId) {
    const db = await dbService.getDb();
    const user = await db.get('SELECT username FROM users WHERE id = ?', [userId]);
    const rows = await db.all(
        `SELECT s.provider, s.rawPayloadJson, s.contextPayloadJson, s.ownsTransaction, t.*
         FROM transaction_sources s
         JOIN transactions t ON t.id = s.transactionId AND t.userId = s.userId
         WHERE s.userId = ? AND s.provider IN ('plaid', 'plaid_investments')
           AND s.rawPayloadJson IS NOT NULL AND length(s.rawPayloadJson) > 2`,
        [userId]
    );
    const refreshed = { bank: 0, investments: 0 };
    for (const row of rows) {
        if (!row.ownsTransaction || row.SourceEmailKey) continue;
        const rawPayload = parseStoredSourcePayload(row.rawPayloadJson);
        const context = parseStoredSourcePayload(row.contextPayloadJson) || {};
        if (!rawPayload) continue;
        const updates = row.provider === 'plaid'
            ? toAppTransaction(rawPayload, context.account || {}, context.institutionName, { ownerUsername: user?.username })
            : toAppInvestmentTransaction(
                rawPayload, context.account || {}, context.security || {}, context.institutionName
            );
        if (!updates) continue;
        await dbService.updateTransactionForUser(
            row.id, userId, preserveLinkedInternalTransfer(row, updates)
        );
        if (row.provider === 'plaid') refreshed.bank += 1;
        else refreshed.investments += 1;
    }
    return refreshed;
}

async function performItemSync(item, { forceHoldings = false, backfillSources = false } = {}) {
    const db = await dbService.getDb();
    try {
        const user = await db.get('SELECT username FROM users WHERE id = ?', [item.userId]);
        const ownerUsername = user?.username || null;
        const accessToken = decryptAccessToken(item.accessTokenEncrypted);
        const holdingsStale = !item.holdingsLastSyncedAt ||
            new Date(item.holdingsLastSyncedAt).getTime() < Date.now() - INVESTMENT_HOLDINGS_REFRESH_MS;
        const shouldFetchHoldings = forceHoldings || item.holdingsStatus !== 'active' || holdingsStale;
        const investmentTransactionsStale = !item.investmentTransactionsLastSyncedAt ||
            new Date(item.investmentTransactionsLastSyncedAt).getTime() < Date.now() - 6 * 60 * 60 * 1000;
        const shouldFetchInvestmentTransactions = forceHoldings ||
            item.investmentTransactionsStatus !== 'active' || investmentTransactionsStale;
        const missingBankSources = backfillSources ? await db.all(
            `SELECT externalId FROM transaction_sources
             WHERE provider = 'plaid' AND itemId = ? AND userId = ?
               AND (rawPayloadJson IS NULL OR length(rawPayloadJson) <= 2)`,
            [item.itemId, item.userId]
        ) : [];
        const [changes, accountResponse, bankReplay] = await Promise.all([
            fetchSyncPages(accessToken, item.cursor),
            plaidRequest('/accounts/get', { access_token: accessToken }),
            missingBankSources.length ? fetchSyncPages(accessToken, null) : Promise.resolve(null),
        ]);
        const accounts = accountResponse.accounts?.length
            ? accountResponse.accounts
            : [...changes.accounts.values()];
        const accountMap = await upsertPlaidAccounts(item.userId, item, accounts);
        const hasInvestmentAccounts = accounts.some((account) => account.type === 'investment');
        const [investmentResult, investmentTransactionsResult] = hasInvestmentAccounts
            ? await Promise.all([
                shouldFetchHoldings
                ? plaidRequest('/investments/holdings/get', { access_token: accessToken })
                    .then((snapshot) => ({ snapshot }))
                    .catch((error) => ({ error }))
                : Promise.resolve({ skipped: true }),
                shouldFetchInvestmentTransactions
                ? fetchInvestmentTransactionPages(accessToken)
                    .then((history) => ({ history }))
                    .catch((error) => ({ error }))
                : Promise.resolve({ skipped: true }),
            ])
            : [{ notApplicable: true }, { notApplicable: true }];
        const totals = { imported: 0, matched: 0, updated: 0, removed: changes.removed.length };
        totals.sourceDetailsBackfilled = 0;
        if (bankReplay) {
            const missingIds = new Set(missingBankSources.map(({ externalId }) => externalId));
            const replayTransactions = [...bankReplay.added, ...bankReplay.modified];
            for (const transaction of replayTransactions) {
                if (!missingIds.has(transaction.transaction_id)) continue;
                const result = await applyModifiedTransaction(item.userId, item, transaction, accountMap, ownerUsername);
                if (result.status !== 'ignored') totals.sourceDetailsBackfilled += 1;
                if (result.status === 'updated') totals.updated += 1;
            }
        }
        for (const transaction of changes.added) {
            const result = await importAddedTransaction(item.userId, item, transaction, accountMap, ownerUsername);
            if (result.status === 'imported') totals.imported += 1;
            if (result.status === 'matched_email' || result.status === 'replaced_pending') totals.matched += 1;
            if (result.status === 'updated') totals.updated += 1;
        }
        for (const transaction of changes.modified) {
            const result = await applyModifiedTransaction(item.userId, item, transaction, accountMap, ownerUsername);
            if (result.status === 'updated') totals.updated += 1;
        }
        for (const transaction of changes.removed) await applyRemovedTransaction(item.userId, transaction);
        totals.investmentTransactionsImported = 0;
        totals.investmentTransactionsMatched = 0;
        totals.investmentTransactionsUpdated = 0;
        totals.investmentTransactionsRemoved = 0;
        if (investmentTransactionsResult.history) {
            const history = investmentTransactionsResult.history;
            for (const transaction of history.transactions) {
                const result = await importInvestmentTransaction(
                    item.userId, item, transaction, accountMap, history.securities
                );
                if (result.status === 'imported') totals.investmentTransactionsImported += 1;
                if (result.status === 'matched_email') totals.investmentTransactionsMatched += 1;
                if (result.status === 'updated') totals.investmentTransactionsUpdated += 1;
            }
            totals.investmentTransactionsRemoved = await removeMissingInvestmentTransactions(
                item.userId, item.itemId, history.startDate,
                new Set(history.transactions.map((transaction) => transaction.investment_transaction_id))
            );
            totals.investmentTransactionsStatus = 'active';
        } else if (investmentTransactionsResult.error?.code === 'PRODUCT_NOT_READY') {
            totals.investmentTransactionsStatus = 'pending';
        } else if (investmentTransactionsResult.error?.code === 'ADDITIONAL_CONSENT_REQUIRED') {
            totals.investmentTransactionsStatus = 'consent_required';
        } else if (['NO_INVESTMENT_ACCOUNTS', 'PRODUCT_NOT_SUPPORTED', 'PRODUCTS_NOT_SUPPORTED'].includes(investmentTransactionsResult.error?.code)) {
            totals.investmentTransactionsStatus = 'unavailable';
        } else if (investmentTransactionsResult.error) {
            totals.investmentTransactionsStatus = 'error';
        } else if (investmentTransactionsResult.notApplicable) {
            totals.investmentTransactionsStatus = 'not_applicable';
        } else {
            totals.investmentTransactionsStatus = item.investmentTransactionsStatus || 'unknown';
        }
        const transferReconciliation = await reconcileHistoricalInternalTransfers(db, item.userId);
        totals.internalTransfersMatched = transferReconciliation.matched;
        totals.internalTransferLegsRestored = transferReconciliation.restored;
        totals.selfTransfersReclassified = transferReconciliation.selfReclassified;
        // Transaction events preserve edit/delete behavior, but a partial history
        // cannot reconstruct an account's opening balance. Plaid's current balance
        // is the authoritative anchor after every completed sync.
        totals.balancesUpdated = await applyAuthoritativeBalances(item.userId, accountMap);
        if (investmentResult.snapshot) {
            totals.holdingsUpdated = await applyInvestmentSnapshot(item.userId, accountMap, investmentResult.snapshot);
            totals.holdingsStatus = 'active';
        } else if (investmentResult.error?.code === 'ADDITIONAL_CONSENT_REQUIRED') {
            totals.holdingsStatus = 'consent_required';
        } else if (['NO_INVESTMENT_ACCOUNTS', 'PRODUCT_NOT_READY', 'PRODUCTS_NOT_SUPPORTED'].includes(investmentResult.error?.code)) {
            totals.holdingsStatus = 'unavailable';
        } else if (investmentResult.error) {
            totals.holdingsStatus = 'error';
        } else if (investmentResult.notApplicable) {
            totals.holdingsStatus = 'not_applicable';
        } else {
            totals.holdingsStatus = item.holdingsStatus || 'unknown';
        }
        const holdingsError = investmentResult.error
            ? String(investmentResult.error.message || 'Investment holdings sync failed').slice(0, 500)
            : null;
        const investmentTransactionsError = investmentTransactionsResult.error
            ? String(investmentTransactionsResult.error.message || 'Investment transaction sync failed').slice(0, 500)
            : null;
        const now = new Date().toISOString();
        await db.run(
            `UPDATE plaid_items SET cursor = ?, status = 'active', lastSyncedAt = ?,
                lastError = NULL, holdingsStatus = ?, holdingsLastError = ?,
                holdingsLastSyncedAt = COALESCE(?, holdingsLastSyncedAt),
                investmentTransactionsStatus = ?, investmentTransactionsLastError = ?,
                investmentTransactionsLastSyncedAt = COALESCE(?, investmentTransactionsLastSyncedAt),
                updatedAt = ?
              WHERE itemId = ? AND userId = ?`,
            [changes.nextCursor, now, totals.holdingsStatus,
                investmentResult.skipped ? item.holdingsLastError : holdingsError,
                investmentResult.snapshot ? now : null, totals.investmentTransactionsStatus,
                investmentTransactionsResult.skipped ? item.investmentTransactionsLastError : investmentTransactionsError,
                investmentTransactionsResult.history ? now : null, now, item.itemId, item.userId]
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

async function syncItem(item, options = {}) {
    if (syncPromises.has(item.itemId)) return syncPromises.get(item.itemId);
    const promise = performItemSync(item, options).finally(() => syncPromises.delete(item.itemId));
    syncPromises.set(item.itemId, promise);
    return promise;
}

async function syncUserItems(userId, { force = false, forceHoldings = force, backfillSources = force } = {}) {
    if (!isConfigured()) return { configured: false, results: [] };
    const db = await dbService.getDb();
    const items = await db.all('SELECT * FROM plaid_items WHERE userId = ?', [userId]);
    const cutoff = Date.now() - USER_SYNC_COOLDOWN_MS;
    const eligible = force ? items : items.filter((item) => !item.lastSyncedAt || new Date(item.lastSyncedAt).getTime() < cutoff);
    const results = [];
    for (const item of eligible) {
        try {
            results.push({ itemId: item.itemId, ok: true, ...(await syncItem(item, { forceHoldings, backfillSources })) });
        } catch (error) {
            console.error(`[Plaid] Sync failed for item ${item.itemId}:`, error.message);
            results.push({ itemId: item.itemId, ok: false, error: error.message });
        }
    }
    const storedSourcesRefreshed = force
        ? await refreshStoredPlaidSourceDetails(userId)
        : { bank: 0, investments: 0 };
    return { configured: true, results, storedSourcesRefreshed };
}

function reconciliationIntervalMs(value = process.env.PLAID_RECONCILIATION_INTERVAL_HOURS) {
    const hours = value === undefined || value === '' ? DEFAULT_RECONCILIATION_HOURS : Number(value);
    return Number.isFinite(hours) && hours >= 1 && hours <= 168
        ? hours * 60 * 60 * 1000
        : DEFAULT_RECONCILIATION_HOURS * 60 * 60 * 1000;
}

async function reconcileAllPlaidItems() {
    if (!isConfigured()) return { configured: false, users: 0, items: 0, failed: 0 };
    if (reconciliationPromise) return reconciliationPromise;
    reconciliationPromise = (async () => {
        const db = await dbService.getDb();
        const users = await db.all('SELECT DISTINCT userId FROM plaid_items ORDER BY userId');
        const summary = { configured: true, users: users.length, items: 0, failed: 0 };
        for (const { userId } of users) {
            const result = await syncUserItems(userId, { force: true, forceHoldings: false });
            summary.items += result.results.length;
            summary.failed += result.results.filter((item) => !item.ok).length;
        }
        return summary;
    })().finally(() => { reconciliationPromise = null; });
    return reconciliationPromise;
}

function startAutomaticReconciliation() {
    if (reconciliationTimer) return reconciliationTimer;
    const run = () => reconcileAllPlaidItems().then((summary) => {
        console.log(`[Plaid] Reconciliation checked ${summary.items} Item(s); ${summary.failed} failed.`);
    }).catch((error) => console.error('[Plaid] Reconciliation failed:', error.message));
    reconciliationStartupTimer = setTimeout(run, RECONCILIATION_STARTUP_DELAY_MS);
    reconciliationStartupTimer.unref?.();
    reconciliationTimer = setInterval(run, reconciliationIntervalMs());
    reconciliationTimer.unref?.();
    return reconciliationTimer;
}

const webhookSyncOptions = ({ webhook_type: type, webhook_code: code } = {}) => {
    if (type === 'TRANSACTIONS' && code === 'SYNC_UPDATES_AVAILABLE') return { forceHoldings: false };
    if (type === 'HOLDINGS' && code === 'DEFAULT_UPDATE') return { forceHoldings: true };
    if (type === 'INVESTMENTS_TRANSACTIONS' && ['DEFAULT_UPDATE', 'HISTORICAL_UPDATE'].includes(code)) {
        return { forceHoldings: true };
    }
    if (type === 'ITEM' && code === 'LOGIN_REPAIRED') return { forceHoldings: true };
    return null;
};

async function processPlaidWebhook(payload = {}) {
    const itemId = typeof payload.item_id === 'string' ? payload.item_id : null;
    if (!itemId) return { handled: false, reason: 'missing_item' };
    const db = await dbService.getDb();
    const item = await db.get('SELECT * FROM plaid_items WHERE itemId = ?', [itemId]);
    if (!item) return { handled: false, reason: 'unknown_item' };
    await db.run(
        `UPDATE plaid_items SET lastWebhookAt = ?, lastWebhookType = ?, lastWebhookCode = ?, updatedAt = ?
         WHERE itemId = ?`,
        [new Date().toISOString(), String(payload.webhook_type || 'UNKNOWN').slice(0, 80),
            String(payload.webhook_code || 'UNKNOWN').slice(0, 120), new Date().toISOString(), itemId]
    );

    if (payload.webhook_type === 'ITEM' && ['ERROR', 'PENDING_DISCONNECT'].includes(payload.webhook_code)) {
        const message = payload.error?.error_message || payload.reason || payload.webhook_code;
        await db.run(
            `UPDATE plaid_items SET status = ?, lastError = ?, updatedAt = ? WHERE itemId = ?`,
            [payload.webhook_code === 'ERROR' ? 'error' : 'attention_required',
                String(message).slice(0, 500), new Date().toISOString(), itemId]
        );
        return { handled: true, action: 'status_updated' };
    }

    const syncOptions = webhookSyncOptions(payload);
    if (!syncOptions) return { handled: true, action: 'acknowledged' };
    return { handled: true, action: 'synced', ...(await syncItem(item, syncOptions)) };
}

async function enqueuePlaidWebhook(rawBody, signedJwt) {
    if (!Buffer.isBuffer(rawBody) || !rawBody.length) throw new Error('Plaid webhook body is empty');
    if (typeof signedJwt !== 'string' || !signedJwt) throw new Error('Plaid webhook signature is empty');
    const payloadJson = rawBody.toString('utf8');
    const payload = JSON.parse(payloadJson);
    const eventKey = crypto.createHash('sha256').update(signedJwt).digest('hex');
    const now = new Date().toISOString();
    const db = await dbService.getDb();
    const result = await db.run(
        `INSERT OR IGNORE INTO plaid_webhook_events
            (eventKey, itemId, webhookType, webhookCode, payloadJson, status, attempts,
             receivedAt, nextAttemptAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
        [eventKey, typeof payload.item_id === 'string' ? payload.item_id : null,
            typeof payload.webhook_type === 'string' ? payload.webhook_type.slice(0, 80) : null,
            typeof payload.webhook_code === 'string' ? payload.webhook_code.slice(0, 120) : null,
            payloadJson, now, now, now]
    );
    const event = await db.get('SELECT id, status FROM plaid_webhook_events WHERE eventKey = ?', [eventKey]);
    return { id: event.id, status: event.status, inserted: result.changes === 1 };
}

const webhookRetryDelayMs = (attempt) => Math.min(
    30 * 1000 * (2 ** Math.max(0, Number(attempt || 1) - 1)),
    WEBHOOK_MAX_RETRY_MS
);

async function processPendingPlaidWebhooks({ limit = 25, processor = processPlaidWebhook } = {}) {
    if (webhookProcessingPromise) return webhookProcessingPromise;
    webhookProcessingPromise = (async () => {
        const db = await dbService.getDb();
        const now = new Date();
        const nowIso = now.toISOString();
        const staleIso = new Date(now.getTime() - WEBHOOK_PROCESSING_STALE_MS).toISOString();
        await db.run(
            `UPDATE plaid_webhook_events SET status = 'retry', nextAttemptAt = ?, updatedAt = ?
             WHERE status = 'processing' AND lastAttemptAt < ?`,
            [nowIso, nowIso, staleIso]
        );
        const events = await db.all(
            `SELECT * FROM plaid_webhook_events
             WHERE status IN ('pending', 'retry') AND nextAttemptAt <= ?
             ORDER BY id LIMIT ?`,
            [nowIso, Math.max(1, Math.min(100, Number(limit) || 25))]
        );
        const summary = { selected: events.length, processed: 0, retried: 0 };
        for (const event of events) {
            const attempt = Number(event.attempts || 0) + 1;
            const claimed = await db.run(
                `UPDATE plaid_webhook_events
                 SET status = 'processing', attempts = ?, lastAttemptAt = ?, updatedAt = ?
                 WHERE id = ? AND status IN ('pending', 'retry')`,
                [attempt, nowIso, nowIso, event.id]
            );
            if (claimed.changes !== 1) continue;
            try {
                const result = await processor(JSON.parse(event.payloadJson));
                if (result?.reason === 'unknown_item') throw new Error('Plaid Item is not available locally yet');
                const processedAt = new Date().toISOString();
                await db.run(
                    `UPDATE plaid_webhook_events
                     SET status = 'processed', processedAt = ?, lastError = NULL, updatedAt = ?
                     WHERE id = ?`,
                    [processedAt, processedAt, event.id]
                );
                summary.processed += 1;
            } catch (error) {
                const retryAt = new Date(Date.now() + webhookRetryDelayMs(attempt)).toISOString();
                await db.run(
                    `UPDATE plaid_webhook_events
                     SET status = 'retry', nextAttemptAt = ?, lastError = ?, updatedAt = ?
                     WHERE id = ?`,
                    [retryAt, String(error.message || 'Webhook processing failed').slice(0, 500),
                        new Date().toISOString(), event.id]
                );
                summary.retried += 1;
            }
        }
        return summary;
    })().finally(() => { webhookProcessingPromise = null; });
    return webhookProcessingPromise;
}

function kickPlaidWebhookWorker() {
    setImmediate(() => processPendingPlaidWebhooks().catch((error) => {
        console.error('[Plaid] Webhook worker failed:', error.message);
    }));
}

function startPlaidWebhookWorker() {
    if (webhookWorkerTimer) return webhookWorkerTimer;
    kickPlaidWebhookWorker();
    webhookWorkerTimer = setInterval(kickPlaidWebhookWorker, WEBHOOK_WORKER_INTERVAL_MS);
    webhookWorkerTimer.unref?.();
    return webhookWorkerTimer;
}

async function registerWebhookForAllItems(webhookUrl = getConfig().webhookUrl) {
    if (!webhookUrl) throw new Error('PLAID_WEBHOOK_URL is not configured');
    const parsed = new URL(webhookUrl);
    if (parsed.protocol !== 'https:') throw new Error('Plaid webhook URL must use HTTPS');
    const db = await dbService.getDb();
    const items = await db.all('SELECT itemId, accessTokenEncrypted FROM plaid_items ORDER BY createdAt');
    const results = [];
    for (const item of items) {
        try {
            const response = await plaidRequest('/item/webhook/update', {
                access_token: decryptAccessToken(item.accessTokenEncrypted),
                webhook: webhookUrl,
            });
            results.push({ itemId: item.itemId, ok: true, webhook: response.item?.webhook || webhookUrl });
        } catch (error) {
            results.push({ itemId: item.itemId, ok: false, error: error.message });
        }
    }
    return results;
}

async function getStatus(userId) {
    const config = getConfig();
    if (!isConfigured()) return { configured: false, environment: config.environment, items: [] };
    const db = await dbService.getDb();
    await removeExactDuplicateItems(db, userId);
    const items = await db.all(
        `SELECT i.itemId, i.institutionId, i.institutionName, i.status, i.lastSyncedAt,
                i.lastError, i.holdingsStatus, i.holdingsLastError, i.holdingsLastSyncedAt,
                i.investmentTransactionsStatus, i.investmentTransactionsLastError,
                i.investmentTransactionsLastSyncedAt, i.lastWebhookAt, i.lastWebhookType,
                i.lastWebhookCode, i.createdAt,
                COUNT(a.plaidAccountId) AS accountCount,
                SUM(CASE WHEN lower(a.type) = 'investment' THEN 1 ELSE 0 END) AS investmentAccountCount
         FROM plaid_items i LEFT JOIN plaid_accounts a ON a.itemId = i.itemId
         WHERE i.userId = ? GROUP BY i.itemId ORDER BY i.createdAt DESC`,
        [userId]
    );
    const accounts = await db.all(
        `SELECT a.itemId, a.plaidAccountId, a.name, a.officialName, a.mask, a.type, a.subtype,
                a.appAccountId, ia.name AS appAccountName, ia.accountRef AS appAccountRef
         FROM plaid_accounts a
         LEFT JOIN investment_accounts ia ON ia.id = a.appAccountId AND ia.userId = a.userId
         WHERE a.userId = ?
         ORDER BY a.itemId, a.name`,
        [userId]
    );
    const accountsByItem = new Map();
    for (const account of accounts) {
        if (!accountsByItem.has(account.itemId)) accountsByItem.set(account.itemId, []);
        accountsByItem.get(account.itemId).push(account);
    }
    for (const item of items) item.accounts = accountsByItem.get(item.itemId) || [];
    const webhookInbox = await db.get(
        `SELECT
            SUM(CASE WHEN e.status IN ('pending', 'processing', 'retry') THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN e.status = 'processed' THEN 1 ELSE 0 END) AS processed,
            MAX(e.processedAt) AS lastProcessedAt
         FROM plaid_webhook_events e JOIN plaid_items i ON i.itemId = e.itemId
         WHERE i.userId = ?`,
        [userId]
    );
    return {
        configured: true,
        environment: config.environment,
        items,
        webhookInbox: {
            pending: Number(webhookInbox?.pending || 0),
            processed: Number(webhookInbox?.processed || 0),
            lastProcessedAt: webhookInbox?.lastProcessedAt || null,
        },
    };
}

// A fresh Plaid Link flow can create a second Item for the same bank account.
// Remove only exact duplicates: same institution and identical account
// fingerprints. Different accounts at the same institution remain separate.
async function removeExactDuplicateItems(db, userId) {
    const items = await db.all(
        `SELECT itemId, institutionId, institutionName, updatedAt, createdAt
         FROM plaid_items WHERE userId = ? ORDER BY updatedAt DESC, createdAt DESC`,
        [userId]
    );
    const accounts = await db.all(
        `SELECT itemId, name, officialName, mask, type, subtype
         FROM plaid_accounts WHERE userId = ? ORDER BY itemId, plaidAccountId`,
        [userId]
    );
    const accountsByItem = new Map();
    for (const account of accounts) {
        if (!accountsByItem.has(account.itemId)) accountsByItem.set(account.itemId, []);
        accountsByItem.get(account.itemId).push(account);
    }
    const fingerprint = (item) => {
        const itemAccounts = accountsByItem.get(item.itemId) || [];
        if (!itemAccounts.length) return null;
        const institution = String(item.institutionId || item.institutionName || '').trim().toLowerCase();
        const accountFingerprint = itemAccounts.map((account) => [
            account.name, account.officialName, account.mask, account.type, account.subtype,
        ].map((value) => String(value || '').trim().toLowerCase()).join('|')).sort().join(';;');
        return `${institution}::${itemAccounts.length}::${accountFingerprint}`;
    };
    const kept = new Map();
    const duplicates = [];
    for (const item of items) {
        const key = fingerprint(item);
        if (!key) continue;
        if (kept.has(key)) duplicates.push(item);
        else kept.set(key, item);
    }
    if (!duplicates.length) return 0;
    await db.run('BEGIN IMMEDIATE');
    try {
        for (const duplicate of duplicates) {
            await db.run(
                `DELETE FROM transaction_sources WHERE itemId = ? AND userId = ?`,
                [duplicate.itemId, userId]
            );
            await db.run('DELETE FROM plaid_accounts WHERE itemId = ? AND userId = ?', [duplicate.itemId, userId]);
            await db.run('DELETE FROM plaid_items WHERE itemId = ? AND userId = ?', [duplicate.itemId, userId]);
        }
        await db.run('COMMIT');
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
    return duplicates.length;
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
        await db.run(
            `DELETE FROM transaction_sources WHERE provider IN ('plaid', 'plaid_investments') AND itemId = ? AND userId = ?`,
            [itemId, userId]
        );
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
    reconciliationIntervalMs,
    reconcileAllPlaidItems,
    startAutomaticReconciliation,
    startAutomaticMarketPriceRefresh,
    verifyPlaidWebhook,
    webhookSyncOptions,
    processPlaidWebhook,
    enqueuePlaidWebhook,
    webhookRetryDelayMs,
    processPendingPlaidWebhooks,
    kickPlaidWebhookWorker,
    startPlaidWebhookWorker,
    registerWebhookForAllItems,
    getStatus,
    disconnectItem,
    classifyPlaidTransaction,
    toAppTransaction,
    toAppInvestmentTransaction,
    plaidBalanceMinor,
    plaidAvailableBalanceMinor,
    fetchCurrentMarketPrices,
    fetchYahooMarketPrice,
    isMarketPriceRefreshWindow,
    nextMarketPriceRefreshDelayMs,
    refreshStoredMarketPrices,
    normalizeInvestmentSnapshot,
    refreshStoredPlaidSourceDetails,
    preserveLinkedInternalTransfer,
    encryptAccessToken,
    decryptAccessToken,
};
