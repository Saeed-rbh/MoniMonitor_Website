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

const getInvestmentAccountKind = (account = {}) => {
    const type = String(account?.accountType || '').toLowerCase();
    const name = String(account?.name || '').toLowerCase();
    if (type === 'tfsa' || name.includes('tfsa')) return 'tfsa';
    if (type === 'crypto' || name.includes('crypto')) return 'crypto';
    return null;
};

const getTransactionAccountKind = (transaction, accountKinds) => {
    const account = String(transaction?.Account || '').toLowerCase();
    if (account.includes('tfsa')) return 'tfsa';
    if (account.includes('crypto')) return 'crypto';
    return accountKinds.get(Number(transaction?.PortfolioAccountId)) || null;
};

const reducePositionQuantity = (position, quantity) => {
    const previousQuantity = position.quantity;
    position.quantity -= Math.abs(quantity);
    const tolerance = Math.max(1e-7, Math.abs(previousQuantity) * 1e-6);
    if (Math.abs(position.quantity) <= tolerance) position.quantity = 0;
};

const getStateValueMinor = (states) => [...states.values()].reduce(
    (total, state) => total + state.cashMinor + [...state.positions.values()].reduce(
        (holdingsTotal, position) => holdingsTotal + Math.round(
            position.quantity * position.priceMicros / 10000
        ),
        0
    ),
    0
);

export const buildInvestmentValueTimeline = (
    allTransactions = {},
    portfolio = {},
    now = new Date()
) => {
    const accountKinds = new Map(
        (portfolio.accounts || [])
            .map((account) => [Number(account?.id), getInvestmentAccountKind(account)])
            .filter(([, kind]) => kind)
    );
    const transactions = Object.entries(allTransactions)
        .filter(([key]) => MONTH_KEY_PATTERN.test(key))
        .flatMap(([, value]) => Array.isArray(value?.transactions) ? value.transactions : [])
        .sort((a, b) => {
            const dateDifference = new Date(a?.Timestamp).getTime() - new Date(b?.Timestamp).getTime();
            return dateDifference || (Number(a?.id) || 0) - (Number(b?.id) || 0);
        });
    const states = new Map([
        ['tfsa', { cashMinor: 0, positions: new Map() }],
        ['crypto', { cashMinor: 0, positions: new Map() }],
    ]);
    const timeline = [];

    transactions.forEach((transaction) => {
        const kind = getTransactionAccountKind(transaction, accountKinds);
        const occurredAt = new Date(transaction?.Timestamp).getTime();
        if (!kind || !Number.isFinite(occurredAt)) return;

        const state = states.get(kind);
        const amountMinor = Number.isFinite(Number(transaction?.AmountMinor))
            ? Number(transaction.AmountMinor)
            : Math.round((Number(transaction?.Amount) || 0) * 100);
        const action = String(transaction?.PortfolioAction || '').toUpperCase();
        const flow = String(transaction?.AccountFlow || '').toUpperCase();

        if (flow === 'IN') state.cashMinor += amountMinor;
        else if (flow === 'OUT') state.cashMinor -= amountMinor;
        else if (action === 'BUY') state.cashMinor -= amountMinor;
        else if (['SELL', 'DIVIDEND', 'INTEREST', 'REIMBURSEMENT', 'CONTRIBUTION', 'DEPOSIT'].includes(action)) {
            state.cashMinor += amountMinor;
        } else if (['WITHDRAWAL', 'FEE', 'TAX'].includes(action)) {
            state.cashMinor -= amountMinor;
        }

        const symbol = String(transaction?.PortfolioSymbol || '').trim().toUpperCase();
        const quantity = Number(transaction?.PortfolioQuantity);
        const price = Number(transaction?.PortfolioPrice);
        let position = symbol ? state.positions.get(symbol) : null;
        if (symbol && !position) {
            position = { quantity: 0, priceMicros: 0 };
            state.positions.set(symbol, position);
        }
        if (position && Number.isFinite(price) && price > 0) {
            position.priceMicros = Math.round(price * 1000000);
        }

        if (position && Number.isFinite(quantity)) {
            if (action === 'BUY') position.quantity += Math.abs(quantity);
            else if (action === 'SELL') reducePositionQuantity(position, quantity);
            else if (action === 'REWARD') position.quantity += Math.abs(quantity);
            else if (action === 'DISTRIBUTION') position.quantity += quantity;
            else if (action === 'FEE') reducePositionQuantity(position, quantity);
            else if (action === 'SWAP') {
                reducePositionQuantity(position, quantity);
                const toSymbol = String(transaction?.PortfolioToSymbol || '').trim().toUpperCase();
                const toQuantity = Number(transaction?.PortfolioToQuantity);
                if (toSymbol && Number.isFinite(toQuantity) && toQuantity > 0) {
                    const receivedPosition = state.positions.get(toSymbol) || { quantity: 0, priceMicros: 0 };
                    receivedPosition.quantity += toQuantity;
                    state.positions.set(toSymbol, receivedPosition);
                }
            }
        }

        timeline.push({ timestamp: occurredAt, value: getStateValueMinor(states) / 100 });
    });

    const currentTimestamp = new Date(now).getTime();
    const latestTimestamp = timeline.at(-1)?.timestamp ?? -Infinity;
    if ((portfolio.accounts || []).length && Number.isFinite(currentTimestamp) && currentTimestamp >= latestTimestamp) {
        timeline.push({
            timestamp: currentTimestamp,
            value: getCurrentInvestmentValue(portfolio),
        });
    }

    return timeline;
};

export const getInvestmentPeriodValues = (timeline = [], periodEnds = []) => {
    let timelineIndex = 0;
    let latestValue = 0;

    return periodEnds.map((periodEnd) => {
        const endTimestamp = periodEnd instanceof Date
            ? periodEnd.getTime()
            : Number(periodEnd);
        while (
            timelineIndex < timeline.length &&
            timeline[timelineIndex].timestamp <= endTimestamp
        ) {
            latestValue = Number(timeline[timelineIndex].value) || 0;
            timelineIndex += 1;
        }
        return latestValue;
    });
};

export const getRebasedInvestmentPeriodValues = (
    timeline = [],
    periodStart,
    periodEnds = []
) => {
    const startTimestamp = periodStart instanceof Date
        ? periodStart.getTime()
        : Number(periodStart);
    if (!Number.isFinite(startTimestamp)) return periodEnds.map(() => 0);

    let timelineIndex = 0;
    let openingValue = 0;
    let latestValue = 0;

    while (
        timelineIndex < timeline.length &&
        timeline[timelineIndex].timestamp < startTimestamp
    ) {
        latestValue = Number(timeline[timelineIndex].value) || 0;
        timelineIndex += 1;
    }
    openingValue = latestValue;

    return periodEnds.map((periodEnd) => {
        const endTimestamp = periodEnd instanceof Date
            ? periodEnd.getTime()
            : Number(periodEnd);
        while (
            timelineIndex < timeline.length &&
            timeline[timelineIndex].timestamp <= endTimestamp
        ) {
            latestValue = Number(timeline[timelineIndex].value) || 0;
            timelineIndex += 1;
        }
        return latestValue - openingValue;
    });
};

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
