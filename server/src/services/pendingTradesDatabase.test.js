const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-pending-trades-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
process.env.MARKET_QUOTES_ENABLED = 'false';
const service = require('../database/dbService');
const mutations = require('./transactionMutations');
const { applyInvestmentSnapshot } = require('./plaidService');
const { attachPendingTrades } = require('./pendingTradeService');
let db;
let sequence = 0;
test.before(async () => { db = await service.getDb(); });
test.after(async () => { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

async function fixture({ bank = true, action = 'BUY', quantity = 1, amount = 20, currency = 'CAD', confidence = 'HIGH' } = {}) {
    const userId = `trade-owner-${++sequence}`;
    await service.createUser(userId, userId, 'unused');
    const account = await service.createInvestmentAccount(userId, { name: 'Example TFSA', accountType: 'TFSA', accountRef: 'ACCOUNT123',
        institution: 'Example Bank', currency: 'CAD', cashMinor: 100000 });
    await service.upsertInvestmentHolding(userId, account.id, { symbol: 'ABC', quantity: 10, currency: 'CAD',
        averageCostMinor: 1500, averageCostMicros: 15000000, priceMinor: 2000, priceMicros: 20000000 });
    const now = new Date().toISOString();
    if (bank) {
        await db.run('INSERT INTO plaid_items (itemId, userId, accessTokenEncrypted, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
            [userId, userId, 'unused', now, now]);
        await db.run(`INSERT INTO plaid_accounts (plaidAccountId, itemId, userId, appAccountId, type, currency, updatedAt)
            VALUES (?, ?, ?, ?, 'investment', 'CAD', ?)`, [userId, userId, userId, account.id, now]);
    }
    const id = await service.addTransaction({ userId, Amount: amount, Currency: currency, Category: 'Investment',
        Label: action === 'BUY' ? 'ETF & Stock Purchase' : 'ETF & Stock Sale', Reason: 'Example trade', Timestamp: now, ReceivedAt: now,
        PortfolioAccountId: account.id, PortfolioAccountNumber: 'ACCOUNT123', PortfolioConfidence: confidence,
        PortfolioAction: action, PortfolioSymbol: 'ABC', PortfolioQuantity: quantity, PortfolioPrice: amount / quantity });
    await service.upsertTransactionSource({ userId, transactionId: id, provider: 'email', externalId: userId + ':email', ownsTransaction: true });
    const activity = { accountId: account.id, action, symbol: 'ABC', quantity, price: amount / quantity, confidence };
    return { userId, account, id, activity };
}
const accounts = (f) => service.getInvestmentAccounts(f.userId);
async function recorded(f) {
    return { cash: (await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [f.account.id])).cashMinor,
        quantity: (await db.get("SELECT quantity FROM investment_holdings WHERE accountId = ? AND symbol = 'ABC'", [f.account.id])).quantity,
        postings: (await db.get('SELECT COUNT(*) AS count FROM portfolio_transactions WHERE userId = ?', [f.userId])).count };
}
async function snapshot(f, quantity = 10) {
    return applyInvestmentSnapshot(f.userId, new Map([[f.userId, { appAccountId: f.account.id, type: 'investment', currency: 'CAD' }]]), {
        accounts: [{ account_id: f.userId, balances: { available: 1000, iso_currency_code: 'CAD' } }],
        securities: [{ security_id: 'ABC', ticker_symbol: 'ABC', type: 'etf' }],
        holdings: [{ account_id: f.userId, security_id: 'ABC', quantity, institution_price: 20,
            institution_value: quantity * 20, cost_basis: quantity * 15, iso_currency_code: 'CAD' }],
    });
}

test('email ingestion and startup reconciliation never post a bank-linked trade', async () => {
    const f = await fixture();
    assert.equal((await service.applyEmailPortfolioActivity(f.userId, f.id, f.activity)).status, 'pending_bank_confirmation');
    await service.reconcileEmailPortfolioActivities(f.userId);
    assert.deepEqual(await recorded(f), { cash: 100000, quantity: 10, postings: 0 });
});

test('repeated snapshots and concurrent reads retain provider quantities and recorded totals', async () => {
    const f = await fixture();
    await snapshot(f);
    await snapshot(f);
    for (const result of await Promise.all(Array.from({ length: 3 }, () => accounts(f)))) {
        assert.equal(result[0].holdings[0].quantity, 10);
        assert.equal(result[0].pendingTradeHoldings[0].estimatedQuantity, 11);
        assert.equal(result[0].estimatedCashWithTradesMinor, 98000);
        assert.equal(result[0].holdingsSource, 'plaid');
    }
    const portfolio = await service.getPortfolioSummary(f.userId);
    assert.equal(portfolio.totalValueMinor, 120000);
    assert.deepEqual(await recorded(f), { cash: 100000, quantity: 10, postings: 0 });
});

test('a snapshot which already includes a trade is never overlaid a second time', async () => {
    const f = await fixture();
    await snapshot(f, 11);
    assert.equal((await service.getPortfolioSummary(f.userId)).holdingsValueMinor, 22000);
    assert.equal((await accounts(f))[0].pendingTradeHoldings[0].estimatedQuantity, 12);
    // The estimate is explicitly uncertain, while the recorded quantity is exact.
    assert.equal((await recorded(f)).quantity, 11);
    await service.upsertTransactionSource({ userId: f.userId, transactionId: f.id,
        provider: 'plaid_investments', externalId: 'confirmed-' + f.userId, ownsTransaction: false });
    assert.equal((await accounts(f))[0].pendingTrades.length, 0);
    assert.equal((await recorded(f)).quantity, 11);
});

test('edits, deletion, and expiration recompute estimates without moving provider balances', async () => {
    const f = await fixture();
    await snapshot(f);
    await mutations.updateTransaction(f.userId, f.id, { Amount: 30 });
    let state = (await accounts(f))[0];
    assert.equal(state.pendingTrades[0].status, 'review_required');
    assert.equal(state.estimatedCashWithTradesMinor, null);
    assert.deepEqual(await recorded(f), { cash: 100000, quantity: 10, postings: 0 });
    const expired = await attachPendingTrades(db, f.userId, [state], Date.now() + 8 * 86400000);
    assert.equal(expired.accounts[0].pendingTrades.length, 0);
    await service.deleteTransaction(f.id, f.userId);
    assert.equal((await accounts(f))[0].pendingTrades.length, 0);
    assert.deepEqual(await recorded(f), { cash: 100000, quantity: 10, postings: 0 });
});

test('manual accounts retain actual postings without adding a second estimate', async () => {
    const f = await fixture({ bank: false });
    assert.equal((await service.applyEmailPortfolioActivity(f.userId, f.id, f.activity)).status, 'applied');
    const state = (await accounts(f))[0];
    assert.equal(state.pendingTrades[0].status, 'already_posted');
    assert.equal(state.pendingTradeHoldings.length, 0);
    assert.equal(state.pendingTradeCashDeltaMinor, 0);
    assert.equal(state.estimatedCashWithTradesMinor, 98000);
    assert.deepEqual(await recorded(f), { cash: 98000, quantity: 11, postings: 1 });
});

test('impossible sells retain the negative estimate and require review instead of clamping shares', async () => {
    const f = await fixture({ action: 'SELL', quantity: 12, amount: 240 });
    await snapshot(f);
    const state = (await accounts(f))[0];
    assert.equal(state.pendingTradeHoldings[0].estimatedQuantity, -2);
    assert.match(state.pendingTradeHoldings[0].reason, /exceeds recorded shares/);
    assert.equal(state.pendingTradeReviewRequired, true);
    assert.equal((await recorded(f)).quantity, 10);
});

test('currency mismatches, uncertain accounts, invalid details, and legacy overlays require review', async () => {
    for (const options of [{ currency: 'USD' }, { confidence: 'LOW' }]) {
        const f = await fixture(options);
        const state = (await accounts(f))[0];
        assert.equal(state.estimatedCashWithTradesMinor, null);
        assert.equal(state.pendingTrades[0].status, 'review_required');
        assert.deepEqual(await recorded(f), { cash: 100000, quantity: 10, postings: 0 });
    }
    const f = await fixture();
    await db.run('UPDATE transactions SET PortfolioQuantity = NULL WHERE id = ?', [f.id]);
    assert.match((await accounts(f))[0].pendingTrades[0].reason, /details need review/);
    await db.run('UPDATE transactions SET PortfolioQuantity = 1 WHERE id = ?', [f.id]);
    await db.run('UPDATE investment_accounts SET holdingsReviewReason = ? WHERE id = ?', ['Refresh possible legacy overlay', f.account.id]);
    assert.equal((await accounts(f))[0].estimatedCashWithTradesMinor, null);
    await snapshot(f);
    assert.equal((await accounts(f))[0].holdingsReviewReason, null);
    assert.equal((await accounts(f))[0].estimatedCashWithTradesMinor, 98000);
});

test('account ownership and missing accounts produce review items without leaking another user holdings', async () => {
    const f = await fixture();
    const other = await fixture();
    await db.run('UPDATE transactions SET PortfolioAccountId = ? WHERE id = ?', [other.account.id, f.id]);
    const portfolio = await service.getPortfolioSummary(f.userId);
    assert.equal(portfolio.pendingTradeReviewItems.length, 1);
    assert.equal(portfolio.accounts[0].pendingTrades.length, 0);
    assert.equal(portfolio.accounts.length, 1);
    assert.equal((await accounts(other))[0].pendingTrades.length, 1);
});

test('cash estimates combine transfers and trades while recorded cash stays separate', async () => {
    const f = await fixture();
    let result = await attachPendingTrades(db, f.userId, [{ ...(await accounts(f))[0], estimatedCashMinor: 99000 }]);
    assert.equal(result.accounts[0].estimatedCashWithTradesMinor, 97000);
    result = await attachPendingTrades(db, f.userId, [{ ...(await accounts(f))[0], cashMinor: 100, estimatedCashMinor: 100 }]);
    assert.equal(result.accounts[0].estimatedCashWithTradesMinor, -1900);
    assert.equal(result.accounts[0].pendingTradeReviewRequired, true);
    assert.equal((await recorded(f)).cash, 100000);
});

test('manual holding changes after a bank snapshot are marked as a mixed baseline', async () => {
    const f = await fixture();
    await snapshot(f);
    await service.upsertInvestmentHolding(f.userId, f.account.id, { symbol: 'ABC', quantity: 15,
        averageCostMinor: 1500, priceMinor: 2000, currency: 'CAD' });
    let state = (await accounts(f))[0];
    assert.equal(state.holdingsSource, 'mixed');
    assert.match(state.holdingsReviewReason, /manually changed/);
    assert.equal(state.pendingTradeHoldings.length, 0);
    assert.equal(state.estimatedCashWithTradesMinor, null);
    await snapshot(f);
    assert.equal((await accounts(f))[0].holdingsSource, 'plaid');
    await service.deleteInvestmentHolding(f.userId, f.account.id, (await accounts(f))[0].holdings[0].id);
    state = (await accounts(f))[0];
    assert.equal(state.holdingsSource, 'mixed');
    assert.equal(state.pendingTradeHoldings.length, 0);
});

test('cross-user snapshot mappings are rejected before any holdings can be overwritten', async () => {
    const f = await fixture();
    const other = await fixture();
    const before = await recorded(other);
    await assert.rejects(applyInvestmentSnapshot(f.userId, new Map([[f.userId,
        { appAccountId: other.account.id, type: 'investment', currency: 'CAD' }]]), {
        accounts: [{ account_id: f.userId, balances: { available: 50, iso_currency_code: 'CAD' } }],
        securities: [], holdings: [],
    }), /does not belong to the user/);
    assert.deepEqual(await recorded(other), before);
});

test('failed bank snapshots roll back cash, holdings and their provenance together', async () => {
    const f = await fixture();
    await snapshot(f);
    const before = await db.get('SELECT cashMinor, holdingsSource, holdingsAsOf, holdingsReviewReason FROM investment_accounts WHERE id = ?', [f.account.id]);
    await db.exec(`CREATE TRIGGER reject_trade_snapshot BEFORE UPDATE OF holdingsSource ON investment_accounts
        WHEN NEW.id = ${f.account.id} BEGIN SELECT RAISE(ABORT, 'Injected snapshot failure'); END`);
    try { await assert.rejects(snapshot(f, 20), /Injected snapshot failure/); }
    finally { await db.exec('DROP TRIGGER reject_trade_snapshot'); }
    assert.deepEqual(await db.get('SELECT cashMinor, holdingsSource, holdingsAsOf, holdingsReviewReason FROM investment_accounts WHERE id = ?', [f.account.id]), before);
    assert.equal((await recorded(f)).quantity, 10);
});

test('an invalid trade prevents partial share estimates from being shown as a complete projection', async () => {
    const f = await fixture();
    const now = new Date().toISOString();
    const id = await service.addTransaction({ userId: f.userId, Amount: 20, Category: 'Investment', Label: 'ETF & Stock Purchase',
        Timestamp: now, ReceivedAt: now, PortfolioAccountId: f.account.id, PortfolioConfidence: 'LOW',
        PortfolioAction: 'BUY', PortfolioSymbol: 'ABC', PortfolioQuantity: 1, PortfolioPrice: 20 });
    await service.upsertTransactionSource({ userId: f.userId, transactionId: id, provider: 'email', externalId: f.userId + ':uncertain', ownsTransaction: true });
    const state = (await accounts(f))[0];
    assert.equal(state.pendingTrades.length, 2);
    assert.equal(state.pendingTradeHoldings.length, 0);
    assert.equal(state.estimatedCashWithTradesMinor, null);
    assert.equal((await recorded(f)).quantity, 10);
});

test('legacy overlay migration flags uncertainty without guessing cash or share reversals', async () => {
    const f = await fixture();
    const before = await recorded(f);
    // Recreate the immediately preceding schema to exercise the actual upgrade.
    await db.exec(`ALTER TABLE investment_accounts DROP COLUMN holdingsSource;
        ALTER TABLE investment_accounts DROP COLUMN holdingsAsOf;
        ALTER TABLE investment_accounts DROP COLUMN holdingsReviewReason;`);
    await db.withTransaction(() => require('../database/migrations').MIGRATIONS.find((migration) => migration.version === 9).up(db));
    const state = (await accounts(f))[0];
    assert.equal(state.holdingsSource, 'plaid');
    assert.match(state.holdingsReviewReason, /legacy pending-trade/);
    assert.match(state.balanceReviewReason, /legacy pending-trade/);
    assert.deepEqual(await recorded(f), before);
    await snapshot(f);
    assert.equal((await accounts(f))[0].holdingsReviewReason, null);
    assert.equal((await accounts(f))[0].balanceReviewReason, null);
});
