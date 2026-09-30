// Credit cards store debt as positive and overpayments as negative. Other
// accounts store cash as positive and overdraft/margin debt as negative.
function cashPositionOf(account) {
    const cashMinor = Number(account.cashMinor || 0);
    if (!Number.isSafeInteger(cashMinor)) throw new Error('Account balance must be safe integer cents');
    const netCashMinor = account.accountType === 'Credit Card' ? -cashMinor : cashMinor;
    return { netCashMinor, assetCashMinor: Math.max(0, netCashMinor), liabilityMinor: Math.max(0, -netCashMinor) };
}

module.exports = { cashPositionOf };
