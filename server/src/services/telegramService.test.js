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

test('current investment categories are muted even with specific asset labels', () => {
    assert.equal(isInvestmentNotification({ Category: 'Investment', Label: 'ETF & Stock Purchase', Amount: 500 }), true);
});

test('queued investment messages retain content and buttons while ordinary alerts stay audible', async (t) => {
    const dbService = require('../database/dbService');
    const { notifyAndSave } = require('../../email_agent');
    const queued = [];
    t.mock.method(dbService, 'enqueueTelegramOutbox', async (action, payload, options) => {
        queued.push({ action, payload, options });
        return queued.length;
    });
    await notifyAndSave({ id: 1, Category: 'Investment', Label: 'ETF & Stock Purchase', Amount: 500 });
    await notifyAndSave({ id: 2, Category: 'Expense', Label: 'Food', Amount: 50 });
    assert.equal(queued[0].payload.silent, true);
    assert.ok(queued[0].payload.text);
    assert.ok(queued[0].payload.replyMarkup);
    assert.equal(queued[0].options.transactionId, 1);
    assert.equal(queued[1].payload.silent, false);
});
