import { format, parse, addMonths, isBefore } from "date-fns";

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

const fillMissingMonths = (data) => {
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

const LabelDistribution = (Amount, labels) => {
  const labelPercentages = Object.keys(labels).map((label) => {
    return {
      label: label,
      percentage: (labels[label] / Amount) * 100, // Convert to string with 2 decimal places
    };
  });

  // Sort labels by percentage descending, with stability by label name
  labelPercentages.sort((a, b) => {
    if (b.percentage !== a.percentage) {
      return b.percentage - a.percentage; // Sort by percentage descending
    } else {
      return a.label.localeCompare(b.label); // Maintain stability by label name
    }
  });

  // Reconstruct label distribution with sorted percentages
  const sortedLabelDistributionSpending = {};
  labelPercentages.forEach((item) => {
    sortedLabelDistributionSpending[item.label] = Number(
      item.percentage.toFixed(2)
    );
  });

  // Assign sorted label distribution back to groupedTransactions

  return sortedLabelDistributionSpending;
};

const groupTransactionsByMonth = (transactions) => {
  const groupedTransactions = {};

  transactions.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));

  transactions.forEach((transaction) => {
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
        totalSpending: 0,
        totalIncome: 0,
        totalSaving: 0,
        netTotal: 0,
        month: months[date.getMonth()],
        year: year,
        percentageChange: null,
        labelDistributionSpending: {},
        labelDistributionIncome: {},
        labelDistributionSaving: {},
        labelDistribution: {},
      };
    }

    groupedTransactions[key].transactions.push(transaction);
    const label = transaction.Label;

    if (transaction.Category === "Spending") {
      groupedTransactions[key].totalSpending += transaction.Amount;
      groupedTransactions[key].netTotal -= transaction.Amount;
      if (label) {
        if (groupedTransactions[key].labelDistributionSpending[label]) {
          groupedTransactions[key].labelDistributionSpending[label] +=
            transaction.Amount;
        } else {
          groupedTransactions[key].labelDistributionSpending[label] =
            transaction.Amount;
        }
      }
    } else if (transaction.Category === "Income") {
      groupedTransactions[key].totalIncome += transaction.Amount;
      groupedTransactions[key].netTotal += transaction.Amount;
      if (label) {
        if (groupedTransactions[key].labelDistributionIncome[label]) {
          groupedTransactions[key].labelDistributionIncome[label] +=
            transaction.Amount;
        } else {
          groupedTransactions[key].labelDistributionIncome[label] =
            transaction.Amount;
        }
      }
    } else if (transaction.Category === "Save&Invest") {
      groupedTransactions[key].totalSaving += transaction.Amount;
      if (label) {
        if (groupedTransactions[key].labelDistributionSaving[label]) {
          groupedTransactions[key].labelDistributionSaving[label] +=
            transaction.Amount;
        } else {
          groupedTransactions[key].labelDistributionSaving[label] =
            transaction.Amount;
        }
      }
    }
  });

  // Determine top labels and sort by percentage (with stability)
  Object.keys(groupedTransactions).forEach((key) => {
    const SpendingAmount = groupedTransactions[key].totalSpending;
    const labelSpending = groupedTransactions[key].labelDistributionSpending;

    groupedTransactions[key].labelDistributionSpending = LabelDistribution(
      SpendingAmount,
      labelSpending
    );

    const IncomeAmount = groupedTransactions[key].totalIncome;
    const labelIncome = groupedTransactions[key].labelDistributionIncome;
    groupedTransactions[key].labelDistributionIncome = LabelDistribution(
      IncomeAmount,
      labelIncome
    );

    const SavingAmount = groupedTransactions[key].totalSaving;
    const labelSaving = groupedTransactions[key].labelDistributionSaving;
    groupedTransactions[key].labelDistributionSaving = LabelDistribution(
      SavingAmount,
      labelSaving
    );

    const netTotal =
      groupedTransactions[key].totalSpending +
      groupedTransactions[key].totalIncome +
      groupedTransactions[key].totalSaving;

    groupedTransactions[key].labelDistribution = {
      Spending: Number(
        ((groupedTransactions[key].totalSpending / netTotal) * 100).toFixed(2)
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
  sortedGroupedTransactions.forEach(([key, value], index) => {
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
  Object.entries(data).forEach((item) => {
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

const getNetAmounts = (Transactions) => {
  const TransObject = Object.keys(Transactions);
  const allMonths = [...TransObject];

  const latestMonth = allMonths.reduce((latest, month) => {
    if (!latest || new Date(month) < new Date(latest)) {
      return month;
    }
    return latest;
  }, null);

  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  const months = [];
  const [latestYear, latestMonthNum] = latestMonth.split("-").map(Number);
  let tempDate = new Date(latestYear, latestMonthNum - 1);

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
    const spendingTotal =
      Number(Transactions[month]?.totalSpending?.toFixed(2)) || 0;
    const savingTotal =
      Number(Transactions[month]?.totalSaving?.toFixed(2)) || 0;
    const netTotal = Number(Transactions[month]?.netTotal?.toFixed(2)) || 0;
    acc[month] = {
      income: incomeTotal,
      spending: spendingTotal,
      saving: savingTotal,
      net: netTotal,
      month: monthsNames[Number(month.split("-")[1]) - 1],
    };
    return acc;
  }, {});

  return result;
};

const fetchJson = async (url) => {
  const response = await fetch(url, { cache: "no-store" });
  return response.json();
};

const getSelectedMonthData = (transactionsByMonth, whichMonth) => {
  const entries = Object.entries(transactionsByMonth);
  return !!entries[entries.length - whichMonth - 1]
    ? entries[entries.length - whichMonth - 1][1]
    : null;
};

export const fetchTransactions = async ({ whichMonth }) => {
  const allTransactions = await fetchJson("/transactions_sorted.json");
  // const allTransactions = await GetDataFromDB();

  const totalTransactions = groupTransactionsByMonth(allTransactions);

  const Availability = Object.entries(
    getMonthDataAvailability(totalTransactions)
  ).reverse();

  const { transactions, ...selected } = getSelectedMonthData(
    totalTransactions,
    whichMonth
  );

  const netAmounts = getNetAmounts(totalTransactions);

  return {
    selected,
    Availability,
    transactions,
    netAmounts,
  };
};
