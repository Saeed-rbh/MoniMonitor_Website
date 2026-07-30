const { getDb } = require('./db');

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

async function createUser(id, username, hashedPassword) {
    const db = await getDb();
    await db.run(
        'INSERT INTO users (id, username, password) VALUES (?, ?, ?)',
        [id, username, hashedPassword]
    );
}

async function getUserByUsername(username) {
    const db = await getDb();
    return await db.get('SELECT * FROM users WHERE username = ?', [username]);
}

async function getUserById(id) {
    const db = await getDb();
    return await db.get('SELECT * FROM users WHERE id = ?', [id]);
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
        `INSERT INTO transactions (userId, Amount, AmountMinor, Currency, Category, Label, Reason, Timestamp, ReceivedAt, Type, Account, BankName, ReferenceNumber, Frequency, TelegramMessageId) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            transaction.userId,
            (Number.isSafeInteger(transaction.AmountMinor) ? transaction.AmountMinor : toMinorUnits(transaction.Amount)) / 100,
            Number.isSafeInteger(transaction.AmountMinor) ? transaction.AmountMinor : toMinorUnits(transaction.Amount),
            transaction.Currency || 'USD',
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
            transaction.TelegramMessageId || null
        ]
    );
    return result.lastID;
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
    const normalized = normalizeTransactionUpdate(updates);
    const keys = Object.keys(normalized);
    const values = Object.values(normalized);
    if (keys.length === 0) return;
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    values.push(id);
    await db.run(`UPDATE transactions SET ${setClause} WHERE id = ?`, values);
}

async function updateTransactionForUser(id, userId, updates) {
    const db = await getDb();
    const normalized = normalizeTransactionUpdate(updates);
    const keys = Object.keys(normalized);
    if (keys.length === 0) return false;
    const values = Object.values(normalized);
    const setClause = keys.map((key) => key + " = ?").join(", ");
    values.push(id, userId);
    const result = await db.run("UPDATE transactions SET " + setClause + " WHERE id = ? AND userId = ?", values);
    return result.changes > 0;
}

async function deleteTransaction(id, userId) {
    const db = await getDb();
    const result = await db.run(
        'DELETE FROM transactions WHERE id = ? AND userId = ?',
        [id, userId]
    );
    return result.changes > 0;
}

// For deduplication in email agent.
// Priority: ReferenceNumber match (definitive), then Reason+Amount+Category same-day match.
async function findDuplicateTransaction(userId, amount, category, datePrefix, reason, referenceNumber) {
    const db = await getDb();

    // If we have a ReferenceNumber, that is a globally unique identifier — check across ALL dates
    if (referenceNumber) {
        const byRef = await db.get(
            `SELECT * FROM transactions WHERE userId = ? AND ReferenceNumber = ?`,
            [userId, referenceNumber]
        );
        if (byRef) return withDisplayAmount(byRef);
    }

    // Fallback: exact Reason + Amount + Category on the same day
    return withDisplayAmount(await db.get(
        `SELECT * FROM transactions 
         WHERE userId = ? AND AmountMinor = ? AND Category = ? AND Timestamp LIKE ? AND Reason = ?`,
        [userId, toMinorUnits(amount), category, datePrefix + '%', reason]
    ));
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
        totalValueMinor: account.cashMinor + account.holdingsValueMinor,
        gainLossMinor: account.holdingsValueMinor - account.holdingsCostMinor,
        holdings: byAccount[account.id] || [],
    }));
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
               AND t.Category = 'Saving' AND t.Label IN ('Savings', 'Investment')
         ORDER BY t.Timestamp DESC
         LIMIT 20`,
        [userId]
    );
    return {
        totalValueMinor: accounts.reduce((sum, account) => sum + account.totalValueMinor, 0),
        totalCashMinor: accounts.reduce((sum, account) => sum + account.cashMinor, 0),
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
        `INSERT INTO investment_accounts (userId, name, institution, accountType, currency, cashMinor, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, account.name, account.institution || null, account.accountType, account.currency, account.cashMinor, now, now]
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
    WITHDRAWAL: -1,
});

async function applyEmailPortfolioActivity(userId, transactionId, activity = {}) {
    const { accountId, action, confidence, symbol, quantity, price } = activity;
    if (confidence !== 'HIGH' || !accountId || !action) return { status: 'ignored' };
    const isTrade = action === 'BUY' || action === 'SELL';
    if (!Object.hasOwn(emailCashActions, action) && !isTrade) {
        return { status: 'review_required', reason: 'Internal transfers require explicit destination details' };
    }

    const normalizedSymbol = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
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
    if (!source || source.Category !== 'Saving') return { status: 'ignored' };
    if (!['Savings', 'Investment'].includes(source.Label)) return { status: 'ignored' };

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

        const account = await db.get(
            'SELECT * FROM investment_accounts WHERE id = ? AND userId = ?',
            [accountId, userId]
        );
        if (!account) {
            await db.run('COMMIT');
            return { status: 'unmatched_account' };
        }

        const amountMinor = Number.isSafeInteger(source.AmountMinor)
            ? source.AmountMinor
            : toMinorUnits(source.Amount);
        const occurredAt = source.Timestamp || new Date().toISOString();

        if (!isTrade) {
            const nextCashMinor = account.cashMinor + (emailCashActions[action] * amountMinor);
            if (nextCashMinor < 0) {
                await db.run('COMMIT');
                return { status: 'review_required', reason: 'Withdrawal exceeds the recorded cash balance' };
            }

            await db.run(
                'UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ? AND userId = ?',
                [nextCashMinor, occurredAt, accountId, userId]
            );
            await db.run(
                'INSERT INTO portfolio_transactions (userId, accountId, sourceTransactionId, kind, amountMinor, occurredAt, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, accountId, transactionId, 'EMAIL_' + action, amountMinor, occurredAt, source.Reason || null]
            );
            await db.run('COMMIT');
            return { status: 'applied', accountId, action, amountMinor, cashMinor: nextCashMinor };
        }

        if (source.Label !== 'Investment') {
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
            [accountId, normalizedSymbol, userId]
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
                    userId, accountId, normalizedSymbol, holding?.name || null,
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
            [nextCashMinor, occurredAt, accountId, userId]
        );
        await db.run(
            `INSERT INTO portfolio_transactions
                (userId, accountId, sourceTransactionId, kind, amountMinor, symbol, quantity, priceMinor, priceMicros, occurredAt, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId, accountId, transactionId, 'EMAIL_' + action, amountMinor,
                normalizedSymbol, tradeQuantity, priceMinor, priceMicros, occurredAt, source.Reason || null,
            ]
        );
        await db.run('COMMIT');
        return {
            status: 'applied',
            accountId,
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

    const totals = await db.get(`
        SELECT
            SUM(CASE WHEN Category = 'Income'  THEN AmountMinor ELSE 0 END) as totalIncome,
            SUM(CASE WHEN Category = 'Expense' THEN AmountMinor ELSE 0 END) as totalExpenses,
            SUM(CASE WHEN Category = 'Saving'  THEN AmountMinor ELSE 0 END) as totalSavings
        FROM transactions WHERE userId = ?
    `, [userId]);

    const byLabel = await db.all(`
        SELECT Label, Category,
            SUM(AmountMinor) / 100.0 as total,
            COUNT(*) as count
        FROM transactions WHERE userId = ?
        GROUP BY Label, Category
        ORDER BY total DESC
    `, [userId]);

    const byMonth = await db.all(`
        SELECT
            strftime('%Y-%m', Timestamp) as month,
            SUM(CASE WHEN Category = 'Income'  THEN AmountMinor ELSE 0 END) / 100.0 as income,
            SUM(CASE WHEN Category = 'Expense' THEN AmountMinor ELSE 0 END) / 100.0 as expenses,
            SUM(CASE WHEN Category = 'Saving'  THEN AmountMinor ELSE 0 END) / 100.0 as savings,
            COUNT(*) as count
        FROM transactions WHERE userId = ?
        GROUP BY month
        ORDER BY month DESC
    `, [userId]);

    return {
        totalIncome:    (totals.totalIncome || 0) / 100,
        totalExpenses:  (totals.totalExpenses || 0) / 100,
        totalSavings:   (totals.totalSavings || 0) / 100,
        balance:        ((totals.totalIncome || 0) - (totals.totalExpenses || 0) - (totals.totalSavings || 0)) / 100,
        byLabel,
        byMonth
    };
}

async function isEmailProcessed(uid) {
    const db = await getDb();
    const row = await db.get('SELECT uid FROM processed_emails WHERE uid = ?', [uid]);
    return !!row;
}

async function markEmailProcessed(uid) {
    const db = await getDb();
    await db.run(
        'INSERT OR IGNORE INTO processed_emails (uid, processedAt) VALUES (?, ?)',
        [uid, new Date().toISOString()]
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

module.exports = {
    getDb,
    createUser,
    getUserByUsername,
    getUserById,
    getAllTransactionsForUser,
    addTransaction,
    getTransactionById,
    updateTransaction,
    updateTransactionForUser,
    deleteTransaction,
    findDuplicateTransaction,
    getAccountsForUser,
    trackAccount,
    getInvestmentAccounts,
    getPortfolioSummary,
    createInvestmentAccount,
    updateInvestmentAccount,
    deleteInvestmentAccount,
    upsertInvestmentHolding,
    deleteInvestmentHolding,
    applyEmailPortfolioActivity,
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
    isEmailProcessed,
    markEmailProcessed,
    saveMerchantRule,
    getMerchantRuleForReason,
    detectAndMarkRecurring
};
