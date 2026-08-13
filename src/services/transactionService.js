import { format, parse, addMonths, isBefore } from "date-fns";
import { GetDataFromDB } from "./apiService";

const monthsNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const normalizeAccountName = (value) =>
  String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const parseInternalTransfer = (reason) => {
  const match = String(reason || "").match(
    /^Internal transfer:\s*(.*?)\s*->\s*(.*?)(?:\s*\[|$)/i
  );
  return match ? { source: match[1], destination: match[2] } : null;
};

export const isInternalTransfer = (transaction) =>
  /^Internal transfer:/i.test(String(transaction?.Reason || "").trim());

export const getInternalTransferKey = (transaction) => {
  const reference = String(transaction?.ReferenceNumber || "").trim();
  if (reference) return `reference:${reference.toLowerCase()}`;

  const reason = String(transaction?.Reason || "");
  const embeddedReference = reason.match(/\[(XFER-[^\]]+)\]/i)?.[1];
  if (embeddedReference) return `reference:${embeddedReference.toLowerCase()}`;

  if (transaction?.id !== undefined && transaction?.id !== null) {
    return `transaction:${transaction.id}`;
  }

  return [transaction?.Timestamp, transaction?.Amount, reason].join("|").toLowerCase();
};

export const getSavingEffect = (transaction) => {
  const amount = Number(transaction?.Amount || 0);
  if (!Number.isFinite(amount)) return 0;

  if (transaction?.Category === "SavingWithdrawal") return -amount;
  if (!["Saving", "Save&Invest"].includes(transaction?.Category)) return 0;

  const label = String(transaction?.Label || "").toLowerCase();
  if (label === "tfsa withdrawal") return -amount;
  if (label === "tfsa contribution") return amount;

  const transfer = parseInternalTransfer(transaction?.Reason);
  if (!transfer) return 0;

  const account = normalizeAccountName(transaction?.Account);
  if (!account.includes("tfsa")) return 0;

  const source = normalizeAccountName(transfer.source);
  const destination = normalizeAccountName(transfer.destination);
  if (source.includes("tfsa") && destination.includes("tfsa")) return 0;
  if (destination.includes("tfsa")) return amount;
  if (source.includes("tfsa")) return -amount;
  return 0;
};

export const getSaveInvestActivity = (transaction) => {
  const amount = Number(transaction?.Amount || 0);
  if (!Number.isFinite(amount)) return 0;
  if (transaction?.Category === "Investment") return Math.abs(amount);
  return Math.abs(getSavingEffect(transaction));
};

export const isSaveInvestTransaction = (transaction) =>
  getSaveInvestActivity(transaction) > 0;

export const uniqueInternalTransfers = (transactions) => {
  const seen = new Set();
  return (transactions || []).filter((transaction) => {
    if (!isInternalTransfer(transaction)) return false;
    const key = getInternalTransferKey(transaction);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const fillMissingMonths = (data) => {
  if (!data || data.length === 0) return [];

  const startDate = parse(data[0][0], "yyyy-MM", new Date());
  const endDate = new Date(); // Current date
  let currentDate = startDate;

  const dateSet = new Set(data.map((item) => item[0]));

  const filledData = [];

  while (
    isBefore(currentDate, endDate) ||
    format(currentDate, "yyyy-MM") === format(endDate, "yyyy-MM")
  ) {
    const currentMonth = format(currentDate, "yyyy-MM");
    if (!dateSet.has(currentMonth)) {
      filledData.push([currentMonth, []]);
    } else {
      filledData.push(data.find((item) => item[0] === currentMonth));
    }
    currentDate = addMonths(currentDate, 1);
  }

  return filledData;
};

const LabelDistribution = (amount, labels) => {
  if (!Number.isFinite(Number(amount)) || Number(amount) === 0) return {};

  const labelPercentages = Object.keys(labels).map((label) => {
    return {
      label: label,
      percentage: (labels[label] / amount) * 100,
    };
  });

  labelPercentages.sort((a, b) => {
    if (b.percentage !== a.percentage) {
      return b.percentage - a.percentage; // Sort by percentage descending
    } else {
      return a.label.localeCompare(b.label); // Maintain stability by label name
    }
  });

  const sortedDistribution = {};
  labelPercentages.forEach((item) => {
    sortedDistribution[item.label] = Number(item.percentage.toFixed(2));
  });

  return sortedDistribution;
};

export const groupTransactionsByMonth = (transactions) => {
  const groupedTransactions = {};

  const sortedTransactions = [...(transactions || [])].sort(
    (a, b) => new Date(a.Timestamp) - new Date(b.Timestamp)
  );

  sortedTransactions.forEach((transaction) => {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const date = new Date(transaction.Timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0"); // Ensure month is two digits
    const key = `${year}-${month}`;

    if (!groupedTransactions[key]) {
      groupedTransactions[key] = {
        transactions: [],
        totalExpense: 0,
        totalIncome: 0,
        totalSaving: 0,
        totalSaveInvest: 0,
        totalInternal: 0,
        netTotal: 0,
        month: months[date.getMonth()],
        year: year,
        percentageChange: null,
        labelDistributionExpense: {},
        labelDistributionIncome: {},
        labelDistributionSaving: {},
        labelDistributionSaveInvest: {},
        labelDistributionInternal: {},
        labelDistribution: {},
        internalTransferKeys: new Set(),
      };
    }

    groupedTransactions[key].transactions.push(transaction);
    const label = transaction.Label;
    const amount = Number(transaction.Amount);

    if (isInternalTransfer(transaction)) {
      const transferKey = getInternalTransferKey(transaction);
      if (!groupedTransactions[key].internalTransferKeys.has(transferKey)) {
        groupedTransactions[key].internalTransferKeys.add(transferKey);
        groupedTransactions[key].totalInternal += amount;
        if (label) {
          groupedTransactions[key].labelDistributionInternal[label] =
            (groupedTransactions[key].labelDistributionInternal[label] || 0) + amount;
        }
      }
    }

    if (transaction.Category === "Expense") {
      groupedTransactions[key].totalExpense += amount;
      groupedTransactions[key].netTotal -= amount;
      if (label) {
        groupedTransactions[key].labelDistributionExpense[label] =
          (groupedTransactions[key].labelDistributionExpense[label] || 0) +
          amount;
      }
    } else if (transaction.Category === "Income") {
      groupedTransactions[key].totalIncome += amount;
      groupedTransactions[key].netTotal += amount;
      if (label) {
        groupedTransactions[key].labelDistributionIncome[label] =
          (groupedTransactions[key].labelDistributionIncome[label] || 0) +
          amount;
      }
    } else {
      const savingEffect = getSavingEffect(transaction);
      const saveInvestActivity = getSaveInvestActivity(transaction);
      // Only money crossing the TFSA boundary affects savings. Other internal
      // transfers and trades remain visible activity but have no cash-flow effect.
      groupedTransactions[key].totalSaving += savingEffect;
      groupedTransactions[key].totalSaveInvest += saveInvestActivity;
      groupedTransactions[key].netTotal -= savingEffect;
      if (label) {
        groupedTransactions[key].labelDistributionSaving[label] =
          (groupedTransactions[key].labelDistributionSaving[label] || 0) +
          savingEffect;
        groupedTransactions[key].labelDistributionSaveInvest[label] =
          (groupedTransactions[key].labelDistributionSaveInvest[label] || 0) +
          saveInvestActivity;
      }
    }
  });

  // Determine top labels and sort by percentage (with stability)
  Object.keys(groupedTransactions)?.forEach((key) => {
    const expenseAmount = groupedTransactions[key].totalExpense;
    const labelExpense = groupedTransactions[key].labelDistributionExpense;

    groupedTransactions[key].labelDistributionExpense = LabelDistribution(
      expenseAmount,
      labelExpense
    );

    const incomeAmount = groupedTransactions[key].totalIncome;
    const labelIncome = groupedTransactions[key].labelDistributionIncome;
    groupedTransactions[key].labelDistributionIncome = LabelDistribution(
      incomeAmount,
      labelIncome
    );

    const savingAmount = groupedTransactions[key].totalSaving;
    const labelSaving = groupedTransactions[key].labelDistributionSaving;
    groupedTransactions[key].labelDistributionSaving = LabelDistribution(
      savingAmount,
      labelSaving
    );

    groupedTransactions[key].labelDistributionSaveInvest = LabelDistribution(
      groupedTransactions[key].totalSaveInvest,
      groupedTransactions[key].labelDistributionSaveInvest
    );

    groupedTransactions[key].labelDistributionInternal = LabelDistribution(
      groupedTransactions[key].totalInternal,
      groupedTransactions[key].labelDistributionInternal
    );

    delete groupedTransactions[key].internalTransferKeys;

    const netTotal =
      groupedTransactions[key].totalExpense +
      groupedTransactions[key].totalIncome +
      groupedTransactions[key].totalSaving;

    groupedTransactions[key].labelDistribution = {
      Expense: Number(
        ((groupedTransactions[key].totalExpense / netTotal) * 100).toFixed(2)
      ),
      Income: Number(
        ((groupedTransactions[key].totalIncome / netTotal) * 100).toFixed(2)
      ),
      Saving: Number(
        ((groupedTransactions[key].totalSaving / netTotal) * 100).toFixed(2)
      ),
    };
  });

  const sortedGroupedTransactions = Object.entries(groupedTransactions).sort(
    ([a], [b]) => a.localeCompare(b)
  );

  let previousNetTotal = null;
  sortedGroupedTransactions?.forEach(([key, value], index) => {
    const currentNetTotal = value.netTotal;
    if (index > 0 && previousNetTotal !== null) {
      const percentageChange =
        ((currentNetTotal - previousNetTotal) / Math.abs(previousNetTotal)) *
        100;
      groupedTransactions[key].percentageChange = parseInt(
        percentageChange.toFixed(0)
      );
    }
    previousNetTotal = currentNetTotal;
  });

  const updatedData = fillMissingMonths(sortedGroupedTransactions);

  return Object.fromEntries(updatedData);
};

const getMonthDataAvailability = (data) => {
  const availability = {};

  let counter = Object.entries(data).length;

  // Populate availability with true for months with data
  Object.entries(data)?.forEach((item) => {
    const timestamp = item[0];
    const [year, month] = timestamp.split("-");
    const monthName = monthsNames[Number(month) - 1];
    counter--;

    if (!availability[year]) {
      availability[year] = {};
    }

    if (Object.entries(item[1]).length > 0) {
      availability[year][monthName] = [true, counter];
    } else {
      availability[year][monthName] = [false, counter];
    }
  });

  return availability;
};

export const getNetAmounts = (Transactions) => {
  const TransObject = Object.keys(Transactions);
  const allMonths = [...TransObject];

  // The dashboard needs the complete history. Starting at the newest key made
  // every older imported month disappear from the main chart.
  const earliestMonth = allMonths.reduce((earliest, month) => {
    if (!earliest || month < earliest) {
      return month;
    }
    return earliest;
  }, null);

  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  const months = [];
  if (!earliestMonth) return {};

  const [earliestYear, earliestMonthNum] = earliestMonth.split("-").map(Number);
  let tempDate = new Date(earliestYear, earliestMonthNum - 1);

  while (
    tempDate.getFullYear() < currentYear ||
    (tempDate.getFullYear() === currentYear &&
      tempDate.getMonth() <= currentMonth - 1)
  ) {
    const year = tempDate.getFullYear();
    const month = tempDate.getMonth() + 1;
    months.push(`${year}-${month.toString().padStart(2, "0")}`);

    if (tempDate.getMonth() === 11) {
      tempDate.setFullYear(tempDate.getFullYear() + 1);
      tempDate.setMonth(0);
    } else {
      tempDate.setMonth(tempDate.getMonth() + 1);
    }
  }

  const result = months.reduce((acc, month) => {
    const incomeTotal =
      Number(Transactions[month]?.totalIncome?.toFixed(2)) || 0;
    const expenseTotal =
      Number(Transactions[month]?.totalExpense?.toFixed(2)) || 0;
    const savingTotal =
      Number(Transactions[month]?.totalSaving?.toFixed(2)) || 0;
    const netTotal = Number(Transactions[month]?.netTotal?.toFixed(2)) || 0;
    acc[month] = {
      income: incomeTotal,
      Expense: expenseTotal,
      saving: savingTotal,
      net: netTotal,
      month: monthsNames[Number(month.split("-")[1]) - 1],
    };
    return acc;
  }, {});

  return result;
};

export const fetchAllTransactionData = async () => {
  let allTransactions = await GetDataFromDB();
  if (!Array.isArray(allTransactions)) allTransactions = [];


  const totalTransactions = groupTransactionsByMonth(allTransactions);

  const Availability = Object.entries(
    getMonthDataAvailability(totalTransactions)
  ).reverse();

  const netAmounts = getNetAmounts(totalTransactions);

  return {
    totalTransactions,
    Availability,
    netAmounts,
  };
};

export const getSelectedMonthData = (transactionsByMonth, whichMonth) => {
  const entries = Object.entries(transactionsByMonth);
  const targetIndex = entries.length - whichMonth - 1;
  const result = entries[targetIndex] ? entries[targetIndex][1] : null;

  if (result) {
    const { transactions, ...rest } = result;
    return { transactions, selected: rest };
  }
  return { transactions: [], selected: {} };
};

export const fetchTransactions = async ({ whichMonth }) => {
  const { totalTransactions, Availability, netAmounts } =
    await fetchAllTransactionData();

  const { transactions, selected } = getSelectedMonthData(
    totalTransactions,
    whichMonth
  );

  return {
    selected,
    Availability,
    transactions,
    netAmounts,
  };
};
