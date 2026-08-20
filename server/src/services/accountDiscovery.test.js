const test = require('node:test');
const assert = require('node:assert/strict');

const {
    describeDiscoveredAccount,
    inferAccountType,
    resolveAccountCandidate,
} = require('./accountDiscovery');

test('infers common account types from transaction details', () => {
    assert.equal(inferAccountType({ Type: 'Visa credit card' }), 'Credit Card');
    assert.equal(inferAccountType({ Type: 'Checking account' }), 'Chequing');
    assert.equal(inferAccountType({ Account: 'TFSA' }), 'TFSA');
    assert.equal(inferAccountType({ Label: 'Crypto Purchase' }), 'Crypto');
});

test('requires a stable account reference before proposing a new account', () => {
    assert.equal(describeDiscoveredAccount({ BankName: 'TD', Type: 'Chequing' }), null);
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
