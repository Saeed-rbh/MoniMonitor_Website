const test = require('node:test');
const assert = require('node:assert/strict');

const {
    isCreditCardPayment,
    isOutgoingEmailTransfer,
    normalizeTransactionSemantics,
} = require('./transactionSemantics');

test('normalizes an explicit credit-card payment as an inflow to the card', () => {
    const normalized = normalizeTransactionSemantics({
        Category: 'Internal',
        Label: 'Internal Transfer',
        Reason: 'Credit Card Payment',
        Type: 'Credit Card',
        AccountFlow: 'OUT',
    });
    assert.equal(normalized.AccountFlow, 'IN');
    assert.equal(normalized.Category, 'Internal');
});

test('does not change an ordinary card purchase or non-card payment', () => {
    const purchase = { Reason: 'Coffee Shop', Type: 'Credit Card', AccountFlow: 'OUT' };
    const bill = { Reason: 'Utility payment', Type: 'Checking Account', AccountFlow: 'OUT' };
    assert.deepEqual(normalizeTransactionSemantics(purchase), purchase);
    assert.deepEqual(normalizeTransactionSemantics(bill), bill);
    assert.equal(isCreditCardPayment(purchase), false);
    assert.equal(isCreditCardPayment(bill), false);
});

test('recognizes a payment-made credit-card confirmation', () => {
    assert.equal(isCreditCardPayment({
        Reason: 'Payment Made', Type: 'Credit Card', AccountFlow: 'IN',
    }), true);
});

test('requires explicit outgoing language for an e-transfer leg', () => {
    assert.equal(isOutgoingEmailTransfer({
        Reason: 'E-Transfer sent from RBC account', Type: 'e-Transfer', AccountFlow: 'OUT',
    }), true);
    assert.equal(isOutgoingEmailTransfer({
        Reason: 'E-Transfer received in RBC account', Type: 'e-Transfer', AccountFlow: 'IN',
    }), false);
});
