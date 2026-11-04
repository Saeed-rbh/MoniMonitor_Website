const { getDb, withDatabaseTransaction } = require('./db');
const { accountMatchScore, transactionBalanceDelta } = require('../services/accountMatching');

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
        'INSERT INTO users (id, username, password, createdAt) VALUES (?, ?, ?, ?)',
        [id, username, hashedPassword, new Date().toISOString()]
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

async function updateUserProfilePhoto(userId, profilePhotoUrl) {
    const db = await getDb();
    await db.run(
        'UPDATE users SET profilePhotoUrl = ? WHERE id = ?',
        [profilePhotoUrl, userId]
    );
}

async function getAllTransactionsForUser(userId, filters = {}) {
    const db = await getDb();
    let query = `SELECT transactions.*, (SELECT p.kind FROM portfolio_transactions p
        WHERE p.sourceTransactionId = transactions.id AND p.userId = transactions.userId
        AND p.kind IN ('EMAIL_BUY', 'EMAIL_SELL') LIMIT 1) AS PortfolioPostingKind
        FROM transactions WHERE userId = ?`;
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
             PortfolioAccountId, PortfolioConfidence, PortfolioSymbol, PortfolioQuantity, PortfolioPrice, BalanceAccountId, BalanceAccountConfidence, TransferFromAccountId, TransferToAccountId, TransferConfidence, NotificationKind, PostingStatus, IngestionReviewReason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            transaction.TelegramMessageId || null,
            transaction.PortfolioAction || null,
            transaction.PortfolioAccountId || null,
            transaction.PortfolioConfidence || null,
            transaction.PortfolioSymbol || null,
            transaction.PortfolioQuantity || null,
            transaction.PortfolioPrice || null,
            transaction.BalanceAccountId || null,
            transaction.BalanceAccountConfidence || null,
            transaction.TransferFromAccountId || null,
            transaction.TransferToAccountId || null,
            transaction.TransferConfidence || null,
            transaction.NotificationKind || null,
            transaction.PostingStatus || null,
            transaction.IngestionReviewReason || null,
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

function mutationError(message) {
    return Object.assign(new Error(message), { status: 409 });
}

async function reversePortfolioActivity(userId, transactionId) {
    const db = await getDb();
    const entry = await db.get('SELECT * FROM portfolio_transactions WHERE userId = ? AND sourceTransactionId = ?', [userId, transactionId]);
    if (!entry) return;
    const action = entry.kind.replace('EMAIL_', '');
    const account = await db.get('SELECT * FROM investment_accounts WHERE userId = ? AND id = ?', [userId, entry.accountId]);
    if (!account) throw mutationError('The original portfolio account is missing');
    let cashDelta = 0;
    if (action === 'BUY' || action === 'SELL') {
        const current = await db.get('SELECT * FROM investment_holdings WHERE userId = ? AND accountId = ? AND symbol = ?', [userId, entry.accountId, entry.symbol]);
        const later = await db.all("SELECT * FROM portfolio_transactions WHERE userId = ? AND accountId = ? AND symbol = ? AND id > ? ORDER BY id", [userId, entry.accountId, entry.symbol, entry.id]);
        let holding;
        if (entry.holdingBefore !== null) {
            const last = later.at(-1) || entry;
            if (last.holdingAfter === null || JSON.stringify(current || null) !== last.holdingAfter) {
                throw mutationError('Holdings changed independently; reconcile them before changing this trade');
            }
            holding = JSON.parse(entry.holdingBefore);
        } else {
            // Older buys can be reversed algebraically when no subsequent security activity exists.
            if (action !== 'BUY' || later.length || !current) throw mutationError('Historical trade lacks cost-basis evidence needed for a safe reversal');
            const quantity = current.quantity - entry.quantity;
            if (quantity < -1e-9) throw mutationError('Reversal would leave negative shares');
            const cost = current.quantity * current.averageCostMicros - entry.quantity * (entry.priceMicros ?? entry.priceMinor * 10000);
            if (cost < -1) throw mutationError('Historical cost basis cannot be reversed safely');
            holding = quantity <= 1e-9 ? null : { ...current, quantity, averageCostMicros: Math.round(cost / quantity), averageCostMinor: Math.round(cost / quantity / 10000) };
        }
        for (const next of later) {
            if (!['EMAIL_BUY', 'EMAIL_SELL'].includes(next.kind)) throw mutationError('Subsequent asset activity requires reconciliation');
            const before = JSON.stringify(holding);
            const quantity = Number(holding?.quantity || 0);
            const priceMicros = next.priceMicros ?? next.priceMinor * 10000;
            if (next.kind === 'EMAIL_BUY') {
                const total = quantity + next.quantity;
                const average = Math.round((quantity * (holding?.averageCostMicros || 0) + next.quantity * priceMicros) / total);
                holding = { ...(holding || JSON.parse(next.holdingAfter)), quantity: total, averageCostMicros: average, averageCostMinor: Math.round(average / 10000), priceMicros, priceMinor: next.priceMinor, updatedAt: next.occurredAt };
            } else {
                if (quantity + 1e-9 < next.quantity) throw mutationError('Later sales depend on these shares');
                holding = quantity - next.quantity <= 1e-9 ? null : { ...holding, quantity: quantity - next.quantity, priceMicros, priceMinor: next.priceMinor, updatedAt: next.occurredAt };
            }
            await db.run('UPDATE portfolio_transactions SET holdingBefore = ?, holdingAfter = ? WHERE id = ?', [before, JSON.stringify(holding), next.id]);
        }
        await db.run('DELETE FROM investment_holdings WHERE userId = ? AND accountId = ? AND symbol = ?', [userId, entry.accountId, entry.symbol]);
        if (holding) {
            const keys = Object.keys(holding);
            await db.run(`INSERT INTO investment_holdings (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(holding));
        }
        cashDelta = action === 'BUY' ? entry.amountMinor : -entry.amountMinor;
    } else if (action === 'TRANSFER') {
        const destination = await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?', [entry.relatedAccountId, userId]);
        if (!destination || destination.cashMinor < entry.amountMinor) throw mutationError('Transfer reversal exceeds destination cash');
        await db.run('UPDATE investment_accounts SET cashMinor = cashMinor - ? WHERE id = ? AND userId = ?', [entry.amountMinor, destination.id, userId]);
        cashDelta = entry.amountMinor;
    } else if (emailCashActions[action]) {
        cashDelta = -emailCashActions[action] * entry.amountMinor;
    } else {
        throw mutationError('This asset movement requires reconciliation before deletion');
    }
    if (account.cashMinor + cashDelta < 0) throw mutationError('Reversal would leave negative cash');
    await db.run('UPDATE investment_accounts SET cashMinor = cashMinor + ?, updatedAt = ? WHERE id = ? AND userId = ?', [cashDelta, new Date().toISOString(), entry.accountId, userId]);
    await db.run('DELETE FROM portfolio_transactions WHERE id = ? AND userId = ?', [entry.id, userId]);
}

async function resolveManualCurrency(userId, input, accountId) {
    const db = await getDb();
    if (accountId) {
        const account = await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?', [accountId, userId]);
        if (!account) throw mutationError('Selected account does not belong to this user');
        if (input.Currency && input.Currency !== account.currency) throw mutationError('Transaction currency must match the selected account');
        return { ...input, Currency: account.currency, Account: account.accountRef || account.name, BankName: account.institution || input.BankName };
    }
    const settings = await getUserSettings(userId);
    return { ...input, Currency: input.Currency || settings?.currency || 'USD' };
}

async function createManualTransaction(userId, input, accountId) {
    return withDatabaseTransaction(async () => {
        const transaction = await resolveManualCurrency(userId, input, accountId);
        const id = await addTransaction({ ...transaction, userId, BalanceAccountId: accountId, BalanceAccountConfidence: accountId ? 'HIGH' : null });
        const accountPosting = await syncTransactionAccountBalance(userId, id, { accountId, confidence: accountId ? 'HIGH' : null });
        if (accountId && accountPosting.status !== 'applied' && accountPosting.status !== 'not_balance_posting') throw mutationError(accountPosting.reason || 'Transaction could not be posted to the selected account');
        return { data: await getTransactionById(id, userId), accountPosting };
    });
}

async function editTransaction(userId, id, updates, preferred = {}) {
    return withDatabaseTransaction(async () => {
        const existing = await getTransactionById(id, userId);
        if (!existing) return null;
        if (preferred.accountId) updates = await resolveManualCurrency(userId, updates, preferred.accountId);
        const db = await getDb();
        const portfolio = await db.get('SELECT * FROM portfolio_transactions WHERE userId = ? AND sourceTransactionId = ?', [userId, id]);
        const financial = ['Amount', 'Currency', 'Category', 'Label', 'Timestamp', 'Account', 'BankName', 'Type'].some(key => updates[key] !== undefined && updates[key] !== existing[key]) || Boolean(preferred.accountId);
        if (portfolio && financial && portfolio.symbol) {
            const later = await db.get('SELECT id FROM portfolio_transactions WHERE userId = ? AND accountId = ? AND symbol = ? AND id > ?', [userId, portfolio.accountId, portfolio.symbol, portfolio.id]);
            if (later) throw mutationError('Later security activity exists; correct those trades before editing this trade');
        }
        if (portfolio && financial) await reversePortfolioActivity(userId, id);
        await updateTransactionForUser(id, userId, updates);
        let accountPosting;
        if (portfolio && financial) {
            const tx = await getTransactionById(id, userId);
            accountPosting = await applyEmailPortfolioActivity(userId, id, {
                accountId: preferred.accountId || portfolio.accountId, confidence: 'HIGH',
                action: existing.PortfolioAction || portfolio.kind.replace('EMAIL_', ''),
                symbol: existing.PortfolioSymbol || portfolio.symbol,
                quantity: existing.PortfolioQuantity || portfolio.quantity,
                price: existing.PortfolioPrice || (portfolio.priceMicros ?? portfolio.priceMinor * 10000) / 1000000,
                fromAccountId: tx.TransferFromAccountId, toAccountId: tx.TransferToAccountId, transferConfidence: tx.TransferConfidence,
            });
            if (accountPosting.status !== 'applied') throw mutationError(accountPosting.reason || 'Edited portfolio activity could not be posted');
        } else if (!portfolio) {
            accountPosting = await syncTransactionAccountBalance(userId, id, preferred);
            if (['review_required', 'unmatched_account', 'ambiguous_account'].includes(accountPosting.status)) throw mutationError(accountPosting.reason || 'Edited transaction could not be posted');
        } else accountPosting = { status: 'unchanged' };
        return { data: await getTransactionById(id, userId), accountPosting };
    });
}

async function deleteTransaction(id, userId) {
    const db = await getDb();
    await reversePortfolioActivity(userId, id);
    await removeTransactionAccountBalance(userId, id);
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
    for (const account of accounts) {
        if ((byAccount[account.id] || []).some(holding => holding.currency !== account.currency)) {
            throw mutationError(`Holdings currency does not match account ${account.name}; correct the holding currency before valuation`);
        }
    }
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

        if (!preferred.accountId && transaction.BalanceAccountId) {
            preferred = { accountId: transaction.BalanceAccountId, confidence: transaction.BalanceAccountConfidence };
        }
        if (transaction.PostingStatus === 'pending' || transaction.IngestionReviewReason) {
            await db.run('COMMIT');
            return { status: 'review_required', reason: transaction.IngestionReviewReason || 'Awaiting settled bank evidence' };
        }
        const existing = await db.get(
            'SELECT * FROM account_balance_events WHERE sourceTransactionId = ? AND userId = ?',
            [transactionId, userId]
        );
        if (existing) {
            preferred = { accountId: existing.accountId, confidence: 'HIGH', ...Object.fromEntries(Object.entries(preferred).filter(([, value]) => value != null)) };
            await db.run(
                'UPDATE investment_accounts SET cashMinor = cashMinor - ?, updatedAt = ? WHERE id = ? AND userId = ?',
                [existing.deltaMinor, new Date().toISOString(), existing.accountId, userId]
            );
            await db.run('DELETE FROM account_balance_events WHERE id = ? AND userId = ?', [existing.id, userId]);
        }

        if (transaction.Category === 'Saving' && transaction.PortfolioAction) {
            await db.run('COMMIT');
            return { status: 'not_balance_posting' };
        }
        const accounts = await db.all('SELECT * FROM investment_accounts WHERE userId = ?', [userId]);
        const ranked = accounts
            .map((account) => ({
                account,
                score: accountMatchScore(transaction, account, preferred.accountId, preferred.confidence),
            }))
            .filter(({ score, account }) => score > 0 && account.currency === transaction.Currency)
            .sort((a, b) => b.score - a.score);
        const best = ranked[0];
        if (!best || best.score < 80 || (ranked[1] && ranked[1].score === best.score)) {
            if (existing) throw new Error('Account reassignment is ambiguous; previous posting preserved');
            await db.run('COMMIT');
            return { status: ranked.length ? 'ambiguous_account' : 'unmatched_account' };
        }

        const amountMinor = Number.isSafeInteger(transaction.AmountMinor)
            ? transaction.AmountMinor
            : toMinorUnits(transaction.Amount);
        const deltaMinor = transactionBalanceDelta(transaction, best.account, amountMinor);
        if (deltaMinor === null) {
            await db.run('COMMIT');
            return { status: 'not_balance_posting' };
        }
        const nextCashMinor = Number(best.account.cashMinor) + deltaMinor;
        if (nextCashMinor < 0) {
            if (existing) throw new Error('Account reassignment would make balance negative; previous posting preserved');
            await db.run('COMMIT');
            return { status: 'review_required', reason: 'Transaction would make the account balance negative' };
        }

        const occurredAt = transaction.Timestamp || new Date().toISOString();
        await db.run(
            'UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ? AND userId = ?',
            [nextCashMinor, occurredAt, best.account.id, userId]
        );
        await db.run(
            `INSERT INTO account_balance_events
                (userId, accountId, sourceTransactionId, deltaMinor, occurredAt)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, best.account.id, transactionId, deltaMinor, occurredAt]
        );
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
                'UPDATE investment_accounts SET cashMinor = cashMinor - ?, updatedAt = ? WHERE id = ? AND userId = ?',
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
         WHERE userId = ? AND id NOT IN (
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
         WHERE userId = ? AND Category = 'Saving' AND PortfolioAction IS NOT NULL
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
               AND t.Category = 'Saving' AND t.Label IN ('Savings', 'Investment')
         ORDER BY t.Timestamp DESC
         LIMIT 20`,
        [userId]
    );
    const totalsByCurrency = Object.values(accounts.reduce((groups, account) => {
        const totals = groups[account.currency] ||= {
            currency: account.currency, totalValueMinor: 0, totalCashMinor: 0,
            totalLiabilitiesMinor: 0, holdingsValueMinor: 0, holdingsCostMinor: 0, gainLossMinor: 0,
        };
        totals.totalValueMinor += account.totalValueMinor;
        totals.totalCashMinor += account.accountType === 'Credit Card' ? 0 : account.cashMinor;
        totals.totalLiabilitiesMinor += account.accountType === 'Credit Card' ? account.cashMinor : 0;
        totals.holdingsValueMinor += account.holdingsValueMinor;
        totals.holdingsCostMinor += account.holdingsCostMinor;
        totals.gainLossMinor += account.gainLossMinor;
        return groups;
    }, {})).sort((a, b) => a.currency.localeCompare(b.currency));
    // Legacy scalar totals are meaningful only for a single currency.
    const single = totalsByCurrency.length === 1 ? totalsByCurrency[0] : null;
    return {
        ...Object.fromEntries(['totalValueMinor', 'totalCashMinor', 'totalLiabilitiesMinor',
            'holdingsValueMinor', 'holdingsCostMinor', 'gainLossMinor']
            .map(key => [key, single ? single[key] : accounts.length ? null : 0])),
        currency: single?.currency || null,
        totalsByCurrency,
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
    const existing = await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?', [id, userId]);
    if (!existing) return null;
    if (updates.currency && updates.currency !== existing.currency) {
        const activity = await db.get(`SELECT (SELECT COUNT(*) FROM investment_holdings WHERE accountId = ?) +
            (SELECT COUNT(*) FROM portfolio_transactions WHERE accountId = ? OR relatedAccountId = ?) +
            (SELECT COUNT(*) FROM account_balance_events WHERE accountId = ?) AS count`, [id, id, id, id]);
        if (existing.cashMinor || activity.count) throw mutationError('Cannot change currency on a funded account or an account with financial history');
    }
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
    const account = await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?', [accountId, userId]);
    if (!account) return null;
    if (holding.currency !== account.currency) throw mutationError('Holding currency must match the account currency');
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
    if (!action) return { status: 'ignored' };
    const isTrade = action === 'BUY' || action === 'SELL';
    if (!Object.hasOwn(emailCashActions, action) && !isTrade && action !== 'TRANSFER' && !['ASSET_TRANSFER_IN','ASSET_TRANSFER_OUT'].includes(action)) {
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
    if (source?.IngestionReviewReason || source?.PostingStatus === 'pending') return { status: 'review_required', reason: source.IngestionReviewReason || 'Awaiting settled evidence' };
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

        if (['ASSET_TRANSFER_IN','ASSET_TRANSFER_OUT'].includes(action)) {
            const assetAccount = confidence === 'HIGH' ? await db.get(
                'SELECT * FROM investment_accounts WHERE id = ? AND userId = ?', [accountId,userId]) : null;
            if (!assetAccount || assetAccount.currency !== source.Currency || !/^[A-Z0-9.\-]{1,15}$/.test(normalizedSymbol) ||
                !Number.isFinite(tradeQuantity) || tradeQuantity <= 0) {
                await db.run('COMMIT');
                return { status: 'review_required', reason: 'Security transfer needs an explicit account, symbol, and quantity' };
            }
            if (action === 'ASSET_TRANSFER_IN') {
                await db.run('COMMIT');
                return { status: 'review_required', reason: 'Incoming security transfer requires cost-basis evidence; cash is unaffected' };
            }
            const holding = await db.get('SELECT * FROM investment_holdings WHERE accountId = ? AND symbol = ?', [accountId,normalizedSymbol]);
            const quantity = Number(holding?.quantity || 0) + (action === 'ASSET_TRANSFER_IN' ? tradeQuantity : -tradeQuantity);
            if (quantity < -1e-9) { await db.run('COMMIT'); return { status: 'review_required', reason: 'Security transfer exceeds recorded holdings' }; }
            if (!holding && action === 'ASSET_TRANSFER_IN') {
                // Transfer emails do not establish cost basis. Do not fabricate a holding with zero acquisition cost.
                await db.run('COMMIT');
                return { status: 'review_required', reason: 'Security transfer cost basis is unknown; cash is unaffected' };
            }
            await db.run('UPDATE investment_holdings SET quantity = ?, updatedAt = ? WHERE id = ?', [Math.max(0,quantity),source.Timestamp,holding.id]);
            await db.run(`INSERT INTO portfolio_transactions (userId,accountId,sourceTransactionId,kind,amountMinor,symbol,quantity,occurredAt,note)
                VALUES (?,?,?, ?,0,?,?,?,?)`, [userId,accountId,transactionId,'EMAIL_'+action,normalizedSymbol,tradeQuantity,source.Timestamp,'Asset movement; cost basis requires independent evidence']);
            await db.run('COMMIT');
            return { status: 'applied', accountId, action, amountMinor: 0 };
        }
        if (action === 'TRANSFER') {
            const fromId = Number(activity.fromAccountId || source.TransferFromAccountId);
            const toId = Number(activity.toAccountId || source.TransferToAccountId);
            const transferConfidence = activity.transferConfidence || source.TransferConfidence;
            if (transferConfidence !== 'HIGH' || !fromId || !toId || fromId === toId) {
                await db.run('COMMIT');
                return { status: 'review_required', reason: 'Transfer requires two distinct, explicitly identified owned accounts and direction' };
            }
            const from = await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?', [fromId, userId]);
            const to = await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?', [toId, userId]);
            if (!from || !to || from.currency !== source.Currency || to.currency !== source.Currency ||
                from.accountType === 'Credit Card' || to.accountType === 'Credit Card') {
                await db.run('COMMIT');
                return { status: 'review_required', reason: 'Transfer endpoints must be owned cash accounts in the transaction currency' };
            }
            const amountMinor = source.AmountMinor;
            // A second bank notification can describe the other side of the same transfer.
            if (source.ReferenceNumber) {
                const matching = await db.get(`SELECT p.id FROM portfolio_transactions p JOIN transactions t ON t.id = p.sourceTransactionId
                    WHERE p.userId = ? AND p.kind = 'EMAIL_TRANSFER' AND p.accountId = ? AND p.relatedAccountId = ?
                    AND p.amountMinor = ? AND t.ReferenceNumber = ? AND t.Currency = ?`,
                    [userId, fromId, toId, amountMinor, source.ReferenceNumber, source.Currency]);
                if (matching) { await db.run('COMMIT'); return { status: 'duplicate' }; }
            }
            if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || from.cashMinor < amountMinor) {
                await db.run('COMMIT');
                return { status: 'review_required', reason: 'Transfer exceeds recorded source cash or has invalid amount' };
            }
            await db.run('UPDATE investment_accounts SET cashMinor = cashMinor - ?, updatedAt = ? WHERE id = ?', [amountMinor, source.Timestamp, fromId]);
            await db.run('UPDATE investment_accounts SET cashMinor = cashMinor + ?, updatedAt = ? WHERE id = ?', [amountMinor, source.Timestamp, toId]);
            await db.run(`INSERT INTO portfolio_transactions
                (userId, accountId, relatedAccountId, sourceTransactionId, kind, amountMinor, occurredAt, note)
                VALUES (?, ?, ?, ?, 'EMAIL_TRANSFER', ?, ?, ?)`,
                [userId, fromId, toId, transactionId, amountMinor, source.Timestamp, source.Reason]);
            await db.run('COMMIT');
            return { status: 'applied', accountId: fromId, destinationAccountId: toId, action, amountMinor };
        }

        let resolvedAccountId = confidence === 'HIGH' ? Number(accountId) : null;
        if (!resolvedAccountId) {
            const investmentTypes = new Set(['TFSA', 'RRSP', 'Brokerage', '401(k)', 'IRA']);
            const candidates = (await db.all('SELECT * FROM investment_accounts WHERE userId = ?', [userId]))
                .filter((candidate) => !isTrade || investmentTypes.has(candidate.accountType))
                .map((candidate) => ({
                    account: candidate,
                    score: accountMatchScore(source, candidate, null, null),
                }))
                .filter(({ score, account }) => score >= 80 && account.currency === source.Currency)
                .sort((a, b) => b.score - a.score);
            if (candidates.length === 1 || (candidates[0] && candidates[1] && candidates[0].score > candidates[1].score)) {
                resolvedAccountId = candidates[0].account.id;
            }
        }

        const account = resolvedAccountId ? await db.get(
            'SELECT * FROM investment_accounts WHERE id = ? AND userId = ?',
            [resolvedAccountId, userId]
        ) : null;
        if (!account || account.currency !== source.Currency) {
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
                [nextCashMinor, occurredAt, resolvedAccountId, userId]
            );
            await db.run(
                'INSERT INTO portfolio_transactions (userId, accountId, sourceTransactionId, kind, amountMinor, occurredAt, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, resolvedAccountId, transactionId, 'EMAIL_' + action, amountMinor, occurredAt, source.Reason || null]
            );
            await db.run('COMMIT');
            return { status: 'applied', accountId: resolvedAccountId, action, amountMinor, cashMinor: nextCashMinor };
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
        const afterHolding = await db.get('SELECT * FROM investment_holdings WHERE userId = ? AND accountId = ? AND symbol = ?', [userId, resolvedAccountId, normalizedSymbol]);
        await db.run('UPDATE portfolio_transactions SET holdingBefore = ?, holdingAfter = ? WHERE sourceTransactionId = ? AND userId = ?', [JSON.stringify(holding || null), JSON.stringify(afterHolding || null), transactionId, userId]);
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

async function getSummaryForUser(userId, currency) {
    if (!currency) {
        const db = await getDb();
        const currencies = await db.all('SELECT DISTINCT Currency FROM transactions WHERE userId = ? ORDER BY Currency', [userId]);
        const totalsByCurrency = await Promise.all(currencies.map(row => getSummaryForUser(userId, row.Currency)));
        const single = totalsByCurrency.length === 1 ? totalsByCurrency[0] : null;
        const empty = { totalIncome: currencies.length ? null : 0, totalExpenses: currencies.length ? null : 0,
            totalSavings: currencies.length ? null : 0, balance: currencies.length ? null : 0, byLabel: [], byMonth: [], currency: null };
        return { ...(single || empty), totalsByCurrency };
    }
    const db = await getDb();

    const totals = await db.get(`
        SELECT
            SUM(CASE WHEN Category = 'Income'  THEN AmountMinor ELSE 0 END) as totalIncome,
            SUM(CASE WHEN Category = 'Expense' THEN AmountMinor ELSE 0 END) as totalExpenses,
            SUM(CASE WHEN Category = 'Saving'  THEN AmountMinor ELSE 0 END) as totalSavings
        FROM transactions WHERE userId = ? AND Currency = ?
            AND COALESCE(PortfolioAction, '') NOT IN ('TRANSFER', 'BUY', 'SELL')
            AND NOT EXISTS (SELECT 1 FROM portfolio_transactions p
                WHERE p.sourceTransactionId = transactions.id AND p.userId = transactions.userId
                  AND p.kind IN ('EMAIL_BUY', 'EMAIL_SELL'))
            AND Category <> 'Transfer'
            AND NOT (COALESCE(TransferFromAccountId, 0) > 0
                AND COALESCE(TransferToAccountId, 0) > 0
                AND TransferFromAccountId <> TransferToAccountId)
    `, [userId, currency]);

    const byLabel = await db.all(`
        SELECT Label, Category,
            SUM(AmountMinor) / 100.0 as total,
            COUNT(*) as count
        FROM transactions WHERE userId = ? AND Currency = ?
            AND COALESCE(PortfolioAction, '') NOT IN ('TRANSFER', 'BUY', 'SELL')
            AND NOT EXISTS (SELECT 1 FROM portfolio_transactions p
                WHERE p.sourceTransactionId = transactions.id AND p.userId = transactions.userId
                  AND p.kind IN ('EMAIL_BUY', 'EMAIL_SELL'))
            AND Category <> 'Transfer'
            AND NOT (COALESCE(TransferFromAccountId, 0) > 0
                AND COALESCE(TransferToAccountId, 0) > 0
                AND TransferFromAccountId <> TransferToAccountId)
        GROUP BY Label, Category
        ORDER BY total DESC
    `, [userId, currency]);

    const byMonth = await db.all(`
        SELECT
            strftime('%Y-%m', Timestamp) as month,
            SUM(CASE WHEN Category = 'Income'  THEN AmountMinor ELSE 0 END) / 100.0 as income,
            SUM(CASE WHEN Category = 'Expense' THEN AmountMinor ELSE 0 END) / 100.0 as expenses,
            SUM(CASE WHEN Category = 'Saving'  THEN AmountMinor ELSE 0 END) / 100.0 as savings,
            COUNT(*) as count
        FROM transactions WHERE userId = ? AND Currency = ?
            AND COALESCE(PortfolioAction, '') NOT IN ('TRANSFER', 'BUY', 'SELL')
            AND NOT EXISTS (SELECT 1 FROM portfolio_transactions p
                WHERE p.sourceTransactionId = transactions.id AND p.userId = transactions.userId
                  AND p.kind IN ('EMAIL_BUY', 'EMAIL_SELL'))
            AND Category <> 'Transfer'
            AND NOT (COALESCE(TransferFromAccountId, 0) > 0
                AND COALESCE(TransferToAccountId, 0) > 0
                AND TransferFromAccountId <> TransferToAccountId)
        GROUP BY month
        ORDER BY month DESC
    `, [userId, currency]);

    return {
        currency,
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
    updateUserProfilePhoto,
    getAllTransactionsForUser,
    addTransaction,
    getTransactionById,
    updateTransaction,
    updateTransactionForUser,
    editTransaction,
    createManualTransaction,
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
    isEmailProcessed,
    markEmailProcessed,
    saveMerchantRule,
    getMerchantRuleForReason,
    detectAndMarkRecurring
};

// Posting transactions must never share a connection with unrelated asynchronous requests.
for (const name of ['syncTransactionAccountBalance', 'removeTransactionAccountBalance',
    'applyEmailPortfolioActivity', 'deleteTransaction', 'deleteInvestmentAccount']) {
    const operation = module.exports[name];
    module.exports[name] = (...args) => withDatabaseTransaction(() => operation(...args));
}
