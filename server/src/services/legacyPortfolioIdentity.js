// This legacy importer rebuilds one TFSA and one crypto account. It cannot
// safely combine statements from several accounts sharing a tax designation.
function validateLegacyPortfolioAccountReferences(rows) {
    const supported={TFSA:'HQ656S0K7CAD',Crypto:'HQ5YZLZ12CAD'};
    for(const row of rows) {
        const expected=supported[row.Account];
        const reference=String(row.PortfolioAccountNumber||'').replace(/[^a-z0-9]/gi,'').toUpperCase();
        if(expected && reference && /\d/.test(reference) && !expected.endsWith(reference) && !expected.replace(/CAD$/,'').endsWith(reference) && !reference.endsWith(expected)) {
            throw new Error('Legacy portfolio import contains another bank account; use an account-specific reviewed import instead of combining account histories');
        }
    }
}
module.exports={validateLegacyPortfolioAccountReferences};
