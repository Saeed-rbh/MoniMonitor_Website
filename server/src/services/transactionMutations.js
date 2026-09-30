const crypto = require('node:crypto');
const dbService = require('../database/dbService');
const { parseTransaction, transactionUpdateSchema } = require('../validation/transaction');

class TransactionMutationError extends Error {
    constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
}

async function validateAccount(db, userId, id) {
    if (id === null || id === undefined) return;
    if (!Number.isSafeInteger(id) || id <= 0 || !await db.get('SELECT id FROM investment_accounts WHERE id = ? AND userId = ?', [id, userId])) {
        throw new TransactionMutationError('Invalid balance account');
    }
}

async function postBalance(userId, id, transaction, balanceAccountId) {
    const accountResolution = await dbService.ensureTransactionAccount(userId, {
        ...transaction, BalanceAccountId: balanceAccountId,
        BalanceAccountConfidence: balanceAccountId ? 'HIGH' : null,
    });
    const resolvedId = balanceAccountId || accountResolution.account?.id || null;
    const accountPosting = await dbService.syncTransactionAccountBalance(userId, id, {
        accountId: resolvedId, confidence: resolvedId ? 'HIGH' : null,
    });
    return { accountPosting, accountResolution };
}

async function createTransaction(userId, input, idempotencyKey = null) {
    if (idempotencyKey !== null && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
        throw new TransactionMutationError('Invalid idempotency key');
    }
    const { BalanceAccountId = null, ...fields } = input || {};
    const transaction = parseTransaction(fields);
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
    const db = await dbService.getDb();
    return db.withTransaction(async () => {
        if (idempotencyKey) {
            const previous = await db.get('SELECT requestHash, responseJson FROM transaction_requests WHERE userId = ? AND requestKey = ?', [userId, idempotencyKey]);
            if (previous) {
                if (previous.requestHash !== requestHash) throw new TransactionMutationError('Idempotency key was already used for different transaction data', 409);
                return JSON.parse(previous.responseJson);
            }
        }
        await validateAccount(db, userId, BalanceAccountId);
        const id = await dbService.addTransaction({ ...transaction, userId });
        const posting = await postBalance(userId, id, transaction, BalanceAccountId);
        await dbService.detectAndMarkRecurring(userId, id);
        const response = { message: 'Created', data: await dbService.getTransactionById(id, userId), ...posting };
        if (idempotencyKey) {
            await db.run('INSERT INTO transaction_requests (userId, requestKey, requestHash, responseJson, createdAt) VALUES (?, ?, ?, ?, ?)',
                [userId, idempotencyKey, requestHash, JSON.stringify(response), new Date().toISOString()]);
        }
        return response;
    });
}

async function updateTransaction(userId, id, input) {
    const { BalanceAccountId = null, ...fields } = input || {};
    if (!BalanceAccountId && !Object.keys(fields).length) throw new TransactionMutationError('No transaction or account changes supplied');
    const updates = Object.keys(fields).length ? transactionUpdateSchema.parse(fields) : {};
    const db = await dbService.getDb();
    return db.withTransaction(async () => {
        const previous = await dbService.getTransactionById(id, userId);
        if (!previous) throw new TransactionMutationError('Transaction not found', 404);
        if (updates.Currency && updates.Currency !== (previous.Currency || 'CAD') &&
            await db.get(`SELECT id FROM account_balance_events WHERE sourceTransactionId = ? AND userId = ?
                UNION ALL SELECT id FROM portfolio_transactions WHERE sourceTransactionId = ? AND userId = ? LIMIT 1`,
                [id, userId, id, userId])) {
            throw new TransactionMutationError('Reverse the existing account posting before changing its currency');
        }
        await validateAccount(db, userId, BalanceAccountId);
        if (Object.keys(updates).length) await dbService.updateTransactionForUser(id, userId, updates);
        const transaction = await dbService.getTransactionById(id, userId);
        const posting = await postBalance(userId, id, transaction, BalanceAccountId);
        if (updates.Category || updates.Label) {
            const generic = new Set(['withdrawal', 'deposit', 'bank withdrawal', 'bank deposit', 'other', 'other expense', 'other income']);
            const label = transaction.Label?.toLowerCase().trim();
            if (transaction.Reason && label && !generic.has(label)) {
                await dbService.saveMerchantRule(userId, transaction.Reason, transaction.Category, transaction.Label);
            }
        }
        await dbService.detectAndMarkRecurring(userId, id);
        await dbService.detectAndReclassifyInternalCounterparts(userId, id);
        return { message: 'Updated', data: await dbService.getTransactionById(id, userId), ...posting };
    });
}

module.exports = { createTransaction, updateTransaction, TransactionMutationError };
