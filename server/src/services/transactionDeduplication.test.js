const test = require('node:test');
const assert = require('node:assert/strict');

const {
    scoreTransactionMatch,
    referenceTokens,
} = require('./transactionDeduplication');

const bankEvent = { AmountMinor: 10000, Currency: 'CAD', Category: 'Expense',
    Reason: 'Example Coffee Shop', Timestamp: '2026-09-20T15:00:00Z',
    BankName: 'RBC', Account: '1234', AccountFlow: 'OUT', SourceEmailKey: 'email:1' };

test('rejects conflicting accounts, banks, and flow even with shared reference', () => {
    for (const conflict of [{ Account: '5678' }, { BankName: 'CIBC' },
        { AccountFlow: 'IN' }, { BalanceAccountId: 2 }]) {
        assert.equal(scoreTransactionMatch({ ...bankEvent, ReferenceNumber: '12345678', BalanceAccountId: 1 },
            { ...bankEvent, SourceEmailKey: null, ReferenceNumber: '12345678', BalanceAccountId: 1, ...conflict },
            { incomingProvider: 'plaid' }), null);
    }
});

test('matches a posting date shift in either source arrival order', () => {
    const plaid = { ...bankEvent, SourceEmailKey: null, hasPlaidSource: true,
        Timestamp: '2026-09-22T12:00:00Z' };
    assert.ok(scoreTransactionMatch(bankEvent, plaid, { incomingProvider: 'plaid' }));
    assert.ok(scoreTransactionMatch(plaid, bankEvent, { incomingProvider: 'email' }));
});

test('matches Plaid to a reclassified internal leg without merging the other account', () => {
    const internal = { ...bankEvent, Category: 'Internal', Reason: 'Internal transfer: RBC -> CIBC',
        ReferenceNumber: 'XFER-12345678' };
    const plaid = { ...bankEvent, Reason: 'Funds transfer', SourceEmailKey: null };
    assert.ok(scoreTransactionMatch(internal, plaid, { incomingProvider: 'plaid' }));
    assert.equal(scoreTransactionMatch(internal, { ...plaid, Account: '5678' }, { incomingProvider: 'plaid' }), null);
});

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

test('matches CUPE acronym to Canadian Union of Public Emplo on same account and date', () => {
    const email = {
        Amount: 1271.18,
        AmountMinor: 127118,
        Currency: 'CAD',
        Category: 'Income',
        Reason: 'CUPE Local 3903',
        Timestamp: '2026-09-15T12:00:00.000Z',
        BankName: 'CIBC',
        Account: '8237',
        AccountFlow: 'IN',
        SourceEmailKey: 'mailbox:675',
    };
    const plaid = {
        Amount: 1271.18,
        AmountMinor: 127118,
        Currency: 'CAD',
        Category: 'Income',
        Reason: 'DEPOSIT Canadian Union of Public Emplo',
        Timestamp: '2026-09-15T12:00:00.000Z',
        BankName: 'CIBC',
        Account: '8237',
        AccountFlow: 'IN',
    };

    const match = scoreTransactionMatch(email, plaid, { incomingProvider: 'plaid' });
    assert.ok(match);
    assert.equal(match.referenceMatch, false);
    assert.ok(match.overlapCount >= 1);
});

