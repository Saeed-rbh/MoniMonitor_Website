const test = require('node:test');
const assert = require('node:assert/strict');

const {
    classifyPlaidTransaction,
    toAppTransaction,
    toAppInvestmentTransaction,
    encryptAccessToken,
    decryptAccessToken,
    plaidBalanceMinor,
    fetchCurrentMarketPrices,
    normalizeInvestmentSnapshot,
} = require('./plaidService');

test('maps Plaid outflows and inflows to MoniMonitor categories', () => {
    assert.deepEqual(classifyPlaidTransaction({
        amount: 42.25,
        personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' },
    }), { Category: 'Expense', Label: 'Groceries' });

    assert.deepEqual(classifyPlaidTransaction({
        amount: -2500,
        personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES' },
    }), { Category: 'Income', Label: 'Employment Income' });
});

test('normalizes a Plaid transaction without exposing signed amounts', () => {
    const result = toAppTransaction({
        amount: 12.345,
        date: '2026-08-20',
        merchant_name: 'Coffee Shop',
        iso_currency_code: 'cad',
        personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' },
    }, { mask: '1234', type: 'depository', subtype: 'checking' }, 'Test Bank');

    assert.equal(result.AmountMinor, 1235);
    assert.equal(result.Amount, 12.35);
    assert.equal(result.AccountFlow, 'OUT');
    assert.equal(result.Timestamp, '2026-08-20T12:00:00.000Z');
    assert.equal(result.Account, '1234');
});

test('encrypts stored Plaid access tokens with authenticated encryption', () => {
    const previousClientId = process.env.PLAID_CLIENT_ID;
    const previousSecret = process.env.PLAID_SECRET;
    const previousKey = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
    process.env.PLAID_CLIENT_ID = 'test-client';
    process.env.PLAID_SECRET = 'test-secret';
    process.env.PLAID_TOKEN_ENCRYPTION_KEY = 'test-encryption-key';
    try {
        const encrypted = encryptAccessToken('access-sandbox-sensitive');
        assert.notEqual(encrypted, 'access-sandbox-sensitive');
        assert.equal(decryptAccessToken(encrypted), 'access-sandbox-sensitive');
    } finally {
        if (previousClientId === undefined) delete process.env.PLAID_CLIENT_ID;
        else process.env.PLAID_CLIENT_ID = previousClientId;
        if (previousSecret === undefined) delete process.env.PLAID_SECRET;
        else process.env.PLAID_SECRET = previousSecret;
        if (previousKey === undefined) delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;
        else process.env.PLAID_TOKEN_ENCRYPTION_KEY = previousKey;
    }
});

test('converts Plaid current balances to integer minor units', () => {
    assert.equal(plaidBalanceMinor({ balances: { current: 933.72 } }), 93372);
    assert.equal(plaidBalanceMinor({ balances: { current: -12.345 } }), -1235);
    assert.equal(plaidBalanceMinor({ balances: { current: null } }), null);
    assert.equal(plaidBalanceMinor({ balances: {} }), null);
});

test('normalizes authoritative investment quantities, prices, cost, and cash', () => {
    const result = normalizeInvestmentSnapshot({
        accounts: [{ account_id: 'tfsa', balances: { current: 9435.30 } }],
        securities: [
            { security_id: 'vfv', ticker_symbol: 'VFV', name: 'Vanguard S&P 500', type: 'etf' },
            { security_id: 'cash', ticker_symbol: 'CAD', name: 'Cash', type: 'cash', is_cash_equivalent: true },
        ],
        holdings: [
            { account_id: 'tfsa', security_id: 'vfv', quantity: 20.5, institution_price: 190, institution_value: 3895, cost_basis: 3300, iso_currency_code: 'CAD' },
            { account_id: 'tfsa', security_id: 'cash', quantity: 540.3, institution_price: 1, institution_value: 540.3, iso_currency_code: 'CAD' },
        ],
    }).get('tfsa');
    assert.equal(result.cashMinor, 54030);
    assert.equal(result.holdings.length, 1);
    assert.equal(result.holdings[0].symbol, 'VFV');
    assert.equal(result.holdings[0].quantity, 20.5);
    assert.equal(result.holdings[0].priceMicros, 190000000);
    assert.equal(result.holdings[0].averageCostMicros, 160975610);
});

test('uses security close prices when Wealthsimple reports zero holding prices and values', () => {
    const result = normalizeInvestmentSnapshot({
        accounts: [{ account_id: 'tfsa', balances: { current: 9412.442916 } }],
        securities: [
            { security_id: 'vfv', ticker_symbol: 'VFV', type: 'etf', close_price: 188.93, close_price_as_of: '2026-08-19' },
            { security_id: 'qqc', ticker_symbol: 'QQC', type: 'etf', close_price: 48.29, close_price_as_of: '2026-08-19' },
            { security_id: 'xeqt', ticker_symbol: 'XEQT', type: 'etf', close_price: 45.61, close_price_as_of: '2026-08-19' },
        ],
        holdings: [
            { account_id: 'tfsa', security_id: 'vfv', quantity: 21.0674, institution_price: 0, institution_value: 0, cost_basis: 3410.45, iso_currency_code: 'CAD' },
            { account_id: 'tfsa', security_id: 'qqc', quantity: 46.2295, institution_price: 0, institution_value: 0, cost_basis: 2001.85, iso_currency_code: 'CAD' },
            { account_id: 'tfsa', security_id: 'xeqt', quantity: 54.6211, institution_price: 0, institution_value: 0, cost_basis: 2194.62, iso_currency_code: 'CAD' },
        ],
    }).get('tfsa');
    assert.equal(result.holdings[0].priceMicros, 188930000);
    assert.equal(result.holdings[1].priceMicros, 48290000);
    assert.equal(result.holdings[2].priceMicros, 45610000);
    assert.equal(result.cashMinor, 70849);
});

test('uses a current market quote before Plaid previous-close data', () => {
    const result = normalizeInvestmentSnapshot({
        accounts: [{ account_id: 'tfsa', balances: { current: 9412.442916 } }],
        securities: [{ security_id: 'vfv', ticker_symbol: 'VFV', type: 'etf', close_price: 188.93 }],
        holdings: [{
            account_id: 'tfsa', security_id: 'vfv', quantity: 21.0674,
            institution_price: 0, institution_value: 0, iso_currency_code: 'CAD',
        }],
    }, new Map([['vfv', { price: 187.08, updatedAt: '2026-08-20T20:00:00.000Z' }]])).get('tfsa');
    assert.equal(result.holdings[0].priceMicros, 187080000);
    assert.equal(result.holdings[0].updatedAt, '2026-08-20T20:00:00.000Z');
    assert.equal(result.cashMinor, 547115);
});

test('derives a unit price from Plaid institution value when its unit price is zero', () => {
    const result = normalizeInvestmentSnapshot({
        accounts: [{ account_id: 'tfsa', balances: { current: 1000 } }],
        securities: [{ security_id: 'vfv', ticker_symbol: 'VFV', type: 'etf', close_price: 180 }],
        holdings: [{
            account_id: 'tfsa', security_id: 'vfv', quantity: 4,
            institution_price: 0, institution_value: 760, iso_currency_code: 'CAD',
        }],
    }).get('tfsa');
    assert.equal(result.holdings[0].priceMicros, 190000000);
    assert.equal(result.cashMinor, 24000);
});

test('fetches TSX quotes for zero-price Canadian holdings', async () => {
    const requested = [];
    const prices = await fetchCurrentMarketPrices({
        securities: [{ security_id: 'vfv', ticker_symbol: 'VFV', iso_currency_code: 'CAD' }],
        holdings: [{
            security_id: 'vfv', quantity: 21.0674, institution_price: 0,
            institution_value: 0, iso_currency_code: 'CAD',
        }],
    }, async (url) => {
        requested.push(url);
        return {
            ok: true,
            json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 187.08, regularMarketTime: 1787256000 } }] } }),
        };
    });
    assert.match(requested[0], /VFV.TO/);
    assert.equal(prices.get('vfv').price, 187.08);
});

test('maps an investment purchase with exact security details', () => {
    const result = toAppInvestmentTransaction({
        investment_transaction_id: 'investment-1',
        account_id: 'tfsa',
        security_id: 'vfv',
        date: '2026-08-19',
        name: 'BUY VFV',
        quantity: 0.0527,
        amount: 9.99,
        price: 189.62,
        type: 'buy',
        subtype: 'buy',
        iso_currency_code: 'CAD',
    }, { appAccountId: 10, mask: 'S0K7', type: 'investment', subtype: 'tfsa' }, { ticker_symbol: 'VFV' }, 'Wealthsimple');
    assert.equal(result.Category, 'Investment');
    assert.equal(result.Label, 'ETF & Stock Purchase');
    assert.equal(result.PortfolioAction, 'BUY');
    assert.equal(result.PortfolioAccountId, 10);
    assert.equal(result.PortfolioSymbol, 'VFV');
    assert.equal(result.PortfolioQuantity, 0.0527);
    assert.equal(result.PortfolioPrice, 189.62);
    assert.equal(result.AccountFlow, 'OUT');
});

test('maps TFSA cash contributions and dividends', () => {
    const account = { appAccountId: 10, mask: 'S0K7', type: 'investment', subtype: 'tfsa' };
    const contribution = toAppInvestmentTransaction({
        date: '2026-08-01', name: 'Contribution', amount: -100, quantity: 0,
        type: 'cash', subtype: 'contribution', iso_currency_code: 'CAD',
    }, account);
    assert.equal(contribution.Category, 'Saving');
    assert.equal(contribution.Label, 'Savings Contributions');
    assert.equal(contribution.PortfolioAction, 'CONTRIBUTION');
    assert.equal(contribution.AccountFlow, 'IN');

    const dividend = toAppInvestmentTransaction({
        date: '2026-08-02', name: 'Dividend', amount: -4.25, quantity: 0,
        type: 'cash', subtype: 'dividend', iso_currency_code: 'CAD',
    }, account, { ticker_symbol: 'VFV' });
    assert.equal(dividend.Label, 'Dividends');
    assert.equal(dividend.PortfolioAction, 'DIVIDEND');
    assert.equal(dividend.AmountMinor, 425);
    assert.equal(dividend.AccountFlow, 'IN');
});
