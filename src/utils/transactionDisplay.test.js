import { describe, expect, it } from "vitest";
import { getTransactionDisplayReason } from "./transactionDisplay";

describe("getTransactionDisplayReason", () => {
  it("removes a duplicated label from the start of a reason", () => {
    expect(getTransactionDisplayReason("Dining - Tim Hortons", "Dining")).toBe(
      "Tim Hortons"
    );
  });

  it("keeps a reason that does not repeat the label", () => {
    expect(
      getTransactionDisplayReason("Payment or purchase - Bosphorus", "Dining")
    ).toBe("Payment or purchase - Bosphorus");
  });

  it("handles a missing reason", () => {
    expect(getTransactionDisplayReason(null, "Dining")).toBe(
      "No reason provided"
    );
  });
});
