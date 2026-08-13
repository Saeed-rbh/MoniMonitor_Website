import { describe, expect, it } from "vitest";
import { getNetAmounts, groupTransactionsByMonth } from "./transactionService";

describe("getNetAmounts", () => {
  it("keeps months older than the newest transaction in the dashboard series", () => {
    const result = getNetAmounts({
      "2021-12": {
        totalIncome: 750,
        totalExpense: 60,
        totalSaving: 0,
        netTotal: 690,
      },
      "2026-08": {
        totalIncome: 0,
        totalExpense: 500,
        totalSaving: 0,
        netTotal: -500,
      },
    });

    expect(Object.keys(result)[0]).toBe("2021-12");
    expect(result["2021-12"]).toMatchObject({
      income: 750,
      Expense: 60,
      net: 690,
      month: "Dec",
    });
    expect(result["2026-08"]).toMatchObject({ Expense: 500, net: -500 });
  });
});

describe("groupTransactionsByMonth", () => {
  it("counts TFSA contributions once and nets withdrawals without counting transfers or trades", () => {
    const result = groupTransactionsByMonth([
      { Amount: 1000, Category: "Transfer", Label: "Internal Transfer", Timestamp: "2026-01-05T12:00:00Z" },
      { Amount: 1000, Category: "Saving", Label: "TFSA Contribution", Timestamp: "2026-01-05T12:00:00Z" },
      { Amount: 1000, Category: "Investment", Label: "Stocks", Timestamp: "2026-01-06T12:00:00Z" },
      { Amount: 200, Category: "SavingWithdrawal", Label: "TFSA Withdrawal", Timestamp: "2026-01-07T12:00:00Z" },
    ]);

    expect(result["2026-01"]).toMatchObject({
      totalIncome: 0,
      totalExpense: 0,
      totalSaving: 800,
      netTotal: -800,
    });
  });
});
