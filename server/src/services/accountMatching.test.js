const test = require('node:test');
const assert = require('node:assert/strict');

const { transactionBalanceDelta } = require('./accountMatching');

test('uses explicit account flow for cash accounts', () => {
    const chequing = { accountType: 'Chequing' };
    assert.equal(transactionBalanceDelta({ AccountFlow: 'IN', Category: 'Saving' }, chequing, 2500), 2500);
    assert.equal(transactionBalanceDelta({ AccountFlow: 'OUT', Category: 'Saving' }, chequing, 2500), -2500);
    assert.equal(transactionBalanceDelta({ AccountFlow: 'NONE', Category: 'Income' }, chequing, 2500), null);
});

test('stores a credit-card outflow as debt and an inflow as repayment', () => {
    const creditCard = { accountType: 'Credit Card' };
    assert.equal(transactionBalanceDelta({ AccountFlow: 'OUT' }, creditCard, 2500), 2500);
    assert.equal(transactionBalanceDelta({ AccountFlow: 'IN' }, creditCard, 2500), -2500);
});

test('falls back to income and expense categories when flow is absent', () => {
    const chequing = { accountType: 'Chequing' };
    assert.equal(transactionBalanceDelta({ Category: 'Income' }, chequing, 2500), 2500);
    assert.equal(transactionBalanceDelta({ Category: 'Expense' }, chequing, 2500), -2500);
});
