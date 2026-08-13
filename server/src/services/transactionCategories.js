const EXPENSE_LABELS = [
    'Cash Withdrawals',
    'Digital Services',
    'Dining',
    'Education',
    'Entertainment',
    'Financial Charges',
    'Government & Professional Services',
    'Groceries',
    'Health & Wellness',
    'Housing & Utilities',
    'Installment Payments',
    'Insurance',
    'Other Expense',
    'Personal Care',
    'Personal Transfers',
    'Shopping',
    'Transportation',
    'Travel',
];

const INCOME_LABELS = [
    'Cash & Cheque Deposits',
    'Cashback & Rewards',
    'Employee Benefits',
    'Employment Income',
    'Government Benefits',
    'Investment Income',
    'Other Income',
    'Personal Transfers Received',
    'Refunds & Reversals',
    'Reimbursements',
];

const INTERNAL_LABELS = ['Internal Transfer'];

const INVESTMENT_LABELS = [
    'Asset Distribution',
    'Crypto Purchase',
    'Crypto Sale',
    'Crypto Staking',
    'Crypto Swap',
    'Dividends',
    'ETF & Stock Purchase',
    'ETF & Stock Sale',
    'Investment Fees',
    'Investment Interest',
    'Investment Reimbursements',
    'Investment Taxes',
    'Securities Lending',
];

const SAVING_LABELS = ['Crypto Funding', 'Savings Contributions'];

const CATEGORY_LABELS = Object.freeze({
    Expense: EXPENSE_LABELS,
    Income: INCOME_LABELS,
    Internal: INTERNAL_LABELS,
    Investment: INVESTMENT_LABELS,
    Saving: SAVING_LABELS,
});

const ALL_LABELS = Object.values(CATEGORY_LABELS).flat();

module.exports = {
    ALL_LABELS,
    CATEGORY_LABELS,
    EXPENSE_LABELS,
    INCOME_LABELS,
    INTERNAL_LABELS,
    INVESTMENT_LABELS,
    SAVING_LABELS,
};
