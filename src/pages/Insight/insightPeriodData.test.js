import { describe, expect, it } from "vitest";
import {
    buildAllTimeInsightData,
    getCurrentInvestmentValue,
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
