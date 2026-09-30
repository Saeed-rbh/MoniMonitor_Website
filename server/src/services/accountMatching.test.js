const test = require('node:test');
const assert = require('node:assert/strict');

const { accountMatchScore, transactionBalanceDelta } = require('./accountMatching');

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

test('matches a 3-digit masked transaction against an account ending in the same digits or Plaid mask', () => {
    const cibc = { id: 7, name: 'CIBC Chequing', institution: 'CIBC', accountType: 'Chequing', accountRef: '6768237', plaidMask: '8237' };
    const rbcVisa = { id: 9, name: 'RBC Visa', institution: 'RBC', accountType: 'Credit Card', accountRef: '4510 **** **** 2379' };
    const tx = { Account: '****237', BankName: 'Plooto', Type: 'Direct Deposit' };

    const cibcScore = accountMatchScore(tx, cibc);
    const rbcScore = accountMatchScore(tx, rbcVisa);

    assert.ok(cibcScore >= 95, `Expected CIBC score >= 95, got ${cibcScore}`);
    assert.equal(rbcScore, 0, 'RBC Visa ending in 2379 must not match suffix 237');
});
