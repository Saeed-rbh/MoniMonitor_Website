import { describe, expect, it } from "vitest";
import { buildAccountStatistics, getAccountTransactions, withRecordedTransactions } from "./accountStatistics";

describe("buildAccountStatistics", () => {
  it("builds separate flow and activity statistics for each account", () => {
    const accounts = [
      { id: 1, name: "RBC Chequing", accountRef: "1234" },
      { id: 2, name: "TFSA", accountRef: "TFSA" },
    ];
    const result = buildAccountStatistics(accounts, {
      "2026-01": {
        transactions: [
          { Timestamp: "2026-01-01", Account: "RBC Chequing", Amount: 100, AccountFlow: "IN" },
          { Timestamp: "2026-01-02", Account: "RBC Chequing", AmountMinor: 2500, AccountFlow: "OUT" },
          { Timestamp: "2026-01-03", Account: "TFSA", Amount: 50, AccountFlow: "IN" },
        ],
      },
      "2026-02": {
        transactions: [
          { Timestamp: "2026-02-01", PortfolioAccountId: 2, Amount: 20, Category: "Expense" },
        ],
      },
      "2026-Annual": { transactions: [{ Account: "TFSA", Amount: 999, AccountFlow: "IN" }] },
    });

    expect(result[0]).toMatchObject({
      moneyInMinor: 10000,
      moneyOutMinor: 2500,
      netFlowMinor: 7500,
      transactionCount: 2,
      firstActivity: "2026-01-01",
      latestActivity: "2026-01-02",
    });
    expect(result[1]).toMatchObject({
      moneyInMinor: 5000,
      moneyOutMinor: 2000,
      netFlowMinor: 3000,
      transactionCount: 2,
    });
  });

  it("returns one account's complete monthly history newest first", () => {
    const account = { id: 2, name: "TFSA", accountRef: "2468" };
    const result = getAccountTransactions(account, {
      "2026-01": { transactions: [
        { id: 1, Timestamp: "2026-01-02", Account: "TFSA" },
        { id: 2, Timestamp: "2026-01-03", Account: "RBC Chequing" },
      ] },
      "2026-02": { transactions: [
        { id: 3, Timestamp: "2026-02-01", PortfolioAccountId: 2 },
      ] },
      "2026-Annual": { transactions: [
        { id: 4, Timestamp: "2026-03-01", Account: "TFSA" },
      ] },
    });

    expect(result.map((transaction) => transaction.id)).toEqual([3, 1]);
  });

  it("hides account statistics with no linked transactions", () => {
    const statistics = [
      { account: { id: 1 }, transactionCount: 2 },
      { account: { id: 2 }, transactionCount: 0 },
    ];
    expect(withRecordedTransactions(statistics).map((item) => item.account.id)).toEqual([1]);
  });

  it("assigns a generic TFSA name to the exact account instead of every TFSA", () => {
    const accounts = [
      { id: 10, name: "TFSA", accountRef: "HQ656S0K7CAD" },
      { id: 14, name: "Wealthsimple TFSA", accountRef: "0WK8" },
    ];
    const statistics = buildAccountStatistics(accounts, {
      "2026-08": { transactions: [
        { id: 1, Timestamp: "2026-08-20", Account: "TFSA", Amount: 10, AccountFlow: "OUT" },
      ] },
    });

    expect(statistics.map((item) => item.transactionCount)).toEqual([1, 0]);
  });
});
