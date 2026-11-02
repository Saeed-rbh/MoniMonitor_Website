import React from "react";
import { act, fireEvent, render as testingRender, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import TransactionSearch from "./TransactionSearch";

const render = ui => testingRender(<MemoryRouter>{ui}</MemoryRouter>);
vi.mock("framer-motion", async importOriginal => ({
  ...await importOriginal(), AnimatePresence: ({ children }) => children,
}));

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
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Date filters" }));
  const done = () => fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  open();
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-01" } });
  done();
  expect(screen.getByText("Salary")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Weekly groceries/ })).not.toBeInTheDocument();
  open();
  fireEvent.click(screen.getByRole("button", { name: "Clear dates" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-10" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-10" } });
  done();
  expect(screen.getByRole("button", { name: /Weekly groceries/ })).toBeInTheDocument();
  expect(screen.queryByText("Salary")).not.toBeInTheDocument();
  open();
  fireEvent.click(screen.getByRole("button", { name: "Clear dates" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-10" } });
  done();
  expect(screen.getByRole("button", { name: /Weekly groceries/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Income", exact: true }));
  expect(screen.getByText("No matching transactions")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(screen.getByRole("searchbox")).toHaveValue("groceries");
  expect(screen.getByRole("button", { name: /Weekly groceries/ })).toBeInTheDocument();
});

test("toggles date controls, shows a removable range chip, and clears all filters", () => {
  render(<TransactionSearch />);
  const calendar = screen.getByRole("button", { name: "Date filters" });
  expect(calendar).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
  fireEvent.click(calendar);
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove date range" }));
  expect(screen.getByText("Salary")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "groceries" } });
  expect(screen.getByText("groceries", { selector: "mark" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  expect(screen.getByRole("searchbox")).toHaveValue("");
});

test("restores the search and scroll position without reopening the popup", () => {
  const first = render(<TransactionSearch />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "groceries" } });
  fireEvent.click(screen.getByRole("button", { name: "Date filters" }));
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  const page = screen.getByRole("region", { name: "Transaction search" });
  page.scrollTop = 120;
  fireEvent.scroll(page);
  first.unmount();
  render(<TransactionSearch />);
  expect(screen.getByRole("searchbox")).toHaveValue("groceries");
  expect(screen.getByRole("button", { name: "Date filters" })).toHaveAttribute("aria-expanded", "false");
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

test("traps focus in the date popup, closes with Escape, and restores focus", () => {
  render(<TransactionSearch />);
  const calendar = screen.getByRole("button", { name: "Date filters" });
  calendar.focus();
  fireEvent.click(calendar);
  const popup = screen.getByRole("dialog", { name: "Date filters" });
  expect(popup).toHaveAttribute("aria-modal", "true");
  expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close dialog" })).toHaveFocus();
  const buttons = [...popup.querySelectorAll("button")].filter(button => !button.disabled);
  fireEvent.keyDown(document.activeElement, { key: "Tab", shiftKey: true });
  expect(buttons.at(-1)).toHaveFocus();
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calendar).toHaveFocus();
  fireEvent.click(calendar);
  fireEvent.click(document.querySelector(".MoreOpen_Backdrop"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test.each([
  ["Today", "2026-11-01", "2026-11-01"],
  ["Last 7 days", "2026-10-26", "2026-11-01"],
  ["This month", "2026-11-01", "2026-11-30"],
  ["Last month", "2026-10-01", "2026-10-31"],
])("selects %s, closes the popup, and preserves the range on reopening", (label, start, end) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 1, 12));
  try {
    render(<TransactionSearch />);
    const opener = screen.getByRole("button", { name: "Date filters" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: label, exact: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(screen.getByRole("button", { name: "Remove date range" })).toHaveTextContent(start === end ? start : `${start} – ${end}`);
    fireEvent.click(opener);
    expect(screen.getByLabelText("From")).toHaveValue(start);
    expect(screen.getByLabelText("To")).toHaveValue(end);
    expect(screen.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.getByRole("button", { name: "Remove date range" })).toHaveTextContent(start === end ? start : `${start} – ${end}`);
  } finally { vi.useRealTimers(); }
});

test.each([
  [new Date(2027, 0, 5, 12), "2026-12-01", "2026-12-31"],
  [new Date(2028, 2, 1, 12), "2028-02-01", "2028-02-29"],
])("handles previous-month year and leap-day boundaries", (today, start, end) => {
  vi.useFakeTimers();
  vi.setSystemTime(today);
  try {
    render(<TransactionSearch />);
    fireEvent.click(screen.getByRole("button", { name: "Date filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Last month", exact: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Date filters" }));
    expect(screen.getByLabelText("From")).toHaveValue(start);
    expect(screen.getByLabelText("To")).toHaveValue(end);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: end } });
    expect(screen.getByRole("button", { name: "Last month", exact: true })).toHaveAttribute("aria-pressed", "false");
  } finally { vi.useRealTimers(); }
});

test("selects a range across months directly in the embedded calendar", () => {
  testData.extra = ["2026-10-30", "2026-11-02"].map(Timestamp => ({ Timestamp, Reason: "Range payment", Amount: 1, Category: "Expense" }));
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 10, 12));
  try {
    render(<TransactionSearch />);
    fireEvent.click(screen.getByRole("button", { name: "Date filters" }));
    expect(document.querySelector('input[type="date"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "October 30, 2026", exact: true }));
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-30");
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "November 2, 2026", exact: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove date range" })).toHaveTextContent("2026-10-30 – 2026-11-02");
    fireEvent.click(screen.getByRole("button", { name: "Date filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByLabelText("To")).toHaveValue("2026-11-02");
    expect(screen.getByRole("button", { name: "November 1, 2026", exact: true })).toHaveClass("in-range");
  } finally { vi.useRealTimers(); }
});

test("normalizes a range selected backwards and rejects invalid typed dates", () => {
  testData.extra = ["2028-02-27", "2028-02-29"].map(Timestamp => ({ Timestamp, Reason: "Leap payment", Amount: 1, Category: "Expense" }));
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2028, 1, 10, 12));
  try {
    render(<TransactionSearch />);
    fireEvent.click(screen.getByRole("button", { name: "Date filters" }));
    fireEvent.click(screen.getByRole("button", { name: "February 29, 2028", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "February 27, 2028", exact: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Date filters" }));
    expect(screen.getByLabelText("From")).toHaveValue("2028-02-27");
    expect(screen.getByLabelText("To")).toHaveValue("2028-02-29");
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2028-02-30" } });
    expect(screen.getByLabelText("To")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid date");
  } finally { vi.useRealTimers(); }
});

test("tapping the selected day again confirms it and closes the popup", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 10, 12));
  try {
    render(<TransactionSearch />);
    fireEvent.click(screen.getByRole("button", { name: "Date filters" }));
    expect(screen.queryByRole("button", { name: "Single day" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "October 9, 2026", exact: true })).toBeDisabled();
    expect(screen.getByRole("button", { name: "October 10, 2026", exact: true })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "October 10, 2026", exact: true }));
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-10");
    expect(screen.getByLabelText("To")).toHaveValue("2026-10-10");
    fireEvent.click(screen.getByRole("button", { name: "October 10, 2026", exact: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove date range" })).toHaveTextContent(/^2026-10-10$/);
    expect(screen.getByRole("button", { name: /Weekly groceries/ })).toBeInTheDocument();
    expect(screen.queryByText("Salary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Date filters" }));
    fireEvent.click(screen.getByRole("button", { name: "October 10, 2026", exact: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});
