const { parseTimestamp } = require('../../../shared/calendar.cjs');
const { isReportingCurrency } = require('../../../shared/currency.cjs');

function transactionCalendarDate(timestamp) {
    const date = parseTimestamp(timestamp);
    return date ? { year: date.year, month: date.month, day: date.day } : null;
}
function amountOf(transaction) {
    const amount = Number(transaction?.Amount);
    if (Number.isFinite(amount)) return Math.abs(amount);
    const minor = Number(transaction?.AmountMinor);
    return Number.isFinite(minor) ? Math.abs(minor) / 100 : 0;
}

const isIncome = (transaction) => (
    transaction?.Category === 'Income' ||
    transaction?.Type === 'Income' ||
    transaction?.Type === 'Credit'
);

const isExpense = (transaction) => (
    transaction?.Category === 'Expense' ||
    transaction?.Type === 'Expense' ||
    transaction?.Type === 'Debit'
);

function investmentKind(account) {
    const type = String(account?.accountType || '').toLowerCase();
    const name = String(account?.name || '').toLowerCase();
    if (type === 'tfsa' || name.includes('tfsa')) return 'tfsa';
    if (type === 'crypto' || name.includes('crypto')) return 'crypto';
    return null;
}

function investmentContributionDelta(transaction, investmentAccountIds) {
    const accountName = String(transaction?.Account || '').toLowerCase();
    const accountId = Number(transaction?.PortfolioAccountId ?? transaction?.BalanceAccountId);
    const belongsToInvestmentAccount = accountName.includes('tfsa') ||
        accountName.includes('crypto') || investmentAccountIds.has(accountId);
    if (!belongsToInvestmentAccount) return 0;

    const action = String(transaction?.PortfolioAction || '').toUpperCase();
    if (!['TRANSFER', 'CONTRIBUTION', 'DEPOSIT', 'WITHDRAWAL'].includes(action)) return 0;

    const amount = amountOf(transaction);
    const flow = String(transaction?.AccountFlow || '').toUpperCase();
    if (flow === 'OUT' || action === 'WITHDRAWAL') return -amount;
    if (flow === 'IN' || ['CONTRIBUTION', 'DEPOSIT'].includes(action)) return amount;

    // Imported internal-transfer destination legs use NONE because their paired
    // source leg already describes the cash direction. At the destination,
    // this is still money contributed to the investment account.
    if (action === 'TRANSFER' && transaction?.Category === 'Internal') return amount;
    return 0;
}

function buildCashFlowWidgetPayload(transactions, portfolio, now = new Date()) {
    const otherCurrencies = [...new Set(transactions.filter((transaction) => !isReportingCurrency(transaction)).map((transaction) => transaction.Currency))];
    transactions = transactions.filter(isReportingCurrency);
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const incomeByDay = Array(daysInMonth).fill(0);
    const expenseByDay = Array(daysInMonth).fill(0);
    const investmentByDay = Array(daysInMonth).fill(0);
    const investmentAccountIds = new Set((portfolio?.accounts || [])
        .filter(investmentKind)
        .map((account) => Number(account.id)));

    const current = transactions
        .map((transaction) => ({ transaction, date: transactionCalendarDate(transaction.Timestamp) }))
        .filter(({ date }) => date?.year === year && date?.month === month);
    for (const { transaction, date } of current) {
        const { day } = date;
        if (day < 1 || day > daysInMonth) continue;
        if (isIncome(transaction)) incomeByDay[day - 1] += amountOf(transaction);
        else if (isExpense(transaction)) expenseByDay[day - 1] += amountOf(transaction);
        investmentByDay[day - 1] += investmentContributionDelta(transaction, investmentAccountIds);
    }

    const totalIncome = incomeByDay.reduce((sum, value) => sum + value, 0);
    const totalExpense = expenseByDay.reduce((sum, value) => sum + value, 0);
    const balance = totalIncome - totalExpense;
    const previousDate = new Date(year, month - 1, 1);
    let previousIncome = 0;
    let previousExpense = 0;
    const maxDay = current.length
        ? Math.max(...current.map(({ date }) => date.day))
        : now.getDate();

    for (const transaction of transactions) {
        const date = transactionCalendarDate(transaction.Timestamp);
        if (!date || date.year !== previousDate.getFullYear() || date.month !== previousDate.getMonth() || date.day > maxDay) continue;
        if (isIncome(transaction)) previousIncome += amountOf(transaction);
        else if (isExpense(transaction)) previousExpense += amountOf(transaction);
    }

    const previousBalance = previousIncome - previousExpense;
    const percentageChange = previousBalance === 0
        ? null
        : Math.round(((balance - previousBalance) / Math.abs(previousBalance)) * 100);
    const anchorDay = Math.min(daysInMonth, now.getDate());
    const investmentTotal = investmentByDay
        .slice(0, anchorDay)
        .reduce((sum, value) => sum + value, 0);
    const endDay = Math.min(daysInMonth, Math.max(1, anchorDay - 11) + 11);
    const startDay = Math.max(1, endDay - 11);
    const chartItems = [];

    for (let day = startDay; day <= endDay; day++) {
        chartItems.push({
            day: String(day),
            income: incomeByDay[day - 1] || 0,
            expense: expenseByDay[day - 1] || 0,
            investment: Math.max(0, investmentByDay[day - 1] || 0),
            active: day === now.getDate(),
        });
    }

    return {
        currency: 'CAD',
        otherCurrencies,
        updatedAt: new Date().toISOString(),
        year,
        month,
        totalIncome,
        totalExpense,
        balance,
        percentageChange,
        investmentTotal,
        chartItems,
        maxChartTotal: Math.max(1, ...chartItems.map((item) => item.income + item.expense + item.investment)),
    };
}

module.exports = { buildCashFlowWidgetPayload, transactionCalendarDate };
