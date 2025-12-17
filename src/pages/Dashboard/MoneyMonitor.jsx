import React, { useEffect, useState, useMemo } from "react";
import "./MoneyMonitor.css";
import MoneyEntry from "./MoneyEntry";
import { animated, useSpring, easings } from "react-spring";
import { fetchTransactions } from "../../services/transactionService";
import MainStatistics from "./MainStatistics";
import { useWindowHeight } from "../../utils/tools";
import AddTransaction from "./AddTransaction";

import { useTransactions } from "../../context/TransactionContext";

const PERCENTAGE_FACTOR = 40;
const calculatePercentage = (value, max) => (max === 0 ? 0 : (value / max) * PERCENTAGE_FACTOR);

const MoneyMonitor = () => {
  const {
    isDateClicked,
    isMoreClicked,
    setIsMoreClicked,
    isAddClicked,
    setIsAddClicked,
    mainPageMonth,
    setMainPageMonth,
    netAmountsData,
    mainSelected,
    setWhichMonth,
  } = useTransactions();
  const height = useWindowHeight(100);
  useEffect(() => {
    !isMoreClicked && setWhichMonth(mainPageMonth);
  }, [isMoreClicked, mainPageMonth]);

  const scaleStyle = useSpring({
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: "100%",
    scale: isDateClicked || isMoreClicked || isAddClicked !== null ? 0.9 : 1,
    opacity: isDateClicked || isMoreClicked || isAddClicked !== null ? 0.5 : 1,
    filter: isDateClicked || isMoreClicked || isAddClicked !== null
      ? "blur(10px)"
      : "blur(0px)",
    config: {
      duration:
        isDateClicked || isMoreClicked || isAddClicked !== null ? 500 : 300,
      easing: easings.easeInOutQuad,
    },
  });

  const [addTransaction, setAddTransaction] = useState({
    Amount: "",
    Category: "",
    Label: "",
    Reason: "",
    Timestamp: "",
    Type: "",
  });

  const [modify, setModify] = useState(false);

  useEffect(() => {
    if (modify) {
      setIsAddClicked(addTransaction.Category);
    }
  }, [modify]);

  // Logic lifted for vertical shift coordination
  const netSeries = useMemo(
    () => Object.entries(netAmountsData).reverse(),
    [netAmountsData]
  );

  const last6MonthsData = useMemo(
    () => netSeries.map(([Date, value]) => value),
    [netSeries]
  );

  const maxValues = useMemo(() => {
    const allValues = last6MonthsData.reduce(
      (acc, d) => ({
        maxIncome: Math.max(acc.maxIncome, d.income),
        maxNet: Math.max(acc.maxNet, d.net),
        maxSaving: Math.max(acc.maxSaving, d.saving),
        maxExpense: Math.max(acc.maxExpense, d.Expense),
      }),
      { maxIncome: 0, maxNet: 0, maxSaving: 0, maxExpense: 0 }
    );

    const maxOfAll = Math.max(
      allValues.maxIncome,
      allValues.maxNet,
      allValues.maxSaving,
      allValues.maxExpense
    );

    return { ...allValues, maxOfAll };
  }, [last6MonthsData]);

  const verticalShift = useMemo(() => {
    if (!maxValues || typeof maxValues.maxOfAll !== 'number') return 0;

    const incP = calculatePercentage(maxValues.maxIncome || 0, maxValues.maxOfAll);
    const expP = calculatePercentage(maxValues.maxExpense || 0, maxValues.maxOfAll);

    let shift = (incP - expP) / 2;
    if (isNaN(shift)) shift = 0;

    return shift;
  }, [maxValues]);

  return (
    <>
      <div className="MoneyMonitor_Parent">
        <animated.div style={scaleStyle}>
          <MainStatistics
            height={height}
            netAmounts={netAmountsData}
            mainPageMonth={mainPageMonth}
            setMainPageMonth={setMainPageMonth}
            verticalShift={verticalShift}
          />
          <MoneyEntry
            verticalShift={verticalShift}
            setIsMoreClicked={setIsMoreClicked}
            Transactions={
              Object.keys(mainSelected).length > 0
                ? mainSelected
                : {
                  totalIncome: 0,
                  totalExpense: 0,
                  totalSaving: 0,
                  netTotal: 0,
                  month: "Month",
                }
            }
          />
        </animated.div>
      </div>
    </>
  );
};

export default MoneyMonitor;
