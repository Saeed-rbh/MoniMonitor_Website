const REPORTING_CURRENCY = 'CAD';
const currencyOf = (record) => String(record?.Currency || record?.currency || REPORTING_CURRENCY).toUpperCase();
const isReportingCurrency = (record) => currencyOf(record) === REPORTING_CURRENCY;

function portfolioByCurrency(accounts) {
    const totals = new Map();
    const get = (currency) => {
        if (!totals.has(currency)) totals.set(currency, { currency, totalValueMinor: 0, totalCashMinor: 0,
            totalLiabilitiesMinor: 0, holdingsValueMinor: 0, holdingsCostMinor: 0, gainLossMinor: 0 });
        return totals.get(currency);
    };
    get(REPORTING_CURRENCY);
    for (const account of accounts) {
        const cash = Number(account.cashMinor || 0);
        const accountTotal = get(currencyOf(account));
        if (account.accountType === 'Credit Card') accountTotal.totalLiabilitiesMinor += cash;
        else accountTotal.totalCashMinor += cash;
        for (const holding of account.holdings || []) {
            const total = get(currencyOf(holding));
            total.holdingsValueMinor += Math.round(Number(holding.quantity || 0) * Number(holding.priceMicros ?? Number(holding.priceMinor || 0) * 10000) / 10000);
            total.holdingsCostMinor += Math.round(Number(holding.quantity || 0) * Number(holding.averageCostMicros ?? Number(holding.averageCostMinor || 0) * 10000) / 10000);
        }
    }
    for (const total of totals.values()) {
        total.totalValueMinor = total.totalCashMinor + total.holdingsValueMinor - total.totalLiabilitiesMinor;
        total.gainLossMinor = total.holdingsValueMinor - total.holdingsCostMinor;
    }
    return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

module.exports = { REPORTING_CURRENCY, currencyOf, isReportingCurrency, portfolioByCurrency };
