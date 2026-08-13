import { describe, expect, it } from "vitest";
import {
    buildAllTimeInsightData,
    buildInvestmentValueTimeline,
    getCurrentInvestmentValue,
    getInvestmentPeriodValues,
    getVisibleInsightPeriodCount,
} from "./insightPeriodData";

describe("buildAllTimeInsightData", () => {
    it("aggregates the full history by year in chronological order", () => {
        const result = buildAllTimeInsightData({
            "2026-02": {
                totalIncome: 200,
                totalExpense: 80,
                totalSaving: 30,
                totalSaveInvest: 230,
                transactions: [{ id: 3, Amount: 200, Category: "Income" }],
            },
            "2024-12": {
                totalIncome: 100,
                totalExpense: 25,
                totalSaving: 10,
                transactions: [{ id: 1, Amount: 25, Category: "Expense" }],
            },
            "2026-01": {
                totalIncome: 50,
                totalExpense: 20,
                totalSaving: -5,
                totalSaveInvest: 55,
                transactions: [
                    { id: 2, Amount: 50, Category: "Internal", AccountFlow: "IN" },
                    { id: 4, Amount: 10, Category: "Investment", AccountFlow: "OUT" },
                ],
            },
        });

        expect(result.labels).toEqual(["2024", "2026"]);
        expect(result.income).toEqual([100, 250]);
        expect(result.expense).toEqual([25, 100]);
        expect(result.invest).toEqual([10, 285]);
        expect(result.transactions.map(({ id }) => id)).toEqual([3, 1, 2, 4]);
        expect(result.accountBalance).toBe(215);
    });

    it("ignores non-month summary keys", () => {
        const result = buildAllTimeInsightData({
            "2026-Annual": { totalIncome: 999, transactions: [{ id: 1 }] },
        });

        expect(result.labels).toEqual([]);
        expect(result.transactions).toEqual([]);
    });
});

describe("getVisibleInsightPeriodCount", () => {
    const now = new Date(2026, 8, 14);

    it("stops a current-year trend at the current month", () => {
        expect(getVisibleInsightPeriodCount({
            viewMode: "yearly",
            year: 2026,
            totalPeriods: 12,
            now,
        })).toBe(9);
    });

    it("stops a current-month trend at the current day", () => {
        expect(getVisibleInsightPeriodCount({
            viewMode: "monthly",
            year: 2026,
            month: 8,
            totalPeriods: 30,
            now,
        })).toBe(14);
    });

    it("keeps completed historical periods intact", () => {
        expect(getVisibleInsightPeriodCount({
            viewMode: "yearly",
            year: 2025,
            totalPeriods: 12,
            now,
        })).toBe(12);
    });
});

describe("getCurrentInvestmentValue", () => {
    it("sums current TFSA and crypto values without counting other accounts", () => {
        expect(getCurrentInvestmentValue({
            accounts: [
                { name: "TFSA", accountType: "TFSA", totalValueMinor: 948643 },
                { name: "Crypto", accountType: "Crypto", totalValueMinor: 86 },
                { name: "Future", accountType: "Savings", totalValueMinor: 4031034 },
            ],
        })).toBe(9487.29);
    });
});

describe("investment portfolio value history", () => {
    const portfolio = {
        accounts: [
            { id: 10, name: "TFSA", accountType: "TFSA", totalValueMinor: 120000 },
            { id: 13, name: "Crypto", accountType: "Crypto", totalValueMinor: 30000 },
            { id: 20, name: "Future", accountType: "Savings", totalValueMinor: 999999 },
        ],
    };
    const allTransactions = {
        "2026-01": {
            transactions: [
                { id: 1, Timestamp: "2026-01-01T12:00:00Z", Account: "TFSA", AmountMinor: 100000, AccountFlow: "IN" },
                { id: 2, Timestamp: "2026-01-02T12:00:00Z", Account: "TFSA", AmountMinor: 60000, AccountFlow: "OUT", PortfolioAction: "BUY", PortfolioSymbol: "VFV", PortfolioQuantity: 3, PortfolioPrice: 200 },
                { id: 3, Timestamp: "2026-01-03T12:00:00Z", Account: "TFSA", AmountMinor: 40000, AccountFlow: "IN", PortfolioAction: "SELL", PortfolioSymbol: "VFV", PortfolioQuantity: 1, PortfolioPrice: 400 },
                { id: 4, Timestamp: "2026-01-04T12:00:00Z", Account: "TFSA", AmountMinor: 50000, AccountFlow: "OUT" },
            ],
        },
        "2026-02": {
            transactions: [
                { id: 5, Timestamp: "2026-02-01T12:00:00Z", Account: "Crypto", AmountMinor: 20000, AccountFlow: "IN" },
                { id: 6, Timestamp: "2026-02-02T12:00:00Z", Account: "Crypto", AmountMinor: 20000, AccountFlow: "OUT", PortfolioAction: "BUY", PortfolioSymbol: "ETH", PortfolioQuantity: 2, PortfolioPrice: 100 },
            ],
        },
    };

    it("tracks the combined TFSA and crypto value without treating buys as extra value", () => {
        const timeline = buildInvestmentValueTimeline(
            allTransactions,
            portfolio,
            new Date("2026-03-15T12:00:00Z")
        );

        expect(timeline.map(({ value }) => value)).toEqual([
            1000,
            1000,
            1600,
            1100,
            1300,
            1300,
            1500,
        ]);
    });

    it("returns the portfolio balance at each requested period end", () => {
        const timeline = buildInvestmentValueTimeline(
            allTransactions,
            portfolio,
            new Date("2026-03-15T12:00:00Z")
        );

        expect(getInvestmentPeriodValues(timeline, [
            new Date("2026-01-31T23:59:59Z"),
            new Date("2026-02-28T23:59:59Z"),
            new Date("2026-03-31T23:59:59Z"),
        ])).toEqual([1100, 1300, 1500]);
    });
});
