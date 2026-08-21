import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TransactionDetailModal from "./TransactionDetailModal";
import * as apiService from "../../services/apiService";

vi.mock("../../context/TransactionContext", () => ({
  useTransactions: () => ({
    monthData: { refetch: vi.fn() },
  }),
}));

vi.mock("../../services/apiService", () => ({
  updateTransactionAPI: vi.fn(),
}));

describe("TransactionDetailModal", () => {
  const sampleTx = {
    id: 123,
    Amount: 50.0,
    AmountMinor: 5000,
    Currency: "CAD",
    Category: "Expense",
    Label: "Groceries",
    Reason: "Metro Supermarket",
    Timestamp: "2026-08-21T10:00:00Z",
    Account: "RBC Chequing",
    AccountFlow: "OUT",
  };

  it("renders transaction details and quick Internal Transfer button", () => {
    render(
      <MemoryRouter>
        <TransactionDetailModal
          transaction={sampleTx}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Metro Supermarket")).toBeDefined();
    expect(screen.getByText("🔄 Mark as Internal Transfer")).toBeDefined();
    expect(screen.getByText("Recategorize")).toBeDefined();
  });

  it("converts transaction to Internal Transfer when button is clicked", async () => {
    vi.mocked(apiService.updateTransactionAPI).mockResolvedValue({
      status: "success",
      data: {
        ...sampleTx,
        Category: "Internal",
        Label: "Internal Transfer",
        Reason: "Internal transfer: RBC Chequing -> Temporary",
        Account: "RBC Chequing",
      },
    });

    const onUpdated = vi.fn();

    render(
      <MemoryRouter>
        <TransactionDetailModal
          transaction={sampleTx}
          onClose={vi.fn()}
          onTransactionUpdated={onUpdated}
        />
      </MemoryRouter>
    );

    const transferBtn = screen.getByText("🔄 Mark as Internal Transfer");
    fireEvent.click(transferBtn);

    await waitFor(() => {
      expect(apiService.updateTransactionAPI).toHaveBeenCalledWith(123, {
        Category: "Internal",
        Label: "Internal Transfer",
        Reason: "Internal transfer: RBC Chequing -> Temporary",
        Account: "RBC Chequing",
      });
      expect(onUpdated).toHaveBeenCalled();
    });
  });
});
