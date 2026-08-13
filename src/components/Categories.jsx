import {
  ArrowLeftRight,
  BadgeCheck,
  BadgeDollarSign,
  Banknote,
  Bitcoin,
  BriefcaseBusiness,
  BusFront,
  CalendarClock,
  ChartNoAxesCombined,
  CircleDollarSign,
  CircleHelp,
  Clapperboard,
  Coins,
  CreditCard,
  FileText,
  Gift,
  GraduationCap,
  HandCoins,
  Handshake,
  HeartPulse,
  HousePlug,
  Landmark,
  MonitorSmartphone,
  PackageOpen,
  Percent,
  PiggyBank,
  Plane,
  Receipt,
  ReceiptText,
  Repeat2,
  RotateCcw,
  Scale,
  Scissors,
  Send,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Sprout,
  TrendingDown,
  TrendingUp,
  UserRoundPlus,
  Utensils,
  WalletCards,
} from "lucide-react";

const outline = (Icon) => <Icon aria-hidden="true" strokeWidth={1.8} />;

export const Expense_categories = [
  ["Cash Withdrawals", outline(Banknote)],
  ["Digital Services", outline(MonitorSmartphone)],
  ["Dining", outline(Utensils)],
  ["Education", outline(GraduationCap)],
  ["Entertainment", outline(Clapperboard)],
  ["Financial Charges", outline(CreditCard)],
  ["Government & Professional Services", outline(Scale)],
  ["Groceries", outline(ShoppingBasket)],
  ["Health & Wellness", outline(HeartPulse)],
  ["Housing & Utilities", outline(HousePlug)],
  ["Installment Payments", outline(CalendarClock)],
  ["Insurance", outline(ShieldCheck)],
  ["Other Expense", outline(CircleHelp)],
  ["Personal Care", outline(Scissors)],
  ["Personal Transfers", outline(Send)],
  ["Shopping", outline(ShoppingBag)],
  ["Transportation", outline(BusFront)],
  ["Travel", outline(Plane)],
];

export const Income_categories = [
  ["Cash & Cheque Deposits", outline(Landmark)],
  ["Cashback & Rewards", outline(Gift)],
  ["Employee Benefits", outline(BadgeCheck)],
  ["Employment Income", outline(BriefcaseBusiness)],
  ["Government Benefits", outline(HandCoins)],
  ["Investment Income", outline(ChartNoAxesCombined)],
  ["Other Income", outline(CircleDollarSign)],
  ["Personal Transfers Received", outline(UserRoundPlus)],
  ["Refunds & Reversals", outline(RotateCcw)],
  ["Reimbursements", outline(ReceiptText)],
];

export const Internal_categories = [
  ["Internal Transfer", outline(ArrowLeftRight)],
];

export const Investment_categories = [
  ["Asset Distribution", outline(PackageOpen)],
  ["Crypto Purchase", outline(Bitcoin)],
  ["Crypto Sale", outline(Coins)],
  ["Crypto Staking", outline(Sprout)],
  ["Crypto Swap", outline(Repeat2)],
  ["Dividends", outline(BadgeDollarSign)],
  ["ETF & Stock Purchase", outline(TrendingUp)],
  ["ETF & Stock Sale", outline(TrendingDown)],
  ["Investment Fees", outline(Receipt)],
  ["Investment Interest", outline(Percent)],
  ["Investment Reimbursements", outline(WalletCards)],
  ["Investment Taxes", outline(FileText)],
  ["Securities Lending", outline(Handshake)],
];

export const Saving_categories = [
  ["Crypto Funding", outline(CircleDollarSign)],
  ["Savings Contributions", outline(PiggyBank)],
];

export const SaveInvest_categories = [
  ...Investment_categories,
  ...Saving_categories,
];

export const CATEGORY_GROUPS = {
  Expense: Expense_categories,
  Income: Income_categories,
  Internal: Internal_categories,
  Investment: Investment_categories,
  Saving: Saving_categories,
  "Save&Invest": SaveInvest_categories,
};

const legacyIcons = new Map([
  ["e-transfer", outline(ArrowLeftRight)],
  ["education & training", outline(GraduationCap)],
  ["food & dining", outline(Utensils)],
  ["groceries & dining", outline(ShoppingBasket)],
  ["leisure & recreation", outline(Clapperboard)],
  ["medical & health", outline(HeartPulse)],
  ["other", outline(CircleHelp)],
  ["transport", outline(BusFront)],
  ["fees & charges", outline(CreditCard)],
  ["payroll", outline(BriefcaseBusiness)],
  ["bank deposit", outline(Landmark)],
  ["e-transfer in", outline(UserRoundPlus)],
  ["e-transfer out", outline(Send)],
  ["investment activity", outline(ChartNoAxesCombined)],
  ["cryptocurrency", outline(Bitcoin)],
  ["savings account", outline(PiggyBank)],
  ["stocks", outline(TrendingUp)],
  ["investment", outline(TrendingUp)],
  ["savings", outline(PiggyBank)],
  ["debt payment", outline(CalendarClock)],
  ["tfsa withdrawal", outline(PackageOpen)],
]);

export const getCategoryList = (category) => CATEGORY_GROUPS[category] || [];

export const getCategoryForLabel = (label, fallback = "Saving") => {
  const normalized = String(label || "").toLowerCase();
  for (const [category, items] of Object.entries(CATEGORY_GROUPS)) {
    if (category === "Save&Invest") continue;
    if (items.some(([name]) => name.toLowerCase() === normalized)) return category;
  }
  return fallback;
};

export const getTransactionIcon = (category, label) => {
  const normalized = String(label || "").toLowerCase();
  const found = getCategoryList(category).find(
    ([name]) => name.toLowerCase() === normalized
  );
  if (found) return found[1];

  for (const items of Object.values(CATEGORY_GROUPS)) {
    const crossCategoryMatch = items.find(([name]) => name.toLowerCase() === normalized);
    if (crossCategoryMatch) return crossCategoryMatch[1];
  }
  return legacyIcons.get(normalized) || outline(CircleHelp);
};
