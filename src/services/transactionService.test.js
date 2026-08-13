import { describe, expect, it } from "vitest";
import { getNetAmounts, getSavingEffect, groupTransactionsByMonth } from "./transactionService";

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
  it("counts only the TFSA side of legacy transfers and ignores trades", () => {
    const result = groupTransactionsByMonth([
      { Amount: 1000, Category: "Saving", Label: "Internal Transfer", Reason: "Internal transfer: RBC Chequing -> TFSA [XFER-1]", Account: "RBC Chequing", Timestamp: "2026-01-05T12:00:00Z" },
      { Amount: 1000, Category: "Saving", Label: "Internal Transfer", Reason: "Internal transfer: RBC Chequing -> TFSA [XFER-1]", Account: "TFSA", Timestamp: "2026-01-05T12:00:00Z" },
      { Amount: 1000, Category: "Saving", Label: "Stocks", Reason: "Bought VFV", Account: "TFSA", Timestamp: "2026-01-06T12:00:00Z" },
      { Amount: 200, Category: "Saving", Label: "Internal Transfer", Reason: "Internal transfer: TFSA -> RBC Chequing [XFER-2]", Account: "TFSA", Timestamp: "2026-01-07T12:00:00Z" },
      { Amount: 200, Category: "Saving", Label: "Internal Transfer", Reason: "Internal transfer: TFSA -> RBC Chequing [XFER-2]", Account: "RBC Chequing", Timestamp: "2026-01-07T12:00:00Z" },
    ]);

    expect(result["2026-01"]).toMatchObject({
      totalIncome: 0,
      totalExpense: 0,
      totalSaving: 800,
      netTotal: -800,
    });
  });

  it("does not count non-TFSA transfers or savings-account movements", () => {
    expect(getSavingEffect({
      Amount: 500,
      Category: "Saving",
      Label: "Internal Transfer",
      Reason: "Internal transfer: RBC Chequing -> Future [XFER-3]",
      Account: "Future",
    })).toBe(0);
    expect(getSavingEffect({
      Amount: 75,
      Category: "Saving",
      Label: "Savings Account",
      Reason: "Payment or purchase - toFind&Save",
      Account: "RBC Chequing",
    })).toBe(0);
  });
});
