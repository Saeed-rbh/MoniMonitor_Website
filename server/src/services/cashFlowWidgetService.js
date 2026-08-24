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

function investmentTimeline(transactions, portfolio, currentTimestamp = Date.now()) {
    const accountKinds = new Map();
    for (const account of portfolio?.accounts || []) {
        const kind = investmentKind(account);
        if (kind) accountKinds.set(Number(account.id), kind);
    }

    const states = new Map([
        ['tfsa', { cashMinor: 0, positions: new Map() }],
        ['crypto', { cashMinor: 0, positions: new Map() }],
    ]);
    const sorted = [...transactions].sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));

    const currentValue = () => {
        let totalMinor = 0;
        for (const state of states.values()) {
            totalMinor += state.cashMinor;
            for (const position of state.positions.values()) {
                totalMinor += Math.round(position.quantity * position.priceMicros / 10000);
            }
        }
        return totalMinor / 100;
    };

    const timeline = [];
    for (const transaction of sorted) {
        const accountName = String(transaction?.Account || '').toLowerCase();
        let kind = accountName.includes('tfsa') ? 'tfsa' : accountName.includes('crypto') ? 'crypto' : null;
        if (!kind) kind = accountKinds.get(Number(transaction?.PortfolioAccountId));
        if (!kind) continue;

        const timestamp = new Date(transaction.Timestamp).getTime();
        if (!Number.isFinite(timestamp)) continue;

        const state = states.get(kind);
        const amountMinor = Number.isFinite(Number(transaction.AmountMinor))
            ? Number(transaction.AmountMinor)
            : Math.round(amountOf(transaction) * 100);
        const action = String(transaction?.PortfolioAction || '').toUpperCase();
        const flow = String(transaction?.AccountFlow || '').toUpperCase();

        if (flow === 'IN') state.cashMinor += amountMinor;
        else if (flow === 'OUT') state.cashMinor -= amountMinor;
        else if (action === 'BUY') state.cashMinor -= amountMinor;
        else if (['SELL', 'DIVIDEND', 'INTEREST', 'REIMBURSEMENT', 'CONTRIBUTION', 'DEPOSIT'].includes(action)) state.cashMinor += amountMinor;
        else if (['WITHDRAWAL', 'FEE', 'TAX'].includes(action)) state.cashMinor -= amountMinor;

        const symbol = String(transaction?.PortfolioSymbol || '').trim().toUpperCase();
        const quantity = Number(transaction?.PortfolioQuantity);
        const price = Number(transaction?.PortfolioPrice);
        let position = symbol ? state.positions.get(symbol) : null;
        if (symbol && !position) {
            position = { quantity: 0, priceMicros: 0 };
            state.positions.set(symbol, position);
        }
        if (position && Number.isFinite(price) && price > 0) position.priceMicros = Math.round(price * 1000000);
        if (position && Number.isFinite(quantity)) {
            if (action === 'BUY') position.quantity += Math.abs(quantity);
            else if (action === 'SELL' || action === 'FEE') position.quantity -= Math.abs(quantity);
            else if (['REWARD', 'DISTRIBUTION'].includes(action)) position.quantity += quantity;
        }
        timeline.push({ timestamp, value: currentValue() });
    }

    const currentPortfolioValue = (portfolio?.accounts || [])
        .filter(investmentKind)
        .reduce((sum, account) => sum + Number(account?.totalValueMinor || 0), 0) / 100;
    if ((portfolio?.accounts || []).length) timeline.push({ timestamp: currentTimestamp, value: currentPortfolioValue });
    return timeline.sort((a, b) => a.timestamp - b.timestamp);
}

function dailyInvestmentValues(timeline, year, month, daysInMonth) {
    const start = new Date(year, month, 1).getTime();
    let index = 0;
    let latest = 0;
    while (index < timeline.length && timeline[index].timestamp < start) latest = Number(timeline[index++].value) || 0;
    const opening = latest;
    const values = [];
    for (let day = 1; day <= daysInMonth; day++) {
        const endOfDay = new Date(year, month, day + 1).getTime() - 1;
        while (index < timeline.length && timeline[index].timestamp <= endOfDay) latest = Number(timeline[index++].value) || 0;
        values.push(latest - opening);
    }
    return values;
}

function buildCashFlowWidgetPayload(transactions, portfolio, now = new Date()) {
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const incomeByDay = Array(daysInMonth).fill(0);
    const expenseByDay = Array(daysInMonth).fill(0);

    const current = transactions.filter((transaction) => {
        const date = new Date(transaction.Timestamp);
        return date.getFullYear() === year && date.getMonth() === month;
    });
    for (const transaction of current) {
        const day = new Date(transaction.Timestamp).getDate();
        if (day < 1 || day > daysInMonth) continue;
        if (isIncome(transaction)) incomeByDay[day - 1] += amountOf(transaction);
        else if (isExpense(transaction)) expenseByDay[day - 1] += amountOf(transaction);
    }

    const totalIncome = incomeByDay.reduce((sum, value) => sum + value, 0);
    const totalExpense = expenseByDay.reduce((sum, value) => sum + value, 0);
    const balance = totalIncome - totalExpense;
    const previousDate = new Date(year, month - 1, 1);
    let previousIncome = 0;
    let previousExpense = 0;
    const maxDay = current.length
        ? Math.max(...current.map((transaction) => new Date(transaction.Timestamp).getDate()))
        : now.getDate();

    for (const transaction of transactions) {
        const date = new Date(transaction.Timestamp);
        if (date.getFullYear() !== previousDate.getFullYear() || date.getMonth() !== previousDate.getMonth() || date.getDate() > maxDay) continue;
        if (isIncome(transaction)) previousIncome += amountOf(transaction);
        else if (isExpense(transaction)) previousExpense += amountOf(transaction);
    }

    const previousBalance = previousIncome - previousExpense;
    const percentageChange = previousBalance === 0
        ? null
        : Math.round(((balance - previousBalance) / Math.abs(previousBalance)) * 100);
    const investmentValues = dailyInvestmentValues(
        investmentTimeline(transactions, portfolio, now.getTime()),
        year,
        month,
        daysInMonth
    );
    const anchorDay = Math.min(daysInMonth, now.getDate());
    const endDay = Math.min(daysInMonth, Math.max(1, anchorDay - 11) + 11);
    const startDay = Math.max(1, endDay - 11);
    const chartItems = [];

    for (let day = startDay; day <= endDay; day++) {
        const currentInvestment = investmentValues[day - 1] || 0;
        const previousInvestment = day > 1 ? investmentValues[day - 2] || 0 : 0;
        chartItems.push({
            day: String(day),
            income: incomeByDay[day - 1] || 0,
            expense: expenseByDay[day - 1] || 0,
            investment: Math.max(0, currentInvestment - previousInvestment),
            active: day === now.getDate(),
        });
    }

    return {
        updatedAt: new Date().toISOString(),
        year,
        month,
        totalIncome,
        totalExpense,
        balance,
        percentageChange,
        investmentTotal: investmentValues[anchorDay - 1] || 0,
        chartItems,
        maxChartTotal: Math.max(1, ...chartItems.map((item) => item.income + item.expense + item.investment)),
    };
}

module.exports = { buildCashFlowWidgetPayload };

