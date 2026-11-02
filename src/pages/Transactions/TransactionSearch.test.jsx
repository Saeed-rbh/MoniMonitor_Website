import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import TransactionSearch from "./TransactionSearch";

vi.mock("../../components/TransactionDetailModal/TransactionDetailModal", () => ({
  default: ({ transaction, onClose }) => transaction ? (
    <div role="dialog" aria-label="Transaction details">
      <p>{transaction.BankName}</p>
      <button onClick={onClose}>Close details</button>
    </div>
  ) : null,
}));

vi.mock("../../context/TransactionContext", () => ({
  useTransactions: () => ({ allTransactions: {
    "2026-10": { transactions: [{ Reason: "Weekly groceries", Amount: 25, Category: "Expense", BankName: "Example Bank", Timestamp: "2026-10-10 23:59:59" }] },
    "2026-09": { transactions: [{ Reason: "Salary", Amount: 500, Category: "Income", Timestamp: "2026-09-01" }] },
  } }),
}));

test("searches across months and fields, filters categories, and recovers from no results", () => {
  render(<TransactionSearch />);
  const input = screen.getByRole("searchbox");
  expect(screen.getByText("Salary")).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "GROCERIES bank 25" } });
  expect(screen.getByText("Weekly groceries")).toBeInTheDocument();
  expect(screen.queryByText("Salary")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Income", exact: true }));
  expect(screen.getByText("No matching transactions")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
  expect(screen.getByText("Salary")).toBeInTheDocument();
  expect(input).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Income", exact: true }));
  expect(screen.queryByText("Weekly groceries")).not.toBeInTheDocument();
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
  const from = screen.getByLabelText("From");
  const to = screen.getByLabelText("To");
  fireEvent.change(to, { target: { value: "2026-09-01" } });
  expect(screen.getByText("Salary")).toBeInTheDocument();
  expect(screen.queryByText("Weekly groceries")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear dates" }));
  fireEvent.change(from, { target: { value: "2026-10-10" } });
  fireEvent.change(to, { target: { value: "2026-10-10" } });
  expect(screen.getByText("Weekly groceries")).toBeInTheDocument();
  expect(screen.queryByText("Salary")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear dates" }));
  fireEvent.change(from, { target: { value: "2026-10-10" } });
  expect(screen.getByText("Weekly groceries")).toBeInTheDocument();
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
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-20" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-10" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Choose an end date on or after the start date.");
  fireEvent.click(screen.getByRole("button", { name: "Clear dates" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("searchbox")).toHaveValue("groceries");
  expect(screen.getByText("Weekly groceries")).toBeInTheDocument();
});
