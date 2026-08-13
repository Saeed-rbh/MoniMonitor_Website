const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

export const getVisibleInsightPeriodCount = ({
    viewMode,
    year,
    month,
    totalPeriods,
    now = new Date(),
}) => {
    const safeTotal = Math.max(0, Number(totalPeriods) || 0);
    if (viewMode === 'alltime') return safeTotal;

    const currentYear = now.getFullYear();
    if (Number(year) < currentYear) return safeTotal;
    if (Number(year) > currentYear) return 0;

    if (viewMode === 'yearly') {
        return Math.min(safeTotal, now.getMonth() + 1);
    }

    const currentMonth = now.getMonth();
    if (Number(month) < currentMonth) return safeTotal;
    if (Number(month) > currentMonth) return 0;
    return Math.min(safeTotal, now.getDate());
};

export const getCurrentInvestmentValue = (portfolio = {}) =>
    (portfolio.accounts || [])
        .filter((account) => {
            const type = String(account?.accountType || '').toLowerCase();
            const name = String(account?.name || '').toLowerCase();
            return type === 'tfsa' || type === 'crypto' ||
                name.includes('tfsa') || name.includes('crypto');
        })
        .reduce((sum, account) => sum + Number(account?.totalValueMinor || 0), 0) / 100;

export const buildAllTimeInsightData = (allTransactions = {}) => {
    const totalsByYear = new Map();
    const transactions = [];
    let accountBalance = 0;

    Object.entries(allTransactions).forEach(([key, value]) => {
        const match = key.match(MONTH_KEY_PATTERN);
        if (!match) return;

        const year = match[1];
        const current = totalsByYear.get(year) || {
            income: 0,
            expense: 0,
            invest: 0,
        };

        current.income += Number(value?.totalIncome) || 0;
        current.expense += Number(value?.totalExpense) || 0;
        current.invest += Number(value?.totalSaveInvest ?? value?.totalSaving) || 0;
        totalsByYear.set(year, current);

        if (Array.isArray(value?.transactions)) {
            transactions.push(...value.transactions);
            value.transactions.forEach((transaction) => {
                const amount = Number(transaction?.Amount) || 0;
                const category = String(transaction?.Category || '').toLowerCase();
                const type = String(transaction?.Type || '').toLowerCase();
                const accountFlow = String(transaction?.AccountFlow || '').toUpperCase();

                if (category === 'income' || type === 'income' || type === 'credit') {
                    accountBalance += amount;
                } else if (category === 'expense' || type === 'expense' || type === 'debit') {
                    accountBalance -= amount;
                } else if (accountFlow === 'IN') {
                    accountBalance += amount;
                } else if (accountFlow === 'OUT') {
                    accountBalance -= amount;
                }
            });
        }
    });

    const years = [...totalsByYear.keys()].sort((a, b) => Number(a) - Number(b));

    return {
        labels: years,
        income: years.map((year) => totalsByYear.get(year).income),
        expense: years.map((year) => totalsByYear.get(year).expense),
        invest: years.map((year) => totalsByYear.get(year).invest),
        transactions,
        accountBalance,
    };
};
