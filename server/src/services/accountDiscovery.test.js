const test = require('node:test');
const assert = require('node:assert/strict');

const {
    describeDiscoveredAccount,
    getAccountReference,
    inferAccountType,
    resolveAccountCandidate,
} = require('./accountDiscovery');

test('same-mask accounts are matched in the transaction native currency', () => {
    const accounts = [
        { id: 1, accountRef: '1234', institution: 'Example', currency: 'CAD' },
        { id: 2, accountRef: '1234', institution: 'Example', currency: 'USD' },
    ];
    assert.equal(resolveAccountCandidate({ Account: '1234', Currency: 'USD' }, accounts).account.id, 2);
    assert.equal(resolveAccountCandidate({ Account: '1234', Currency: 'CAD' }, accounts).account.id, 1);
});

test('infers common account types from transaction details', () => {
    assert.equal(inferAccountType({ Type: 'Visa credit card' }), 'Credit Card');
    assert.equal(inferAccountType({ Type: 'Checking account' }), 'Chequing');
    assert.equal(inferAccountType({ Account: 'TFSA' }), 'TFSA');
    assert.equal(inferAccountType({ Label: 'Crypto Purchase' }), 'Crypto');
});

test('requires a stable account reference before proposing a new account', () => {
    assert.equal(describeDiscoveredAccount({ BankName: 'TD', Type: 'Chequing' }), null);
});

test('does not treat a generic portfolio account type as a stable account reference', () => {
    assert.equal(getAccountReference({ PortfolioAccountNumber: 'TFSA' }), null);
    assert.equal(getAccountReference({ PortfolioAccountNumber: 'RRSP' }), null);
    assert.equal(getAccountReference({ Account: 'Crypto' }), null);
});

test('builds a useful discovered account from a masked card', () => {
    assert.deepEqual(describeDiscoveredAccount({
        Account: '**** **** **** 7788',
        BankName: 'RBC Royal Bank',
        Type: 'Visa credit card',
    }), {
        name: 'RBC Credit Card •7788',
        institution: 'RBC',
        accountType: 'Credit Card',
        accountRef: '**** **** **** 7788',
    });
});

test('reuses a unique existing account by its final digits', () => {
    const existing = { id: 7, name: 'TD Visa', institution: 'TD', accountType: 'Credit Card', accountRef: '•••• 7788' };
    const result = resolveAccountCandidate({
        Account: '**** **** **** 7788',
        BankName: 'TD',
        Type: 'Credit Card',
    }, [existing]);
    assert.equal(result.account.id, 7);
    assert.equal(result.reason, 'identity_match');
});

test('matches an alphanumeric Plaid mask embedded in an existing account reference', () => {
    const account = {
        id: 10,
        name: 'TFSA',
        institution: 'Wealthsimple',
        accountType: 'TFSA',
        accountRef: 'HQ656S0K7CAD',
    };
    const transaction = { Account: 'S0K7', BankName: 'Wealthsimple (Canada)', Type: 'tfsa' };
    assert.equal(resolveAccountCandidate(transaction, [account]).account.id, 10);
});

test('attaches a reference to one matching manual account but not an ambiguous pair', () => {
    const account = { id: 9, name: 'New chequing', institution: 'TD', accountType: 'Chequing', accountRef: null };
    const transaction = { Account: '1234567', BankName: 'TD', Type: 'Chequing Account' };
    assert.equal(resolveAccountCandidate(transaction, [account]).reason, 'unique_unlinked_match');
    assert.equal(resolveAccountCandidate(transaction, [account, { ...account, id: 10 }]), null);
});

test('resolves a 3-digit masked processor payout to an existing account ending in those digits', () => {
    const cibc = { id: 7, name: 'CIBC Chequing', institution: 'CIBC', accountType: 'Chequing', accountRef: '6768237', plaidMask: '8237' };
    const rbcVisa = { id: 9, name: 'RBC Visa', institution: 'RBC', accountType: 'Credit Card', accountRef: '4510 **** **** 2379' };
    const transaction = { Account: '****237', BankName: 'Plooto', Type: 'Direct Deposit' };

    const result = resolveAccountCandidate(transaction, [rbcVisa, cibc]);
    assert.ok(result, 'Should resolve to an existing account');
    assert.equal(result.account.id, 7);
    assert.equal(result.reason, 'identity_match');
});

test('picks canonical account when multiple accounts tie with high identity score', () => {
    const canonical = { id: 10, name: 'TFSA', institution: 'Wealthsimple', accountType: 'TFSA', accountRef: 'S0K7' };
    const duplicate = { id: 326, name: 'Wealthsimple TFSA', institution: 'Wealthsimple', accountType: 'TFSA', accountRef: 'S0K7' };
    const transaction = { Account: 'S0K7', BankName: 'Wealthsimple', Type: 'TFSA' };

    const result = resolveAccountCandidate(transaction, [duplicate, canonical]);
    assert.ok(result, 'Should resolve candidate');
    assert.equal(result.account.id, 10, 'Should choose lowest id canonical account');
    assert.equal(result.reason, 'identity_match');
});

