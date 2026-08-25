import { describe, expect, it } from "vitest";
import {
  buildDashboardBootstrapData,
  getNetAmounts,
  getSavingEffect,
  groupTransactionsByMonth,
  isSaveInvestTransaction,
  uniqueInternalTransfers,
} from "./transactionService";

describe("buildDashboardBootstrapData", () => {
  it("uses compact server totals while keeping current-month transactions ready", () => {
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
    const previousDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    const previousMonth = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, "0")}`;
    const result = buildDashboardBootstrapData({
      currentMonth,
      transactions: [
        { id: 1, Amount: 500, Category: "Income", Label: "Deposit", Timestamp: `${currentMonth}-05T12:00:00Z` },
        { id: 2, Amount: 100, Category: "Expense", Label: "Groceries", Timestamp: `${currentMonth}-06T12:00:00Z` },
      ],
      byMonth: [
        { month: currentMonth, income: 500, expenses: 100, savings: 0 },
        { month: previousMonth, income: 1000, expenses: 200, savings: 100 },
      ],
    });

    expect(result.bootstrap).toBe(true);
    expect(result.totalTransactions[currentMonth]).toMatchObject({
      totalIncome: 500,
      totalExpense: 100,
      netTotal: 400,
    });
    expect(result.totalTransactions[currentMonth].transactions).toHaveLength(2);
    expect(result.totalTransactions[previousMonth]).toMatchObject({
      totalIncome: 1000,
      totalExpense: 200,
      totalSaving: 100,
      netTotal: 700,
      transactions: [],
    });
    expect(result.netAmounts[currentMonth]).toMatchObject({ income: 500, Expense: 100, net: 400 });
  });
});

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
    expect(getSavingEffect({
      Amount: 16515.56,
      Category: "Saving",
      Label: "Internal Transfer",
      Reason: "Internal transfer: TFSA (OLD) -> TFSA (NEW) [XFER-4]",
      Account: "TFSA",
      AccountFlow: "OUT",
    })).toBe(0);
  });

  it("tracks monthly investments separately from net TFSA contributions", () => {
    const result = groupTransactionsByMonth([
      { Amount: 25, Category: "Investment", Label: "Investment", Reason: "Bought VFV", Timestamp: "2026-08-12T12:00:00Z" },
      { Amount: 100, Category: "Saving", Label: "Internal Transfer", Reason: "Internal transfer: RBC Chequing -> Future [XFER-5]", Account: "Future", Timestamp: "2026-08-12T12:00:00Z" },
    ]);

    expect(result["2026-08"]).toMatchObject({
      totalSaving: 0,
      totalSaveInvest: 25,
    });
    expect(isSaveInvestTransaction(result["2026-08"].transactions[0])).toBe(true);
    expect(isSaveInvestTransaction(result["2026-08"].transactions[1])).toBe(false);
  });

  it("uses the new saving labels and subtracts TFSA investment withdrawals", () => {
    expect(getSavingEffect({
      Amount: 750,
      Category: "Saving",
      Label: "Savings Contributions",
      Account: "TFSA",
    })).toBe(750);
    expect(getSavingEffect({
      Amount: 125,
      Category: "Saving",
      Label: "Crypto Funding",
      Account: "Crypto",
    })).toBe(125);
    expect(getSavingEffect({
      Amount: 200,
      Category: "Investment",
      Label: "Asset Distribution",
      PortfolioAction: "WITHDRAWAL",
      Account: "TFSA",
    })).toBe(-200);
  });

  it("deduplicates paired internal-transfer ledger entries", () => {
    const transfers = [
      { id: 1, Amount: 810.22, Reason: "Internal transfer: RBC Chequing -> RBC Visa [XFER-6]", ReferenceNumber: "XFER-6" },
      { id: 2, Amount: 810.22, Reason: "Internal transfer: RBC Chequing -> RBC Visa [XFER-6]", ReferenceNumber: "XFER-6" },
      { id: 3, Amount: 25, Reason: "Internal transfer: RBC Chequing -> unresolved account [counterpart not matched]" },
    ];

    expect(uniqueInternalTransfers(transfers).map(({ id }) => id)).toEqual([1, 3]);
  });
});
