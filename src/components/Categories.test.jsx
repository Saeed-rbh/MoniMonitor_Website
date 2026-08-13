import { describe, expect, it } from "vitest";
import {
  CATEGORY_GROUPS,
  Expense_categories,
  Income_categories,
  Internal_categories,
  Investment_categories,
  Saving_categories,
  getCategoryForLabel,
  getTransactionIcon,
} from "./Categories";

const expectedCategories = {
  Expense: [
    "Cash Withdrawals", "Digital Services", "Dining", "Education", "Entertainment",
    "Financial Charges", "Government & Professional Services", "Groceries", "Health & Wellness",
    "Housing & Utilities", "Installment Payments", "Insurance", "Other Expense", "Personal Care",
    "Personal Transfers", "Shopping", "Transportation", "Travel",
  ],
  Income: [
    "Cash & Cheque Deposits", "Cashback & Rewards", "Employee Benefits", "Employment Income",
    "Government Benefits", "Investment Income", "Other Income", "Personal Transfers Received",
    "Refunds & Reversals", "Reimbursements",
  ],
  Internal: ["Internal Transfer"],
  Investment: [
    "Asset Distribution", "Crypto Purchase", "Crypto Sale", "Crypto Staking", "Crypto Swap",
    "Dividends", "ETF & Stock Purchase", "ETF & Stock Sale", "Investment Fees",
    "Investment Interest", "Investment Reimbursements", "Investment Taxes", "Securities Lending",
  ],
  Saving: ["Crypto Funding", "Savings Contributions"],
};

describe("transaction category registry", () => {
  it("contains the requested five groups and labels exactly once", () => {
    expect(Expense_categories.map(([label]) => label)).toEqual(expectedCategories.Expense);
    expect(Income_categories.map(([label]) => label)).toEqual(expectedCategories.Income);
    expect(Internal_categories.map(([label]) => label)).toEqual(expectedCategories.Internal);
    expect(Investment_categories.map(([label]) => label)).toEqual(expectedCategories.Investment);
    expect(Saving_categories.map(([label]) => label)).toEqual(expectedCategories.Saving);

    const labels = Object.keys(expectedCategories).flatMap((category) =>
      CATEGORY_GROUPS[category].map(([label]) => label)
    );
    expect(labels).toHaveLength(44);
    expect(new Set(labels).size).toBe(44);
  });

  it("provides an outline icon and resolves the parent for every label", () => {
    for (const [category, labels] of Object.entries(expectedCategories)) {
      for (const label of labels) {
        const icon = getTransactionIcon(category, label);
        expect(icon).toBeTruthy();
        expect(icon.props.strokeWidth).toBe(1.8);
        expect(getCategoryForLabel(label)).toBe(category);
      }
    }
  });

  it("keeps an outline fallback for historical labels", () => {
    expect(getTransactionIcon("Expense", "Food & Dining").props.strokeWidth).toBe(1.8);
  });
});
