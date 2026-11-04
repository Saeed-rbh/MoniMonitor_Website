const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmailEvidence, resolveAccount, sourceTimestamp } = require('./emailEvidence');
const accounts = [
 {id:1,institution:'Wealthsimple',name:'Wealthsimple TFSA •A123',accountType:'TFSA',accountRef:'A123',currency:'CAD'},
 {id:2,institution:'Wealthsimple',name:'Wealthsimple TFSA',accountType:'TFSA',accountRef:'B123',currency:'CAD'},
 {id:3,institution:'Wealthsimple',name:'Earnings',accountType:'Chequing',accountRef:'1832',currency:'CAD'},
 {id:4,institution:'Wealthsimple',name:'Savings',accountType:'Savings',accountRef:'WX05',currency:'CAD'},
];
const header = 'From: "Wealthsimple" <notifications@o.wealthsimple.com>\nTo: owner@example.com\n';
test('ambiguous account type requires a reviewed mapping, not the first TFSA', () => {
 assert.equal(resolveAccount('TFSA','Wealthsimple',accounts),null);
 assert.equal(resolveAccount('TFSA','Wealthsimple',accounts,[{institution:'Wealthsimple',label:'TFSA',accountId:1}]).id,1);
 assert.equal(resolveAccount('TFSA','Wealthsimple',accounts,[{institution:'Wealthsimple',label:'TFSA',accountId:999}]),null);
});
test('filled order fields override model guesses with source evidence and reviewed identity', () => {
 const body = header + 'Subject: Your order has been filled\n\nAccount: TFSA\nType: Fractional Buy\nSymbol: ABC\nShares: 0.25\nAverage price: $40.00\nTotal cost: $10.00\nTime: October 01, 2026 12:02 EDT';
 const tx = normalizeEmailEvidence({Amount:'500',Category:'Expense',PortfolioAccountId:2,PortfolioSymbol:'XYZ'},body,accounts,[{institution:'Wealthsimple',label:'TFSA',accountId:1}]);
 assert.equal(tx.Amount,'10.00');assert.equal(tx.PortfolioAccountId,1);assert.equal(tx.PortfolioSymbol,'ABC');
 assert.equal(tx.PortfolioQuantity,0.25);assert.equal(tx.PortfolioPrice,40);assert.equal(tx.Currency,'CAD');
 assert.equal(tx.Category,'Saving');assert.equal(tx.Label,'Investment');assert.equal(tx.Timestamp,'2026-10-01T16:02:00.000Z');
});
test('transfer reads financial From/To rather than email routing headers', () => {
 const body = header + 'Subject: You made a transfer\nAmount: $50.00 CAD\nFrom: Earnings (Chequing)\nTo: Savings (******X05CAD)';
 const tx = normalizeEmailEvidence({},body,accounts);
 assert.equal(tx.TransferFromAccountId,3);assert.equal(tx.TransferToAccountId,4);assert.equal(tx.TransferConfidence,'HIGH');
 assert.equal(tx.PortfolioAction,'TRANSFER');assert.equal(tx.Amount,'50.00');
});
test('security deposit is not cash, even when model calls the valuation a deposit', () => {
 const body=header+'Subject: You’ve received crypto from another wallet!\nAccount: Crypto\nCryptocurrency: ETH\nYou’ve recieved 0.29572 ETH (CA$1,008.4) in your account.';
 const tx=normalizeEmailEvidence({PortfolioAction:'DEPOSIT',Amount:'1008.4'},body,[]);
 assert.equal(tx.PortfolioAction,'ASSET_TRANSFER_IN');assert.equal(tx.Amount,'0');assert.equal(tx.PortfolioQuantity,0.29572);
});
test('unexecuted orders never create trade postings', () => {
 assert.deepEqual(normalizeEmailEvidence({},header+'Subject: Your order has been cancelled',accounts),{error:'Unexecuted order; no financial posting'});
});
test('time conversion handles afternoon and named daylight saving offset', () => {
 assert.equal(sourceTimestamp('Time: October 20, 2026 3:42 PM, EDT'),'2026-10-20T19:42:00.000Z');
});
test('RBC card alerts are posted immediately and refunds use incoming direction', () => {
 const tx=normalizeEmailEvidence({Category:'Expense',Type:'Credit Card'},'From: "RBC" <rbcroyalbankalerts@alerts.rbc.com>\nSubject: Credit card alert\nA refund was credited to your card',accounts);
 assert.equal(tx.Category,'Income');assert.equal(tx.PostingStatus,'posted');
});

test('structured parsing reads a filled order directly without a model', () => {
 const {parseStructuredEmail}=require('./emailEvidence');
 const result=parseStructuredEmail(header+'Subject: Your order has been filled\nAccount: TFSA\nType: Fractional Buy\nSymbol: ABC\nShares: 0.25\nAverage price: $40.00\nTotal cost: $10.00',accounts,[{institution:'Wealthsimple',label:'TFSA',accountId:1}],'2026-10-01T12:00:00Z');
 assert.equal(result.PortfolioAction,'BUY');assert.equal(result.PortfolioAccountId,1);assert.equal(result.Amount,'10.00');
 assert.equal(parseStructuredEmail('From: merchant@example.com\nSubject: Your order has been filled',accounts,[],'2026-10-01'),null);
});
test('direct deposit account selection requires a reviewed template mapping', () => {
 const body=header+'Subject: Direct deposit received\nAmount: $20.00';
 const without=normalizeEmailEvidence({Category:'Income'},body,accounts,[]);
 assert.equal(without.BalanceAccountId,undefined);
 const mapped=normalizeEmailEvidence({Category:'Income'},body,accounts,[{institution:'Wealthsimple',label:'Direct deposit received',accountId:3}]);
 assert.equal(mapped.BalanceAccountId,3);assert.equal(mapped.Amount,'20.00');
});

test('email authorization evidence overrides a pending status', () => {
 const tx=normalizeEmailEvidence({Category:'Expense',Type:'Credit Card',PostingStatus:'pending'},'From: "RBC" <rbcroyalbankalerts@alerts.rbc.com>\nSubject: Credit card alert\nPurchase authorized',accounts);
 assert.equal(tx.PostingStatus,'posted');
 assert.equal(tx.Category,'Expense');
});
