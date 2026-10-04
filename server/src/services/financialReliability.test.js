const test = require('node:test');
const assert = require('node:assert/strict');
const { assessTransaction, reconcileSnapshots, confirmedDirectionRepair } = require('./financialReliability');
const transaction = { id: 1, AmountMinor: 1996, Currency: 'CAD', Category: 'Income', Label: 'Refunds & Reversals', AccountFlow: 'IN', Timestamp: new Date().toISOString() };
const source = { provider: 'plaid', rawPayloadJson: JSON.stringify({ amount: -19.96, iso_currency_code: 'CAD', pending: false }) };
test('posted card credit agrees with a refund and exposes an expense-direction error', () => {
    assert.equal(assessTransaction(transaction, [source]).status, 'Bank recorded');
    const issues = assessTransaction({ ...transaction, Category: 'Expense', AccountFlow: 'OUT' }, [source]).issues;
    assert.ok(issues.some(i => i.kind === 'credit_as_expense'));
    assert.ok(issues.some(i => i.kind === 'refund_direction'));
});
test('pending and missing evidence never produce a bank-recorded status', () => {
    assert.equal(assessTransaction(transaction, []).status, 'Provisional');
    assert.equal(assessTransaction(transaction, [{ ...source, rawPayloadJson: JSON.stringify({ amount: -19.96, pending: true }) }]).status, 'Provisional');
});
test('review does not conceal provider currency, amount, or removal conflicts', () => {
    const mismatch = { ...source, rawPayloadJson: JSON.stringify({ amount: -20, iso_currency_code: 'USD' }), contextPayloadJson: JSON.stringify({ providerRemoved: true }) };
    const result = assessTransaction(transaction, [mismatch], { fieldsJson: JSON.stringify({ AccountFlow: 'IN' }) });
    assert.equal(result.status, 'Needs review');
    assert.deepEqual(result.issues.map(i => i.kind), ['removed_bank_record', 'currency_conflict', 'amount_conflict']);
});
test('provisional emails have a seven-day matching grace period', () => {
    const email = { provider: 'email' };
    assert.equal(assessTransaction(transaction, [email]).issues.length, 0);
    assert.equal(assessTransaction({ ...transaction, Timestamp: '2020-01-01T12:00:00Z' }, [email]).issues[0].kind, 'unconfirmed_email');
});
test('legacy category-based income and expense posting is not a direction conflict', () => {
    assert.equal(assessTransaction({ ...transaction, AccountFlow: null }, [source]).issues.length, 0);
    assert.equal(assessTransaction({ ...transaction, Category: 'Expense', Label: 'Shopping', AccountFlow: null }, [{ ...source, rawPayloadJson: JSON.stringify({ amount: 19.96, iso_currency_code: 'CAD' }) }]).issues.length, 0);
});
test('equal provider snapshots cannot certify reconciliation without comparable cutoffs', () => {
    const snapshots = [{ cashMinor: 1000, currency: 'CAD', source: 'plaid', asOf: '2026-10-01T12:00:00Z' }, { cashMinor: 1000, currency: 'CAD', source: 'plaid', asOf: '2026-10-02T12:00:00Z' }];
    assert.equal(reconcileSnapshots({ id: 1, currency: 'CAD' }, snapshots, []).status, 'Awaiting statement cutoffs');
});
test('same-cutoff reconciliation uses liability signs and detects missing activity', () => {
    const snapshots = [{ cashMinor: 10000, currency: 'CAD', source: 'statement', asOf: '2026-09-30T23:59:59Z' }, { cashMinor: 8004, currency: 'CAD', source: 'statement', asOf: '2026-10-01T23:59:59Z' }];
    const account = { id: 1, currency: 'CAD', accountType: 'Credit Card' };
    const tx = { ...transaction, BalanceAccountId: 1, Timestamp: '2026-10-01T12:00:00Z' };
    assert.equal(reconcileSnapshots(account, snapshots, [tx]).status, 'Reconciled');
    assert.equal(reconcileSnapshots(account, snapshots, []).differenceMinor, -1996);
});
test('automatic direction repair requires one posted source, matching currency, amount and account, and no review override', () => {
    const tx = { ...transaction, AccountFlow: 'OUT', BalanceAccountId: 4 };
    const bank = { ...source, contextPayloadJson: JSON.stringify({ account: { appAccountId: 4 } }) };
    assert.deepEqual(confirmedDirectionRepair(tx, [bank], null), { AccountFlow: 'IN' });
    assert.equal(confirmedDirectionRepair(tx, [bank], {}), null);
    assert.equal(confirmedDirectionRepair(tx, [bank, bank], null), null);
    assert.equal(confirmedDirectionRepair({ ...tx, Currency: 'USD' }, [bank], null), null);
    assert.equal(confirmedDirectionRepair({ ...tx, BalanceAccountId: 5 }, [bank], null), null);
});
