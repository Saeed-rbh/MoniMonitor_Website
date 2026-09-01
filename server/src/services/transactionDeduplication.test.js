const test = require('node:test');
const assert = require('node:assert/strict');

const {
    scoreTransactionMatch,
    referenceTokens,
} = require('./transactionDeduplication');

test('matches an email transfer to the differently formatted Plaid copy', () => {
    const email = {
        Amount: 671.85,
        AmountMinor: 67185,
        Currency: 'CAD',
        Category: 'Income',
        Reason: 'E-Transfer - Mohammad Mahdi Ghadiri',
        ReferenceNumber: '011665426528',
        Timestamp: '2026-08-04T16:00:00.000Z',
        Account: 'CIBC Chequing',
        BankName: 'CIBC',
    };
    const plaid = {
        Amount: 671.85,
        AmountMinor: 67185,
        Currency: 'CAD',
        Category: 'Income',
        Reason: 'E-TRANSFER 011665426528 MOHAMMAD MAHDI GHADIRI',
        Timestamp: '2026-08-04T12:00:00.000Z',
        Account: '8237',
        BankName: 'CIBC',
        AccountFlow: 'IN',
    };

    const match = scoreTransactionMatch(email, plaid);
    assert.equal(match.referenceMatch, true);
    assert.ok(match.score >= 100);
    assert.ok(referenceTokens(plaid.Reason).has('011665426528'));
});

test('does not merge opposite legs that share an internal-transfer reference', () => {
    const outgoing = {
        Amount: 100,
        AmountMinor: 10000,
        Currency: 'CAD',
        Category: 'Internal',
        Label: 'Internal Transfer',
        Reason: 'Internal transfer: RBC Chequing -> CIBC Chequing [XFER-20260804-1]',
        ReferenceNumber: 'XFER-20260804-1',
        Timestamp: '2026-08-04T16:00:00.000Z',
        AccountFlow: 'OUT',
    };
    const incoming = {
        ...outgoing,
        AccountFlow: 'IN',
        Account: 'CIBC Chequing',
    };

    assert.equal(scoreTransactionMatch(outgoing, incoming), null);
});

test('matches a shortened Plaid merchant to its email deposit on the same bank date', () => {
    const email = {
        Amount: 15.24,
        AmountMinor: 1524,
        Currency: 'CAD',
        Category: 'Income',
        Reason: 'Uber Holdings C',
        Timestamp: '2026-09-01T01:29:06.000Z',
        BankName: 'Wealthsimple',
        AccountFlow: 'IN',
        SourceEmailKey: 'mailbox:614',
    };
    const plaid = {
        Amount: 15.24,
        AmountMinor: 1524,
        Currency: 'CAD',
        Category: 'Income',
        Reason: 'Uber',
        Timestamp: '2026-09-01T12:00:00.000Z',
        BankName: 'Wealthsimple (Canada)',
        Account: '1832',
        AccountFlow: 'IN',
    };

    const match = scoreTransactionMatch(email, plaid, { incomingProvider: 'plaid' });
    assert.ok(match);
    assert.equal(match.referenceMatch, false);
    assert.equal(match.overlapCount, 1);
});

test('does not merge one-word same-amount matches without complementary providers', () => {
    const first = {
        Amount: 15.24,
        AmountMinor: 1524,
        Currency: 'CAD',
        Category: 'Income',
        Reason: 'Uber Holdings C',
        Timestamp: '2026-09-01T01:29:06.000Z',
        BankName: 'Wealthsimple',
        AccountFlow: 'IN',
    };
    const second = {
        ...first,
        Reason: 'Uber',
        Timestamp: '2026-09-01T12:00:00.000Z',
    };

    assert.equal(scoreTransactionMatch(first, second), null);
});
