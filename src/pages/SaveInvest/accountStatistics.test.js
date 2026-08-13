import { describe, expect, it } from "vitest";
import { buildAccountStatistics } from "./accountStatistics";

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
});
