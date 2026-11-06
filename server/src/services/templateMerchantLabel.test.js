const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyTemplateMerchant } = require('./templateMerchantLabel');
const { parseKnownEmail } = require('./emailTemplates');

test('template purchase uses AI only for the merchant label and preserves financial evidence',async()=>{
 const source='From: RBC <rbcroyalbankalerts@alerts.rbc.com>\nSubject: You made a purchase.\nAccount: ****1234\nPurchase Amount: $15.63\nTransaction Date: November 05, 2026\nTransaction Description: EXAMPLE SUPERMARKET';
 const original=parseKnownEmail(source);
 let calls=0;
 const result=await classifyTemplateMerchant(original,async request=>{
  calls++;assert.match(request.contents,/EXAMPLE SUPERMARKET/);
  assert.ok(request.config.responseJsonSchema.properties.Label.enum.includes('Groceries'));
  return {text:JSON.stringify({Label:'Groceries',Amount:'999',Category:'Income'})};
 });
 assert.equal(calls,1);assert.deepEqual(result,{...original,Label:'Groceries'});
 assert.equal(original.Label,'Other Expense');
});

test('specific labels, non-expense events and portfolio activity skip merchant classification',async()=>{
 for(const tx of [{Category:'Expense',Label:'Groceries',Reason:'Shop'}, {Category:'Income',Label:'Other Income',Reason:'Deposit'}, {Category:'Expense',Label:'Other Expense',Reason:'Trade',PortfolioAction:'FEE'}])
  assert.equal(await classifyTemplateMerchant(tx,()=>assert.fail('must not call AI')),tx);
});

test('invalid AI merchant output cannot silently change a category or label',async()=>{
 const tx={Category:'Expense',Label:'Other Expense',Reason:'Shop'};
 await assert.rejects(classifyTemplateMerchant(tx,async()=>({text:'{"Label":"Employment Income"}'})));
 assert.equal(tx.Label,'Other Expense');
});
