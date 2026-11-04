// Only explicit internal-transfer evidence is excluded. An external e-transfer
// or a transaction merely labelled "Transfer" can still be income or spending.
export const isInternalTransfer = (transaction) =>
  transaction?.PortfolioAction === 'TRANSFER' || transaction?.Category === 'Transfer' ||
  (Number(transaction?.TransferFromAccountId) > 0 &&
    Number(transaction?.TransferToAccountId) > 0 &&
    Number(transaction.TransferFromAccountId) !== Number(transaction.TransferToAccountId));

// A security purchase/sale exchanges cash and holdings inside the portfolio.
// Its gross amount is neither a new savings contribution nor household cash flow.
export const isInvestmentTrade = (transaction) =>
  ['BUY', 'SELL'].includes(transaction?.PortfolioAction) ||
  ['EMAIL_BUY', 'EMAIL_SELL'].includes(transaction?.PortfolioPostingKind);

export const isExcludedFromCashFlow = (transaction) =>
  isInternalTransfer(transaction) || isInvestmentTrade(transaction);

export const isSavingsContribution = (transaction) =>
  !isExcludedFromCashFlow(transaction) &&
  ['Saving', 'Save&Invest', 'Investment'].includes(transaction?.Category);
