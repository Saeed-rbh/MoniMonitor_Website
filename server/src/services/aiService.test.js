const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeNullablePositiveNumber, parseAIResponseText } = require('./aiService');

function validTransaction(overrides = {}) {
    return {
        Amount: '42.50',
        Category: 'Expense',
        Label: 'Shopping',
        Reason: 'Example Store',
        Timestamp: '2026-08-12T12:00:00.000Z',
        Type: 'Credit Card',
        Account: null,
        BankName: 'Example Bank',
        ReferenceNumber: null,
        BalanceAccountId: null,
        BalanceAccountConfidence: null,
        PortfolioAction: null,
        PortfolioAccountId: null,
        PortfolioConfidence: null,
        PortfolioSymbol: null,
        PortfolioQuantity: null,
        PortfolioPrice: null,
        ...overrides,
    };
}

test('normalizes invalid nullable numeric values to null', () => {
    for (const value of [null, undefined, '', 'null', 'NaN', 'N/A', Number.NaN, 0, -1]) {
        assert.equal(normalizeNullablePositiveNumber(value), null);
    }
});

test('preserves positive numbers and numeric strings', () => {
    assert.equal(normalizeNullablePositiveNumber(12), 12);
    assert.equal(normalizeNullablePositiveNumber('12.5'), 12.5);
});

test('accepts a transaction when Gemini returns null-like portfolio values', () => {
    const parsed = parseAIResponseText(JSON.stringify(validTransaction({
        PortfolioAccountId: 'null',
        PortfolioQuantity: 'NaN',
        PortfolioPrice: '',
    })));

    assert.equal(parsed.PortfolioAccountId, null);
    assert.equal(parsed.PortfolioQuantity, null);
    assert.equal(parsed.PortfolioPrice, null);
});

test('coerces a valid portfolio account id from a numeric string', () => {
    const parsed = parseAIResponseText(JSON.stringify(validTransaction({
        Category: 'Saving',
        Label: 'Investment',
        PortfolioAction: 'CONTRIBUTION',
        PortfolioAccountId: '7',
        PortfolioConfidence: 'HIGH',
    })));

    assert.equal(parsed.PortfolioAccountId, 7);
});
