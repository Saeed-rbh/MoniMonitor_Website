const MONTH_KEY = /^\d{4}-\d{2}$/;

const normalize = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

const accountMatchScore = (transaction, account) => {
  if (Number(transaction?.PortfolioAccountId) === Number(account?.id)) return 1000;
  if (Number(transaction?.BalanceAccountId) === Number(account?.id)) return 1000;
  const transactionAccount = normalize(transaction?.Account);
  if (!transactionAccount) return 0;
  const accountRef = normalize(account?.accountRef);
  const accountName = normalize(account?.name);
  if (accountRef && transactionAccount === accountRef) return 200;
  if (accountRef && transactionAccount.length >= 4 &&
      (accountRef.includes(transactionAccount) || transactionAccount.includes(accountRef))) return 180;
  if (accountName && transactionAccount === accountName) return 160;
  if (accountName && transactionAccount.length >= 4 &&
      (accountName.includes(transactionAccount) || transactionAccount.includes(accountName))) return 80;
  return 0;
};

export const matchesAccount = (transaction, account) => accountMatchScore(transaction, account) > 0;

const uniquelyMatchesAccount = (transaction, account, accounts) => {
  const ranked = accounts
    .map((candidate) => ({ candidate, score: accountMatchScore(transaction, candidate) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length || ranked[0].score === ranked[1]?.score) return false;
  return Number(ranked[0].candidate.id) === Number(account.id);
};

export const getAccountTransactions = (account, allTransactions = {}, accounts = [account]) =>
  Object.entries(allTransactions)
    .filter(([key]) => MONTH_KEY.test(key))
    .flatMap(([, value]) => Array.isArray(value?.transactions) ? value.transactions : [])
    .filter((transaction) => uniquelyMatchesAccount(transaction, account, accounts))
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));

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
  return accounts.map((account) => {
    const matchingTransactions = getAccountTransactions(account, allTransactions, accounts).reverse();
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

export const withRecordedTransactions = (statistics = []) =>
  statistics.filter((item) => Number(item?.transactionCount || 0) > 0);
