import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import TransactionSearch from "./TransactionSearch";

vi.mock("../../context/TransactionContext", () => ({
  useTransactions: () => ({ allTransactions: {
    "2026-10": { transactions: [{ Reason: "Weekly groceries", Amount: 25, Category: "Expense", BankName: "Example Bank", Timestamp: "2026-10-10" }] },
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
