const test = require('node:test');
const assert = require('node:assert/strict');
const { enrichGenericEmailReason } = require('../../email_agent');

test('adds factual account context when an email only says deposit', () => {
    assert.equal(enrichGenericEmailReason({
        Label: 'Cash & Cheque Deposits',
        Reason: 'Deposit',
        BankName: 'Test Bank',
        Type: 'Checking Account',
        Account: 'Primary Chequing',
        AccountFlow: 'IN',
    }), 'Deposit to Test Bank Checking Account Primary Chequing');
});

test('keeps a specific email reason unchanged', () => {
    assert.equal(enrichGenericEmailReason({
        Label: 'Personal Transfers Received',
        Reason: 'E-Transfer - Jane Doe',
        BankName: 'Test Bank',
        Account: '********6554',
    }), 'E-Transfer - Jane Doe');
});
