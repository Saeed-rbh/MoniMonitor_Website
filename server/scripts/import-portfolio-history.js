require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getDb } = require('../src/database/db');
const { accountMatchScore, transactionBalanceDelta } = require('../src/services/accountMatching');
const { CATEGORY_LABELS } = require('../src/services/transactionCategories');

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const replaceAll = process.argv.includes('--replace-all');
const dedupeExact = process.argv.includes('--dedupe-exact');
if (!inputPath) throw new Error('Usage: node scripts/import-portfolio-history.js <transactions.json>');
if (!process.env.USER_ID) throw new Error('USER_ID is required');

let rows = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!Array.isArray(rows) || !rows.length) throw new Error('The transaction file must be a non-empty JSON array');

if (replaceAll) {
    for (const row of rows) {
        if (row.Category === 'Saving' && row.Label === 'Savings Withdrawals' &&
            /^Transfer from .*savings$/i.test(String(row.Reason || '').trim())) {
            row.Category = 'Internal';
            row.Label = 'Internal Transfer';
        }
    }
}

if (dedupeExact) {
    const normalizeIdentityPart = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const seen = new Set();
    const before = rows.length;
    rows = rows.filter((row) => {
        const key = [
            Number(row.Amount), row.Category, normalizeIdentityPart(row.Label),
            normalizeIdentityPart(row.Reason), new Date(row.Timestamp).toISOString(),
            normalizeIdentityPart(row.Account), normalizeIdentityPart(row.BankName),
            normalizeIdentityPart(row.ReferenceNumber), normalizeIdentityPart(row.PortfolioAction),
            normalizeIdentityPart(row.PortfolioSymbol), row.PortfolioQuantity ?? '',
            row.PortfolioPrice ?? '', normalizeIdentityPart(row.PortfolioToSymbol),
            row.PortfolioToQuantity ?? '', normalizeIdentityPart(row.AccountFlow),
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    console.log(`Removed ${before - rows.length} exact duplicate transaction row(s) before import.`);
}

const requiredFields = ['Amount', 'Category', 'Timestamp'];
for (const [index, row] of rows.entries()) {
    for (const field of requiredFields) {
        if (row[field] === undefined || row[field] === null || row[field] === '') {
            throw new Error(`Row ${index + 1} is missing ${field}`);
        }
    }
    if (!Number.isFinite(Number(row.Amount)) || Number(row.Amount) < 0) {
        throw new Error(`Row ${index + 1} has an invalid Amount`);
    }
    if (Number.isNaN(new Date(row.Timestamp).getTime())) {
        throw new Error(`Row ${index + 1} has an invalid Timestamp`);
    }
    if (replaceAll && !CATEGORY_LABELS[row.Category]?.includes(row.Label)) {
        throw new Error(`Row ${index + 1} has invalid category/label pair: ${row.Category} / ${row.Label}`);
    }
}

const toMinor = (amount) => Math.round(Number(amount || 0) * 100);
const normalizedSymbol = (value) => String(value || '').trim().toUpperCase();

function applyQuantity(position, delta) {
    if (!Number.isFinite(delta) || Math.abs(delta) <= 1e-12) return 0;
    const previousQuantity = position.quantity;
    const removedCost = delta < 0 && previousQuantity > 0
        ? position.costMinor * Math.min(1, Math.abs(delta) / previousQuantity)
        : 0;
    position.quantity += delta;
    position.costMinor -= removedCost;
    const roundingTolerance = Math.max(1e-7, Math.abs(previousQuantity) * 1e-6);
    if (Math.abs(position.quantity) <= roundingTolerance) {
        position.quantity = 0;
        position.costMinor = 0;
    }
    return removedCost;
}

function accountKind(transaction, tfsaAccountId, cryptoAccountId, tfsaSymbols, cryptoSymbols) {
    const account = String(transaction.Account || '').toLowerCase();
    if (account.includes('tfsa') || Number(transaction.PortfolioAccountId) === tfsaAccountId) return 'TFSA';
    if (account.includes('crypto') || Number(transaction.PortfolioAccountId) === cryptoAccountId) return 'Crypto';
    const symbol = normalizedSymbol(transaction.PortfolioSymbol);
    if (symbol && tfsaSymbols.has(symbol) && !cryptoSymbols.has(symbol)) return 'TFSA';
    if (symbol && cryptoSymbols.has(symbol) && !tfsaSymbols.has(symbol)) return 'Crypto';
    return null;
}

async function main() {
    const db = await getDb();
    const userId = String(process.env.USER_ID);
    await db.run('BEGIN IMMEDIATE');
    try {
        const now = new Date().toISOString();
        let tfsa = await db.get(
            `SELECT * FROM investment_accounts
             WHERE userId = ? AND accountType = 'TFSA'
             ORDER BY CASE WHEN name = 'TFSA' THEN 0 ELSE 1 END, id LIMIT 1`,
            [userId]
        );
        if (!tfsa) {
            const result = await db.run(
                `INSERT INTO investment_accounts
                    (userId, name, institution, accountType, accountRef, currency, cashMinor, createdAt, updatedAt)
                 VALUES (?, 'TFSA', 'Wealthsimple', 'TFSA', 'HQ656S0K7CAD', 'CAD', 0, ?, ?)`,
                [userId, now, now]
            );
            tfsa = await db.get('SELECT * FROM investment_accounts WHERE id = ?', [result.lastID]);
        }
        await db.run(
            `UPDATE investment_accounts
             SET name = 'TFSA', institution = 'Wealthsimple', accountType = 'TFSA',
                 accountRef = 'HQ656S0K7CAD', currency = 'CAD'
             WHERE id = ? AND userId = ?`,
            [tfsa.id, userId]
        );

        let crypto = await db.get(
            `SELECT * FROM investment_accounts
             WHERE userId = ? AND (accountType = 'Crypto' OR name = 'Crypto') ORDER BY id LIMIT 1`,
            [userId]
        );
        if (!crypto) {
            const result = await db.run(
                `INSERT INTO investment_accounts
                    (userId, name, institution, accountType, accountRef, currency, cashMinor, createdAt, updatedAt)
                 VALUES (?, 'Crypto', 'Wealthsimple', 'Crypto', 'HQ5YZLZ12CAD', 'CAD', 0, ?, ?)`,
                [userId, now, now]
            );
            crypto = await db.get('SELECT * FROM investment_accounts WHERE id = ?', [result.lastID]);
        }

        if (replaceAll) {
            await db.run('DELETE FROM account_balance_events WHERE userId = ?', [userId]);
            await db.run('DELETE FROM portfolio_transactions WHERE userId = ?', [userId]);
            await db.run('DELETE FROM investment_holdings WHERE userId = ?', [userId]);
            await db.run('DELETE FROM transactions WHERE userId = ?', [userId]);
        } else {
            const historicalIds = await db.all(
                'SELECT id FROM transactions WHERE userId = ? AND ReceivedAt IS NULL',
                [userId]
            );
            if (historicalIds.length) {
                const ids = historicalIds.map((row) => row.id);
                const placeholders = ids.map(() => '?').join(',');
                await db.run(`DELETE FROM account_balance_events WHERE sourceTransactionId IN (${placeholders})`, ids);
                await db.run(`DELETE FROM portfolio_transactions WHERE sourceTransactionId IN (${placeholders})`, ids);
            }
            await db.run('DELETE FROM transactions WHERE userId = ? AND ReceivedAt IS NULL', [userId]);
        }

        const insertSql = `INSERT INTO transactions
            (userId, Amount, AmountMinor, Currency, Category, Label, Reason, Timestamp, ReceivedAt,
             Type, Account, BankName, ReferenceNumber, Frequency, TelegramMessageId,
             PortfolioAction, PortfolioAccountId, PortfolioConfidence, PortfolioSymbol,
             PortfolioQuantity, PortfolioPrice, BalanceAccountConfidence, PortfolioAccountNumber,
             PortfolioToSymbol, PortfolioToQuantity, AccountFlow)
             VALUES (?, ?, ?, 'CAD', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        for (const row of rows) {
            const portfolioAccountId = row.Account === 'TFSA'
                ? tfsa.id
                : row.Account === 'Crypto'
                    ? crypto.id
                    : null;
            await db.run(insertSql, [
                userId, Number(row.Amount), toMinor(row.Amount), row.Category,
                row.Label ?? null, row.Reason ?? null, new Date(row.Timestamp).toISOString(),
                row.Type ?? null, row.Account ?? null, row.BankName ?? null,
                row.ReferenceNumber ?? null, row.Frequency || 'OneTime',
                row.PortfolioAction ?? null, portfolioAccountId,
                row.PortfolioConfidence ?? null, row.PortfolioSymbol ?? null,
                row.PortfolioQuantity ?? null, row.PortfolioPrice ?? null,
                row.BalanceAccountConfidence ?? null, row.PortfolioAccountNumber ?? null,
                row.PortfolioToSymbol ?? null, row.PortfolioToQuantity ?? null,
                row.AccountFlow ?? null,
            ]);
        }

        const portfolioAccountIds = [tfsa.id, crypto.id];
        await db.run(
            `DELETE FROM portfolio_transactions WHERE userId = ? AND accountId IN (?, ?)`,
            [userId, ...portfolioAccountIds]
        );
        await db.run(
            `DELETE FROM investment_holdings WHERE userId = ? AND accountId IN (?, ?)`,
            [userId, ...portfolioAccountIds]
        );

        const allTransactions = await db.all(
            `SELECT * FROM transactions WHERE userId = ? ORDER BY Timestamp ASC, id ASC`,
            [userId]
        );
        const ledgerAccounts = await db.all(
            `SELECT * FROM investment_accounts
             WHERE userId = ? AND accountType NOT IN ('TFSA', 'Crypto')`,
            [userId]
        );
        const ledgerState = new Map(ledgerAccounts.map((account) => [account.id, {
            account,
            cashMinor: 0,
            updatedAt: null,
        }]));
        const accountState = new Map([
            ['TFSA', { id: tfsa.id, cashMinor: 0, positions: new Map(), updatedAt: null }],
            ['Crypto', { id: crypto.id, cashMinor: 0, positions: new Map(), updatedAt: null }],
        ]);
        const tfsaSymbols = new Set(rows.filter((row) => row.Account === 'TFSA').map((row) => normalizedSymbol(row.PortfolioSymbol)).filter(Boolean));
        const cryptoSymbols = new Set(rows.filter((row) => row.Account === 'Crypto').map((row) => normalizedSymbol(row.PortfolioSymbol)).filter(Boolean));

        const positionFor = (state, symbol) => {
            if (!state.positions.has(symbol)) {
                state.positions.set(symbol, {
                    symbol, quantity: 0, costMinor: 0, priceMicros: 0, updatedAt: null,
                });
            }
            return state.positions.get(symbol);
        };

        await db.run('DELETE FROM account_balance_events WHERE userId = ?', [userId]);

        for (const transaction of allTransactions) {
            const rankedLedgerAccounts = ledgerAccounts
                .map((account) => ({ account, score: accountMatchScore(transaction, account) }))
                .filter(({ score }) => score > 0)
                .sort((a, b) => b.score - a.score);
            const ledgerMatch = rankedLedgerAccounts[0];
            if (ledgerMatch && ledgerMatch.score >= 30 &&
                (!rankedLedgerAccounts[1] || rankedLedgerAccounts[1].score !== ledgerMatch.score)) {
                const ledger = ledgerState.get(ledgerMatch.account.id);
                const deltaMinor = transactionBalanceDelta(transaction, ledgerMatch.account, Number(transaction.AmountMinor || 0));
                if (deltaMinor !== null) {
                    ledger.cashMinor += deltaMinor;
                    ledger.updatedAt = transaction.Timestamp;
                    await db.run(
                        `INSERT INTO account_balance_events
                            (userId, accountId, sourceTransactionId, deltaMinor, occurredAt)
                         VALUES (?, ?, ?, ?, ?)`,
                        [userId, ledgerMatch.account.id, transaction.id, deltaMinor, transaction.Timestamp]
                    );
                }
            }

            const kind = accountKind(transaction, tfsa.id, crypto.id, tfsaSymbols, cryptoSymbols);
            if (!kind) continue;
            const state = accountState.get(kind);
            const amountMinor = Number(transaction.AmountMinor || 0);
            const action = transaction.PortfolioAction;
            const flow = transaction.AccountFlow;
            state.updatedAt = transaction.Timestamp;

            if (flow === 'IN') state.cashMinor += amountMinor;
            else if (flow === 'OUT') state.cashMinor -= amountMinor;
            else if (!flow && action === 'BUY') state.cashMinor -= amountMinor;
            else if (!flow && ['SELL', 'DIVIDEND', 'INTEREST', 'REIMBURSEMENT', 'CONTRIBUTION', 'DEPOSIT'].includes(action)) state.cashMinor += amountMinor;
            else if (!flow && ['WITHDRAWAL', 'FEE', 'TAX'].includes(action)) state.cashMinor -= amountMinor;

            const symbol = normalizedSymbol(transaction.PortfolioSymbol);
            const quantity = Number(transaction.PortfolioQuantity);
            const price = Number(transaction.PortfolioPrice);
            if (symbol && Number.isFinite(price) && price > 0) {
                positionFor(state, symbol).priceMicros = Math.round(price * 1000000);
            }

            if (action === 'BUY' && symbol && Number.isFinite(quantity) && quantity > 0) {
                const position = positionFor(state, symbol);
                position.quantity += quantity;
                position.costMinor += amountMinor;
                position.updatedAt = transaction.Timestamp;
            } else if (action === 'SELL' && symbol && Number.isFinite(quantity) && quantity > 0) {
                const position = positionFor(state, symbol);
                applyQuantity(position, -quantity);
                position.updatedAt = transaction.Timestamp;
            } else if (action === 'REWARD' && symbol && Number.isFinite(quantity)) {
                const position = positionFor(state, symbol);
                applyQuantity(position, Math.abs(quantity));
                position.updatedAt = transaction.Timestamp;
            } else if (action === 'DISTRIBUTION' && symbol && Number.isFinite(quantity)) {
                const position = positionFor(state, symbol);
                applyQuantity(position, quantity);
                position.updatedAt = transaction.Timestamp;
            } else if (action === 'FEE' && symbol && Number.isFinite(quantity)) {
                const position = positionFor(state, symbol);
                applyQuantity(position, -Math.abs(quantity));
                position.updatedAt = transaction.Timestamp;
            } else if (action === 'SWAP' && symbol && Number.isFinite(quantity)) {
                const fromPosition = positionFor(state, symbol);
                const transferredCost = applyQuantity(fromPosition, -Math.abs(quantity));
                fromPosition.updatedAt = transaction.Timestamp;
                const toSymbol = normalizedSymbol(transaction.PortfolioToSymbol);
                const toQuantity = Number(transaction.PortfolioToQuantity);
                if (!toSymbol || !Number.isFinite(toQuantity) || toQuantity <= 0) {
                    throw new Error(`Swap transaction ${transaction.id} is missing its received asset`);
                }
                const toPosition = positionFor(state, toSymbol);
                toPosition.quantity += toQuantity;
                toPosition.costMinor += transferredCost;
                toPosition.updatedAt = transaction.Timestamp;
            }

            if (action) {
                await db.run(
                    `INSERT INTO portfolio_transactions
                        (userId, accountId, sourceTransactionId, kind, amountMinor, symbol, quantity,
                         priceMinor, priceMicros, toSymbol, toQuantity, occurredAt, note)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        userId, state.id, transaction.id, 'LEDGER_' + action, amountMinor,
                        symbol || null, Number.isFinite(quantity) ? quantity : null,
                        Number.isFinite(price) ? Math.round(price * 100) : null,
                        Number.isFinite(price) ? Math.round(price * 1000000) : null,
                        transaction.PortfolioToSymbol || null, transaction.PortfolioToQuantity ?? null,
                        transaction.Timestamp, transaction.Reason || null,
                    ]
                );
            }
        }

        for (const ledger of ledgerState.values()) {
            if (ledger.cashMinor < 0) {
                throw new Error(`${ledger.account.name} ledger ends negative (${ledger.cashMinor})`);
            }
            await db.run(
                'UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ? AND userId = ?',
                [ledger.cashMinor, ledger.updatedAt || now, ledger.account.id, userId]
            );
        }

        for (const [kind, state] of accountState.entries()) {
            if (state.cashMinor < 0) throw new Error(`${kind} cash is negative (${state.cashMinor})`);
            await db.run(
                'UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ? AND userId = ?',
                [state.cashMinor, state.updatedAt || now, state.id, userId]
            );
            for (const position of state.positions.values()) {
                if (position.quantity < -1e-6) {
                    throw new Error(`Portfolio ledger ends with negative ${position.symbol} quantity (${position.quantity})`);
                }
                if (position.quantity <= 1e-6) continue;
                const averageCostMicros = Math.round((position.costMinor / position.quantity) * 10000);
                const priceMicros = position.priceMicros || averageCostMicros;
                await db.run(
                    `INSERT INTO investment_holdings
                        (userId, accountId, symbol, name, quantity, averageCostMinor, averageCostMicros,
                         priceMinor, priceMicros, currency, updatedAt)
                     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'CAD', ?)`,
                    [
                        userId, state.id, position.symbol, position.quantity,
                        Math.round(averageCostMicros / 10000), averageCostMicros,
                        Math.round(priceMicros / 10000), priceMicros,
                        position.updatedAt || state.updatedAt || now,
                    ]
                );
            }
        }

        await db.run('COMMIT');
        const counts = await db.get(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN ReceivedAt IS NULL THEN 1 ELSE 0 END) AS history,
                    SUM(CASE WHEN ReceivedAt IS NOT NULL THEN 1 ELSE 0 END) AS live
             FROM transactions WHERE userId = ?`,
            [userId]
        );
        const resultAccounts = await db.all(
            `SELECT id, name, accountType, accountRef, cashMinor
             FROM investment_accounts WHERE userId = ? ORDER BY id`,
            [userId]
        );
        const holdings = await db.all(
            `SELECT accountId, symbol, quantity, averageCostMinor, priceMinor
             FROM investment_holdings WHERE accountId IN (?, ?) ORDER BY accountId, symbol`,
            portfolioAccountIds
        );
        console.log(JSON.stringify({ counts, accounts: resultAccounts, holdings }, null, 2));
    } catch (error) {
        await db.run('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        await db.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
