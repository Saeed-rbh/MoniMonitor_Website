const test = require('node:test');
const assert = require('node:assert/strict');

const {
    classifyPlaidTransaction,
    toAppTransaction,
    encryptAccessToken,
    decryptAccessToken,
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
