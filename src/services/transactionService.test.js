import { describe, expect, it } from "vitest";
import { getNetAmounts } from "./transactionService";

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
