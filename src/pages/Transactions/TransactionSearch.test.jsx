import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import TransactionSearch from "./TransactionSearch";

const testData = vi.hoisted(() => ({ userId: 0, extra: [] }));
beforeEach(() => { testData.userId += 1; testData.extra = []; });

vi.mock("../../components/TransactionDetailModal/TransactionDetailModal", () => ({
  default: ({ transaction, onClose }) => transaction ? (
    <div role="dialog" aria-label="Transaction details">
      <p>{transaction.BankName}</p>
      <button onClick={onClose}>Close details</button>
    </div>
  ) : null,
}));

vi.mock("../../context/TransactionContext", () => ({
  useTransactions: () => ({ userData: { userId: String(testData.userId) }, allTransactions: {
    "2026-10": { transactions: [{ Reason: "Weekly groceries", Amount: 25, Category: "Expense", BankName: "Example Bank", Timestamp: "2026-10-10 23:59:59" }, ...testData.extra] },
    "2026-09": { transactions: [{ Reason: "Salary", Amount: 500, Category: "Income", Timestamp: "2026-09-01" }] },
  } }),
}));

test("searches across months and fields, filters categories, and recovers from no results", () => {
  render(<TransactionSearch />);
  const input = screen.getByRole("searchbox");
  expect(screen.getByText("Salary")).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "GROCERIES bank 25" } });
  expect(screen.getByRole("button", { name: /Weekly groceries/ })).toBeInTheDocument();
  expect(screen.queryByText("Salary")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Income", exact: true }));
  expect(screen.getByText("No matching transactions")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
  expect(screen.getByText("Salary")).toBeInTheDocument();
  expect(input).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Income", exact: true }));
  expect(screen.queryByRole("button", { name: /Weekly groceries/ })).not.toBeInTheDocument();
  expect(screen.getByText("Salary")).toBeInTheDocument();
});

test("opens the shared details popup and preserves the search when closed", () => {
  render(<TransactionSearch />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "groceries" } });
  fireEvent.click(screen.getByRole("button", { name: /Weekly groceries/ }));
  expect(screen.getByRole("dialog", { name: "Transaction details" })).toBeInTheDocument();
  expect(screen.getByText("Example Bank")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("searchbox")).toHaveValue("groceries");
});

test("filters inclusive calendar dates and supports either boundary independently", () => {
  render(<TransactionSearch />);
  fireEvent.click(screen.getByRole("button", { name: "Date filters" }));
  const from = screen.getByLabelText("From");
  const to = screen.getByLabelText("To");
  fireEvent.change(to, { target: { value: "2026-09-01" } });
  expect(screen.getByText("Salary")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Weekly groceries/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear dates" }));
  fireEvent.change(from, { target: { value: "2026-10-10" } });
  fireEvent.change(to, { target: { value: "2026-10-10" } });
  expect(screen.getByRole("button", { name: /Weekly groceries/ })).toBeInTheDocument();
  expect(screen.queryByText("Salary")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear dates" }));
  fireEvent.change(from, { target: { value: "2026-10-10" } });
  expect(screen.getByRole("button", { name: /Weekly groceries/ })).toBeInTheDocument();
  expect(screen.queryByText("Salary")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Income", exact: true }));
  expect(screen.getByText("No matching transactions")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
  expect(from).toHaveValue("");
  expect(to).toHaveValue("");
  expect(screen.getByText("Salary")).toBeInTheDocument();
});

test("explains reversed date ranges and preserves text search when dates are cleared", () => {
  render(<TransactionSearch />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "groceries" } });
  fireEvent.click(screen.getByRole("button", { name: "Date filters" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-20" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-10" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Choose an end date on or after the start date.");
  fireEvent.click(screen.getByRole("button", { name: "Clear dates" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("searchbox")).toHaveValue("groceries");
  expect(screen.getByRole("button", { name: /Weekly groceries/ })).toBeInTheDocument();
});

test("toggles date controls, shows a removable range chip, and clears all filters", () => {
  render(<TransactionSearch />);
  const calendar = screen.getByRole("button", { name: "Date filters" });
  expect(calendar).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByLabelText("From")).not.toBeVisible();
  fireEvent.click(calendar);
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
  fireEvent.click(calendar);
  expect(screen.getByLabelText("From")).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Remove date range" }));
  expect(screen.getByText("Salary")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "groceries" } });
  expect(screen.getByText("groceries", { selector: "mark" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  expect(screen.getByRole("searchbox")).toHaveValue("");
});

test("restores the search, date panel, and scroll position after navigation", () => {
  const first = render(<TransactionSearch />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "groceries" } });
  fireEvent.click(screen.getByRole("button", { name: "Date filters" }));
  const page = screen.getByRole("region", { name: "Transaction search" });
  page.scrollTop = 120;
  fireEvent.scroll(page);
  first.unmount();
  render(<TransactionSearch />);
  expect(screen.getByRole("searchbox")).toHaveValue("groceries");
  expect(screen.getByRole("button", { name: "Date filters" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("region", { name: "Transaction search" }).scrollTop).toBe(120);
});

test("loads more results when the scroll sentinel enters view", () => {
  let callback;
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(fn) { callback = fn; }
    observe() {}
    disconnect() { disconnect(); }
  });
  testData.extra = Array.from({ length: 40 }, (_, index) => ({
    Reason: `Payment ${index}`, Amount: 1, Category: "Expense", Timestamp: "2026-10-09",
  }));
  const { container } = render(<TransactionSearch />);
  expect(container.querySelectorAll(".transaction-search-result")).toHaveLength(30);
  act(() => callback([{ isIntersecting: true }]));
  expect(container.querySelectorAll(".transaction-search-result")).toHaveLength(42);
  expect(callback).toBeTypeOf("function");
  expect(disconnect).toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test("groups older transactions by month", () => {
  render(<TransactionSearch />);
  expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
});
