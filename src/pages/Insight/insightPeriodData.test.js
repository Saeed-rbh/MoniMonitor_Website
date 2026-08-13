import { describe, expect, it } from "vitest";
import { buildAllTimeInsightData } from "./insightPeriodData";

describe("buildAllTimeInsightData", () => {
    it("aggregates the full history by year in chronological order", () => {
        const result = buildAllTimeInsightData({
            "2026-02": {
                totalIncome: 200,
                totalExpense: 80,
                totalSaving: 30,
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
                transactions: [
                    { id: 2, Amount: 50, Category: "Internal", AccountFlow: "IN" },
                    { id: 4, Amount: 10, Category: "Investment", AccountFlow: "OUT" },
                ],
            },
        });

        expect(result.labels).toEqual(["2024", "2026"]);
        expect(result.income).toEqual([100, 250]);
        expect(result.expense).toEqual([25, 100]);
        expect(result.invest).toEqual([10, 25]);
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
