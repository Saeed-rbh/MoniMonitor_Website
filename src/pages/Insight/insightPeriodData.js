const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

export const buildAllTimeInsightData = (allTransactions = {}) => {
    const totalsByYear = new Map();
    const transactions = [];

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
        current.invest += Number(value?.totalSaving) || 0;
        totalsByYear.set(year, current);

        if (Array.isArray(value?.transactions)) {
            transactions.push(...value.transactions);
        }
    });

    const years = [...totalsByYear.keys()].sort((a, b) => Number(a) - Number(b));

    return {
        labels: years,
        income: years.map((year) => totalsByYear.get(year).income),
        expense: years.map((year) => totalsByYear.get(year).expense),
        invest: years.map((year) => totalsByYear.get(year).invest),
        transactions,
    };
};
