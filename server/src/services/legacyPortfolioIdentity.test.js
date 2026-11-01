const test=require('node:test');
const assert=require('node:assert/strict');
const {validateLegacyPortfolioAccountReferences:validate}=require('./legacyPortfolioIdentity');
test('legacy portfolio rebuild refuses a second TFSA before opening the database',()=>{
    assert.throws(()=>validate([{Account:'TFSA',PortfolioAccountNumber:'HQ656S0K7CAD'},{Account:'TFSA',PortfolioAccountNumber:'WK4J413K3CAD'}]),/another bank account/);
    assert.throws(()=>validate([{Account:'TFSA',PortfolioAccountNumber:'WK5DT0WK8CAD'}]),/another bank account/);
    assert.doesNotThrow(()=>validate([{Account:'TFSA',PortfolioAccountNumber:'S0K7'},{Account:'Crypto',PortfolioAccountNumber:'HQ5YZLZ12CAD'}]));
});
