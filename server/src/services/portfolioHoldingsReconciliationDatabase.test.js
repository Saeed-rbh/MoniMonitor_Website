const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-holdings-reconciliation-'));
process.env.MONIMONITOR_DB_PATH = path.join(testDirectory, 'test.sqlite');
process.env.MARKET_QUOTES_ENABLED = 'false';

const dbService = require('../database/dbService');
const { applyInvestmentSnapshot } = require('./plaidService');

test.after(async () => {
    const db = await dbService.getDb();
    await db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('keeps email-confirmed trades over a stale Plaid snapshot and repairs an ambiguous TFSA route', async () => {
    const db = await dbService.getDb();
    const userId = 'holdings-reconciliation-user';
    const now = new Date().toISOString();
    await db.run('INSERT INTO users (id, username, password, createdAt) VALUES (?, ?, ?, ?)', [
        userId, 'holdings-reconciliation', 'not-used', now,
    ]);
    const active = await dbService.createInvestmentAccount(userId, {
        name: 'TFSA', institution: 'Wealthsimple', accountType: 'TFSA',
        accountRef: 'ACTIVE123', currency: 'CAD', cashMinor: 10_000,
    });
    const duplicate = await dbService.createInvestmentAccount(userId, {
        name: 'Wealthsimple TFSA', institution: 'Wealthsimple', accountType: 'TFSA',
        accountRef: 'DUPLICATE456', currency: 'CAD', cashMinor: 0,
    });
    await dbService.upsertInvestmentHolding(userId, active.id, {
        symbol: 'QQC', name: 'QQC', quantity: 47.8867,
        averageCostMinor: 4500, averageCostMicros: 45000000,
        priceMinor: 4800, priceMicros: 48000000, currency: 'CAD', updatedAt: now,
    });
    await dbService.upsertInvestmentHolding(userId, active.id, {
        symbol: 'XEQT', name: 'XEQT', quantity: 56.3688,
        averageCostMinor: 4000, averageCostMicros: 40000000,
        priceMinor: 4500, priceMicros: 45000000, currency: 'CAD', updatedAt: now,
    });

    const addEmailTrade = async ({ symbol, quantity, accountId, plaidConfirmed = false }) => {
        const transactionId = await dbService.addTransaction({
            userId, AmountMinor: 1000, Category: 'Investment', Label: 'ETF & Stock Purchase',
            Reason: symbol, Timestamp: now, ReceivedAt: now, Type: 'Fractional Buy',
            BankName: 'Wealthsimple', PortfolioAction: 'BUY', PortfolioAccountId: accountId,
            PortfolioConfidence: 'HIGH', PortfolioAccountNumber: 'TFSA',
            PortfolioSymbol: symbol, PortfolioQuantity: quantity, PortfolioPrice: 10 / quantity,
            SourceEmailKey: `owner@example.com:${symbol}`,
        });
        await dbService.upsertTransactionSource({
            userId, provider: 'email', externalId: `owner@example.com:${symbol}`,
            transactionId, ownsTransaction: true,
        });
        if (plaidConfirmed) {
            await dbService.upsertTransactionSource({
                userId, provider: 'plaid_investments', externalId: `plaid-${symbol}`,
                transactionId, ownsTransaction: false,
            });
        }
        return transactionId;
    };

    const qqcTransactionId = await addEmailTrade({
        symbol: 'QQC', quantity: 0.2083, accountId: active.id,
    });
    const xeqtTransactionId = await addEmailTrade({
        symbol: 'XEQT', quantity: 0.2203, accountId: duplicate.id,
    });
    const vfvTransactionId = await addEmailTrade({
        symbol: 'VFV', quantity: 0.0529, accountId: active.id, plaidConfirmed: true,
    });

    for (const [transactionId, symbol, quantity, proposedAccountId] of [
        [qqcTransactionId, 'QQC', 0.2083, active.id],
        [xeqtTransactionId, 'XEQT', 0.2203, duplicate.id],
    ]) {
        const result = await dbService.applyEmailPortfolioActivity(userId, transactionId, {
            accountId: proposedAccountId, confidence: 'HIGH', action: 'BUY',
            symbol, quantity, price: 10 / quantity,
        });
        assert.equal(result.status, 'applied');
        assert.equal(result.accountId, active.id);
    }
    const startupReconciliation = await dbService.reconcileEmailPortfolioActivities(userId);
    assert.equal(startupReconciliation.some((item) => item.transactionId === vfvTransactionId), false);
    assert.equal(
        (await db.get('SELECT COUNT(*) AS count FROM portfolio_transactions WHERE sourceTransactionId = ?', [vfvTransactionId])).count,
        0
    );

    const accountMap = new Map([
        ['plaid-active', { appAccountId: active.id, type: 'investment', currency: 'CAD' }],
        ['plaid-duplicate', { appAccountId: duplicate.id, type: 'investment', currency: 'CAD' }],
    ]);
    await applyInvestmentSnapshot(userId, accountMap, {
        accounts: [
            { account_id: 'plaid-active', balances: { available: 100 } },
            { account_id: 'plaid-duplicate', balances: { available: 0 } },
        ],
        securities: [
            { security_id: 'qqc', ticker_symbol: 'QQC', name: 'QQC', type: 'etf' },
            { security_id: 'vfv', ticker_symbol: 'VFV', name: 'VFV', type: 'etf' },
            { security_id: 'xeqt', ticker_symbol: 'XEQT', name: 'XEQT', type: 'etf' },
        ],
        holdings: [
            { account_id: 'plaid-active', security_id: 'qqc', quantity: 47.8867, institution_price: 48, institution_value: 2298.5616, cost_basis: 2154.9015, iso_currency_code: 'CAD' },
            { account_id: 'plaid-active', security_id: 'vfv', quantity: 21.4902, institution_price: 190, institution_value: 4083.138, cost_basis: 3500, iso_currency_code: 'CAD' },
            { account_id: 'plaid-active', security_id: 'xeqt', quantity: 56.3688, institution_price: 45, institution_value: 2536.596, cost_basis: 2254.752, iso_currency_code: 'CAD' },
        ],
    });

    const holdings = await db.all(
        'SELECT accountId, symbol, quantity FROM investment_holdings WHERE userId = ? ORDER BY symbol',
        [userId]
    );
    assert.deepEqual(holdings, [
        { accountId: active.id, symbol: 'QQC', quantity: 48.095 },
        { accountId: active.id, symbol: 'VFV', quantity: 21.4902 },
        { accountId: active.id, symbol: 'XEQT', quantity: 56.5891 },
    ]);

    const repairedTransaction = await db.get(
        'SELECT PortfolioAccountId FROM transactions WHERE id = ?', [xeqtTransactionId]
    );
    assert.equal(repairedTransaction.PortfolioAccountId, active.id);
    assert.deepEqual(
        await db.all(
            'SELECT sourceTransactionId, accountId FROM portfolio_transactions WHERE sourceTransactionId IN (?, ?) ORDER BY sourceTransactionId',
            [qqcTransactionId, xeqtTransactionId]
        ),
        [
            { sourceTransactionId: qqcTransactionId, accountId: active.id },
            { sourceTransactionId: xeqtTransactionId, accountId: active.id },
        ]
    );
});
