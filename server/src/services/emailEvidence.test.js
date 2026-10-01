const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceEventTimestamp, normalizeEmailEvidence } = require('./emailEvidence');

test('converts explicit Eastern event times independently of receipt and model time', () => {
    assert.equal(sourceEventTimestamp('Time: September 30, 2026 12:48 EDT'), '2026-09-30T16:48:00.000Z');
    assert.equal(sourceEventTimestamp('Time: January 30, 2026 12:48 EST'), '2026-01-30T17:48:00.000Z');
    assert.equal(sourceEventTimestamp('No event time'), null);
});

test('a vague TFSA email cannot authorize either of two TFSA accounts', () => {
    const accounts = [10, 14].map(id => ({ id, institution: 'Wealthsimple', accountType: 'TFSA',
        accountRef: id === 10 ? 'S0K7' : '0WK8', name: `TFSA ${id}`, currency: 'CAD' }));
    const row = { BankName: 'Wealthsimple', PortfolioAction: 'BUY', PortfolioAccountId: 14,
        BalanceAccountId: 14, PortfolioConfidence: 'HIGH', PortfolioSymbol: 'XEQT' };
    const held = normalizeEmailEvidence(row, 'Account: TFSA\nTime: September 30, 2026 12:48 EDT', accounts);
    assert.equal(held.BalanceAccountId, null);
    assert.equal(held.PortfolioAccountId, null);
    assert.equal(held.IngestionReviewReason, 'ambiguous_account');
    const explicit = normalizeEmailEvidence({ ...row, PortfolioAccountNumber: 'S0K7' }, 'Account: TFSA', accounts);
    assert.equal(explicit.PortfolioAccountId, 10);
    assert.equal(explicit.BalanceAccountId, 10);
});

test('preserves separate balance source and portfolio destination on internal transfers', () => {
    const row = { Category: 'Internal', BankName: 'Wealthsimple', PortfolioAction: 'TRANSFER',
        BalanceAccountId: 11, PortfolioAccountId: 10 };
    const normalized = normalizeEmailEvidence(row, 'Account: TFSA', []);
    assert.equal(normalized.BalanceAccountId, 11);
    assert.equal(normalized.PortfolioAccountId, 10);
    assert.equal(normalized.IngestionReviewReason, undefined);
});
