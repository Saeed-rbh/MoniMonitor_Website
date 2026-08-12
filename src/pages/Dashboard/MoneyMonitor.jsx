import React, { useEffect } from "react";
import "./MoneyMonitor.css";
import MoneyEntry from "./MoneyEntry";
import { animated, useSpring, easings } from "@react-spring/web";
import MainStatistics from "./MainStatistics";
import { useWindowHeight } from "../../utils/tools";

import { useTransactions } from "../../context/TransactionContext";

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

  return (
    <>
      <div className="MoneyMonitor_Parent">
        <animated.div className="MoneyMonitor_Content" style={scaleStyle}>
          <MainStatistics
            height={height}
            netAmounts={netAmountsData}
            mainPageMonth={mainPageMonth}
            setMainPageMonth={setMainPageMonth}
          />
          <MoneyEntry
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
