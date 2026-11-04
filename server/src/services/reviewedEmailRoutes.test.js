const test = require('node:test');
const assert = require('node:assert/strict');
const { applyReviewedEmailRoute, routeEmailForUser } = require('./reviewedEmailRoutes');
const body = 'From: Wealthsimple <notifications@o.wealthsimple.com>\nSubject: Your order has been filled\nAccount: TFSA\nSymbol: ABC';
const accounts = [
    { id: 10, institution: 'Wealthsimple', accountType: 'TFSA', currency: 'CAD', accountRef: 'TRADING', name: 'Wealthsimple TFSA' },
    { id: 14, institution: 'Wealthsimple', accountType: 'TFSA', currency: 'CAD', accountRef: 'OTHER', name: 'Managed TFSA' },
];
const route = { sender: 'notifications@o.wealthsimple.com', subject: 'Your order has been filled', accountLabel: 'TFSA', currency: 'CAD', accountId: 10, evidence: 'User confirmed the same account', reviewedAt: '2026-11-02T18:00:00Z' };
const tx = { PortfolioAction: 'BUY', Currency: 'CAD', Account: 'TFSA', IngestionReviewReason: 'ambiguous_account' };
test('a confirmed template route resolves multiple TFSA accounts across symbols and model guesses', () => {
    for (const symbol of ['ABC', 'XYZ']) for (const action of ['BUY', 'SELL']) {
        const result = applyReviewedEmailRoute({ ...tx, PortfolioAction: action, PortfolioAccountNumber: 'OTHER' }, body.replace('ABC', symbol), accounts, [route]);
        assert.equal(result.PortfolioAccountId, 10);
        assert.equal(result.BalanceAccountId, 10);
        assert.equal(result.Account, 'TRADING');
        assert.equal(result.IngestionReviewReason, null);
    }
});
test('no route, conflicting routes and unrelated templates remain unresolved', () => {
    for (const routes of [[], [route, { ...route, accountId: 14 }]]) assert.equal(applyReviewedEmailRoute(tx, body, accounts, routes), tx);
    for (const changed of [body.replace('notifications@o.wealthsimple.com', 'other@example.com'), body.replace('TFSA', 'RRSP'), body.replace('Your order has been filled', 'You made a transfer'), body.replace('Account: TFSA', 'Account:\nSymbol: ABC')]) {
        assert.equal(applyReviewedEmailRoute(tx, changed, accounts, [route]), tx);
    }
    assert.equal(applyReviewedEmailRoute({ ...tx, PortfolioAction: 'TRANSFER' }, body, accounts, [route]).PortfolioAccountId, undefined);
});
test('routing rejects a missing, archived, wrong-type or wrong-currency destination', () => {
    for (const candidate of [null, { ...accounts[0], name: 'Archived TFSA' }, { ...accounts[0], accountType: 'RRSP' }, { ...accounts[0], currency: 'USD' }]) {
        assert.equal(applyReviewedEmailRoute(tx, body, candidate ? [candidate] : [], [route]), tx);
    }
    const result = applyReviewedEmailRoute({ ...tx, IngestionReviewReason: 'unconfirmed_currency' }, body, accounts, [route]);
    assert.equal(result.IngestionReviewReason, 'unconfirmed_currency');
});
test('route lookup is scoped to the current user', async () => {
    const db = { exec: async () => {}, all: async (sql, params) => { assert.deepEqual(params, ['owner']); return []; } };
    assert.equal(await routeEmailForUser(db, 'owner', tx, body, accounts), tx);
});
