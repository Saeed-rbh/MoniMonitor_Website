const test = require('node:test');
const assert = require('node:assert/strict');
const { getSavingEffectMinor } = require('./transactionClassification');

test('counts only the TFSA-side transfer as a contribution', () => {
    const transfer = {
        AmountMinor: 100000,
        Category: 'Saving',
        Label: 'Internal Transfer',
        Reason: 'Internal transfer: RBC Chequing -> TFSA [XFER-1]',
    };
    assert.equal(getSavingEffectMinor({ ...transfer, Account: 'RBC Chequing' }), 0);
    assert.equal(getSavingEffectMinor({ ...transfer, Account: 'TFSA' }), 100000);
});

test('subtracts TFSA withdrawals and ignores non-TFSA transfers and trades', () => {
    assert.equal(getSavingEffectMinor({
        AmountMinor: 20000,
        Category: 'Saving',
        Label: 'Internal Transfer',
        Reason: 'Internal transfer: TFSA -> Future [XFER-2]',
        Account: 'TFSA',
    }), -20000);
    assert.equal(getSavingEffectMinor({
        AmountMinor: 1651556,
        Category: 'Saving',
        Label: 'Internal Transfer',
        Reason: 'Internal transfer: TFSA (OLD) -> TFSA (NEW) [XFER-2B]',
        Account: 'TFSA',
        AccountFlow: 'OUT',
    }), 0);
    assert.equal(getSavingEffectMinor({
        AmountMinor: 50000,
        Category: 'Saving',
        Label: 'Internal Transfer',
        Reason: 'Internal transfer: RBC Chequing -> Future [XFER-3]',
        Account: 'Future',
    }), 0);
    assert.equal(getSavingEffectMinor({
        AmountMinor: 10000,
        Category: 'Saving',
        Label: 'Stocks',
        Reason: 'Bought VFV',
        Account: 'TFSA',
    }), 0);
});

test('supports the new saving and investment labels', () => {
    assert.equal(getSavingEffectMinor({
        AmountMinor: 75000,
        Category: 'Saving',
        Label: 'Savings Contributions',
        Account: 'TFSA',
    }), 75000);
    assert.equal(getSavingEffectMinor({
        AmountMinor: 12500,
        Category: 'Saving',
        Label: 'Crypto Funding',
        Account: 'Crypto',
    }), 12500);
    assert.equal(getSavingEffectMinor({
        AmountMinor: 20000,
        Category: 'Investment',
        Label: 'Asset Distribution',
        PortfolioAction: 'WITHDRAWAL',
        Account: 'TFSA',
    }), -20000);
});

test('posted investment interest and cash dividends are income while principal movements and valuations are excluded',()=>{
 const {isIncome,isExpense,matchesReportingCategory}=require('./transactionClassification');
 const interest={AmountMinor:10135,Category:'Investment',Label:'Investment Interest',PortfolioAction:'INTEREST',AccountFlow:'IN',PostingStatus:'posted'};
 for(const action of ['INTEREST','DIVIDEND']){
  const tx={...interest,PortfolioAction:action};
  assert.equal(isIncome(tx),true);assert.equal(isExpense(tx),false);assert.equal(matchesReportingCategory(tx,'Income'),true);
 }
 for(const fields of [{PortfolioAction:'SELL'},{PortfolioAction:'TRANSFER'},{PortfolioAction:'DEPOSIT'},{PortfolioAction:'CONTRIBUTION'},{PortfolioAction:'WITHDRAWAL'},{PortfolioAction:'DISTRIBUTION'},{AccountFlow:'NONE'},{AccountFlow:'OUT'},{AmountMinor:0},{PostingStatus:'pending'},{PostingStatus:'unposted'},{Label:'Internal Transfer'},{Category:'Internal'}]){
  assert.equal(isIncome({...interest,...fields}),false,JSON.stringify(fields));
 }
 assert.equal(interest.Category,'Investment');
});
