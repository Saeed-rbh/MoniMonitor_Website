const test = require('node:test');
const assert = require('node:assert/strict');
const { parseKnownEmail } = require('./emailTemplates');
const providerModule = require('./aiProvider');
const dbModule = require('../database/db');
const scheduler = require('./aiScheduler');
let calls = [], output;
providerModule.createProvider = () => ({ enabled: true, identity: 'test:ai', provider: 'test', generate: async request => {
    calls.push(request); return { text: JSON.stringify(output) };
} });
dbModule.getDb = async () => ({});
scheduler.reserveDailyUsage = async () => {};
const { parseEmailWithGemini } = require('./aiService');
const fixtures = [
 'From: RBC <rbcroyalbankalerts@alerts.rbc.com>\nSubject: You made a purchase.\nAccount: ****1234\nPurchase Amount: $15.63\nTransaction Date: November 05, 2026\nTransaction Description: EXAMPLE SUPERMARKET',
 'From: RBC <rbcroyalbankalerts@alerts.rbc.com>\nSubject: Deposit Notice\nAccount: ****1234\nDeposit Amount: $100.00\nTransaction Date: November 05, 2026',
 'From: Wealthsimple <notifications@o.wealthsimple.com>\nSubject: Your order has been filled\nAccount: TFSA\nType: Fractional Buy\nSymbol: QQC\nShares: 0.2\nAverage price: $50\nTotal cost: $10.00\nTime: October 20, 2026 12:05 EDT',
];
for (const [index, source] of fixtures.entries()) {
 test(`recognized ${['expense','income','investment'][index]} template still requires AI extraction`, async () => {
    output = parseKnownEmail(source);
    assert.ok(output, 'fixture must be a recognized template');
    delete output.Evidence.Reason;
    if (index === 0) { output.Label = 'Groceries'; output.Timestamp = '2026-11-05'; }
    calls = [];
    const parsed = await parseEmailWithGemini(source, [], [], { bypassCache: true, examples: [] });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].config.responseJsonSchema);
    assert.equal(parsed.Label, output.Label);
    if (index === 0) assert.equal(parsed.Timestamp, '2026-11-05');
    assert.equal(parsed.ExtractionVersion, require('./extractionEvidence').VERSION);
 });
}
