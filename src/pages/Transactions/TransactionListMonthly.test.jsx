import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import TransactionListMonthly, { groupTransactionsByTimeline } from "./TransactionListMonthly";

describe("groupTransactionsByTimeline", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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

  it("shows the full count and loads the next batch when the sentinel is visible", async () => {
    const onLoadMore = vi.fn();

    vi.stubGlobal(
      "IntersectionObserver",
      class IntersectionObserverMock {
        constructor(callback) {
          this.callback = callback;
        }

        observe() {
          this.callback([{ isIntersecting: true }]);
        }

        disconnect() {}
      }
    );

    render(
      <TransactionListMonthly
        swipedIndex={[null, null]}
        handleUnSwipe={vi.fn()}
        handleSwipe={vi.fn()}
        handleTransactionClick={vi.fn()}
        transactions={[
          {
            id: 1,
            Amount: 10,
            Category: "Expense",
            Label: "Groceries",
            Reason: "Test transaction",
            Timestamp: "2026-06-30T12:00:00.000Z",
            Type: "Daily",
          },
        ]}
        totalTransactionCount={65}
        hasMore
        onLoadMore={onLoadMore}
        isAddClicked={null}
        setOpen={vi.fn()}
        setShowTransaction={vi.fn()}
      />
    );

    expect(screen.getByText("65 transactions")).toBeInTheDocument();
    await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1));
  });
});

