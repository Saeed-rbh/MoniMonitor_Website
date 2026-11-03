const assert = require('node:assert/strict');
const test = require('node:test');
const { isInvestmentNotification } = require('./telegramService');

test('investment messages are silent regardless of amount or recurrence detection', () => {
    assert.equal(isInvestmentNotification({ Label: 'Investment', Amount: 500, Frequency: 'OneTime' }), true);
    assert.equal(isInvestmentNotification({ Label: ' investment ', Amount: 5000 }), true);
    for (const PortfolioAction of ['BUY', 'SELL', 'CONTRIBUTION', 'DIVIDEND', 'ASSET_TRANSFER_IN', 'ASSET_TRANSFER_OUT']) {
        assert.equal(isInvestmentNotification({ Label: 'Savings', PortfolioAction }), true);
    }
});

test('ordinary bank activity does not acquire the investment mute', () => {
    for (const PortfolioAction of [null, 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'INTEREST']) {
        assert.equal(isInvestmentNotification({ Label: 'Savings', PortfolioAction }), false);
    }
    assert.equal(isInvestmentNotification({ Label: 'Food', Amount: 100 }), false);
    assert.equal(isInvestmentNotification({}), false);
});
