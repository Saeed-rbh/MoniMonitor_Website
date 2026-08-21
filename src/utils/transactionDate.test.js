import { describe, expect, it } from "vitest";
import {
  isDateOnlyTransactionTimestamp,
  parseTransactionDate,
} from "./transactionDate";

describe("transaction calendar dates", () => {
  it("keeps a midnight-UTC bank date on its stated local calendar day", () => {
    const parsed = parseTransactionDate("2026-08-20T00:00:00.000Z");

    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(7);
    expect(parsed.getDate()).toBe(20);
    expect(parsed.getHours()).toBe(0);
  });

  it("does not reinterpret timestamps that contain an explicit time", () => {
    const value = "2026-08-20T16:20:54.000Z";

    expect(isDateOnlyTransactionTimestamp(value)).toBe(false);
    expect(parseTransactionDate(value).getTime()).toBe(new Date(value).getTime());
  });
});

