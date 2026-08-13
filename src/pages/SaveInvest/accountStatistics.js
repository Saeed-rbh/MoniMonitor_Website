const MONTH_KEY = /^\d{4}-\d{2}$/;

const normalize = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

const matchesAccount = (transaction, account) => {
  if (Number(transaction?.PortfolioAccountId) === Number(account?.id)) return true;
  const transactionAccount = normalize(transaction?.Account);
  if (!transactionAccount) return false;
  return [account?.name, account?.accountRef]
    .map(normalize)
    .filter(Boolean)
    .some((identity) => transactionAccount === identity ||
      transactionAccount.includes(identity) || identity.includes(transactionAccount));
};

const transactionFlow = (transaction) => {
  const explicitFlow = String(transaction?.AccountFlow || "").toUpperCase();
  if (explicitFlow === "IN" || explicitFlow === "OUT") return explicitFlow;
  const category = String(transaction?.Category || "").toLowerCase();
  const type = String(transaction?.Type || "").toLowerCase();
  if (category === "income" || type === "income" || type === "credit") return "IN";
  if (category === "expense" || type === "expense" || type === "debit") return "OUT";
  return null;
};

export const buildAccountStatistics = (accounts = [], allTransactions = {}) => {
  const transactions = Object.entries(allTransactions)
    .filter(([key]) => MONTH_KEY.test(key))
    .flatMap(([, value]) => Array.isArray(value?.transactions) ? value.transactions : []);

  return accounts.map((account) => {
    const matchingTransactions = transactions
      .filter((transaction) => matchesAccount(transaction, account))
      .sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));
    let moneyInMinor = 0;
    let moneyOutMinor = 0;

    matchingTransactions.forEach((transaction) => {
      const amountMinor = Number.isFinite(Number(transaction?.AmountMinor))
        ? Number(transaction.AmountMinor)
        : Math.round((Number(transaction?.Amount) || 0) * 100);
      const flow = transactionFlow(transaction);
      if (flow === "IN") moneyInMinor += amountMinor;
      if (flow === "OUT") moneyOutMinor += amountMinor;
    });

    return {
      account,
      moneyInMinor,
      moneyOutMinor,
      netFlowMinor: moneyInMinor - moneyOutMinor,
      transactionCount: matchingTransactions.length,
      firstActivity: matchingTransactions[0]?.Timestamp || null,
      latestActivity: matchingTransactions.at(-1)?.Timestamp || null,
    };
  });
};
