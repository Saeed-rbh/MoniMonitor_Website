import { afterEach, describe, expect, it, vi } from "vitest";
import { groupTransactionsByTimeline } from "./TransactionListMonthly";

describe("groupTransactionsByTimeline", () => {
  afterEach(() => vi.useRealTimers());

  it("orders Today, Yesterday, and This Week explicitly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T16:00:00-04:00"));

    const sections = groupTransactionsByTimeline([
      { id: 1, Timestamp: "2026-08-18T16:00:00-04:00" },
      { id: 2, Timestamp: "2026-08-20T16:00:00-04:00" },
      { id: 3, Timestamp: "2026-08-19T16:00:00-04:00" },
    ]);

    expect(sections.map(({ title }) => title.split(" · ")[0])).toEqual([
      "Today",
      "Yesterday",
      "This Week",
    ]);
  });

  it("groups a date-only UTC timestamp under its stated local date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 16));

    const sections = groupTransactionsByTimeline([
      { id: 1, Timestamp: "2026-08-20T00:00:00.000Z" },
    ]);

    expect(sections[0].title).toBe("Today");
  });
});
