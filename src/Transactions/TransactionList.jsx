import React, { useEffect, useRef, useState } from "react";
import TransactionListMonthly from "./TransactionListMonthly";
import TransactionModification from "./TransactionModification";
import { useSpring, animated } from "@react-spring/web";
import TransactionFilter from "./transactionFilter";
import { useCustomSpring, useWindowHeight } from "../Tools/tools";
import ChooseTransactionMonth from "./ChooseTransactionMonth";
import MoreOpen from "../Tools/MoreOpen";

const TransactionList = ({
  isMoreClicked,
  selectedData,
  setIsMoreClicked,
  Transactions,
  dataAvailability,
  setWhichMonth,
  whichMonth,
  setIsAddClicked,
  setAddTransaction,
  isAddClicked,
  setOpen,
  setShowTransaction,
}) => {
  const filteredTransactions =
    isMoreClicked === "Balance"
      ? Transactions
      : Transactions.filter(
        (transaction) => transaction.Category === isMoreClicked
      );

  const WindowHeight = useWindowHeight(100);

  const [sortby, setSortby] = useState("All");
  const [isCalendarClicked, setIsCalendarClicked] = useState(false);

  const { totalAmount, currentMonth, currentYear, labelDistribution } =
    React.useMemo(() => {
      if (!selectedData || Object.keys(selectedData).length === 0) {
        return {
          totalAmount: 0,
          currentMonth: "",
          currentYear: "",
          labelDistribution: [],
        };
      }

      const calculatedTotal =
        isMoreClicked === "Balance"
          ? selectedData.totalExpense +
          selectedData.totalIncome +
          selectedData.totalSaving
          : isMoreClicked === "Income"
            ? selectedData.totalIncome
            : isMoreClicked === "Expense"
              ? selectedData.totalExpense
              : selectedData.totalSaving;

      const rawDistribution =
        isMoreClicked === "Balance"
          ? selectedData.labelDistribution
          : isMoreClicked === "Income"
            ? selectedData.labelDistributionIncome
            : isMoreClicked === "Expense"
              ? selectedData.labelDistributionExpense
              : selectedData.labelDistributionSaving;

      let sortedData = [];
      if (rawDistribution) {
        if (Array.isArray(rawDistribution)) {
          sortedData = [...rawDistribution];
        } else if (typeof rawDistribution === "object") {
          sortedData = Object.entries(rawDistribution).map(
            ([label, percentage]) => ({
              category: label,
              percentage: percentage,
            })
          );
        }
      }
      sortedData.sort((a, b) => b.percentage - a.percentage);

      let other = 0;
      if (sortedData.length === 1) {
        sortedData.push(null, null);
      } else if (sortedData.length === 2) {
        sortedData.push(null);
      } else if (sortedData.length > 3) {
        for (let index = 3; index < sortedData.length; index++) {
          other += sortedData[index].percentage;
        }
        sortedData = sortedData.slice(0, 3);
      }
      sortedData.push({ category: "Other", percentage: other });

      return {
        totalAmount: calculatedTotal,
        currentMonth: selectedData.month,
        currentYear: selectedData.year,
        labelDistribution: sortedData,
      };
    }, [selectedData, isMoreClicked]);

  const monthlyMainRef = useRef(null);

  const [swipedIndex, setSwipedIndex] = useState([null, null]);
  const [transactionClick, setTransactionClick] = useState([null, null, null]);
  const [transactionClickAnim, settransactionClickAnim] = useState(false);

  const handleSwipe = (MainIndex, index) => {
    setSwipedIndex([MainIndex, index]);
  };

  const handleUnSwipe = () => {
    setSwipedIndex([null, null]);
  };

  const handleTransactionClick = (transaction) => {
    setIsAddClicked(transaction.Category);

    setAddTransaction({
      Amount: transaction.Amount,
      Category: transaction.Category,
      Label: transaction.Label,
      Reason: transaction.Reason,
      Timestamp: transaction.Timestamp,
      Type: transaction.Type,
    });
  };

  const handleTransactionUnClick = () => { };



  const [isAnimationEnds, setIsAnimationEnds] = useState(false);
  useEffect(() => {
    isMoreClicked && setIsAnimationEnds(true);
  }, [isMoreClicked]);

  const [Open_TransactionList, api] = useSpring(() => ({
    scale: isCalendarClicked ? 0.9 : 1,
    opacity: 0,
    height: "calc(10vh - 100px)",
  }));

  const isOpenRef = useRef(isMoreClicked);

  useEffect(() => {
    isOpenRef.current = isMoreClicked;
  }, [isMoreClicked]);

  const handleOnRest = () => {
    !isOpenRef.current && setIsAnimationEnds(false);
    !isOpenRef.current && setIsCalendarClicked(false);
  };

  useEffect(() => {
    isAnimationEnds &&
      api.start({
        scale: isCalendarClicked ? 0.9 : !!isMoreClicked ? 1 : 0.9,
        opacity: !isMoreClicked ? 0 : 1,
        height: !!isMoreClicked ? "calc(100vh - 100px)" : "calc(10vh - 100px)",
        filter: isCalendarClicked ? "blur(10px)" : "blur(0px)",
        onRest: () => {
          handleOnRest();
        },
      });
  }, [
    isMoreClicked,
    isAnimationEnds,
    api,
    setIsCalendarClicked,
    isCalendarClicked,
  ]);

  const colorStyle = {
    color:
      isMoreClicked === "Income"
        ? "var(--Fc-2)"
        : isMoreClicked === "Expense"
          ? "var(--Gc-2)"
          : isMoreClicked === "Save&Invest"
            ? "var(--Bc-2)"
            : selectedData.netTotal > 0
              ? "var(--Fc-2)"
              : "var(--Gc-2)",
  };

  const springProps4 = useSpring({
    height: WindowHeight - 180,
  });

  const ClickBlurStyle = useSpring({
    from: {
      filter: transactionClickAnim ? "blur(0px)" : "blur(10px)",
      opacity: transactionClickAnim ? "1" : "0.7",
      scale: transactionClickAnim ? 1 : 0.9,
      height: "calc(100vh - 50px))",
    },
    to: {
      filter: transactionClickAnim ? "blur(10px)" : "blur(0px)",
      opacity: transactionClickAnim ? "0.7" : "1",
      scale: transactionClickAnim ? 0.9 : 1,
      height: "calc(100vh - 50px))",
    },
  });

  useEffect(() => {
    if (monthlyMainRef.current) {
      monthlyMainRef.current.scrollTop = 0;
    }
  }, [whichMonth]);

  const dataAvailabilityLength = Object.entries(dataAvailability).length;

  const [elementLength, setElementLength] = useState(0);

  useEffect(() => {
    let totalElementLength = 0;

    if (Array.isArray(dataAvailability)) {
      dataAvailability.forEach((entry) => {
        // entry is [year, monthData]
        if (entry && entry[1]) {
          totalElementLength += Object.keys(entry[1]).length;
        }
      });
    }

    setElementLength(totalElementLength);
  }, [dataAvailability]);

  const MoreOpenHeight =
    WindowHeight - 80 * Math.ceil(elementLength / 6) > 100
      ? WindowHeight - 80 * Math.ceil(elementLength / 6)
      : 100;

  const calendarFeed = () => {
    return (
      <ChooseTransactionMonth
        dataAvailability={dataAvailability}
        setWhichMonth={setWhichMonth}
        whichMonth={whichMonth}
        isClicked={isCalendarClicked}
        setIsClicked={setIsCalendarClicked}
      />
    );
  };

  useEffect(() => {
    if (!(!isCalendarClicked && isAnimationEnds)) {
      handleUnSwipe();
    }
  }, [isCalendarClicked, isAnimationEnds]);

  const TransactionList_Line = useSpring({
    width:
      isMoreClicked === "Expense"
        ? `25px`
        : isMoreClicked === "Income" || isMoreClicked === "Balance"
          ? `15px`
          : `65px`,
    position: `absolute`,
    height: `1px`,
    background: `var(--Ac-3)`,
    top: `8px`,
    left: `63px`,
  });

  const TransactionList_Line2 = useSpring({
    width:
      Math.abs(
        isMoreClicked === "Balance"
          ? selectedData.netTotal
          : isMoreClicked === "Income"
            ? selectedData.totalIncome
            : isMoreClicked === "Expense"
              ? selectedData.totalExpense
              : selectedData.totalSaving
      ).toFixed(2).length *
      8 +
      5,
    position: `absolute`,
    height: `1px`,
    background: `var(--Ac-3)`,
    top: `8px`,
    left: `40px`,
  });

  return (
    <>
      <MoreOpen
        isClicked={isCalendarClicked}
        setIsClicked={setIsCalendarClicked}
        feed={calendarFeed}
        MoreOpenHeight={MoreOpenHeight}
      />
      {isAnimationEnds && (
        <animated.div
          className="TransactionList_Main"
          style={Open_TransactionList}
        >
          {transactionClick[0] !== null && (
            <TransactionModification
              transactionClick={transactionClick}
              handleTransactionUnClick={handleTransactionUnClick}
              settransactionClickAnim={settransactionClickAnim}
              transactionClickAnim={transactionClickAnim}
            />
          )}
          <animated.div className="TransactionList_Wall" style={ClickBlurStyle}>
            <div className="TransactionList_TopLine"></div>
            <animated.div className="TransactionList_Title">
              <p style={colorStyle} onClick={() => setIsMoreClicked(null)}>
                <span>{isMoreClicked}</span>
                <div className="TransactionList_TitleMonth">
                  {currentMonth} | {currentYear}
                  <animated.div style={TransactionList_Line}></animated.div>
                </div>
              </p>
              <h1>
                Total:{" "}
                <animated.div style={TransactionList_Line2}></animated.div>
                <span style={colorStyle}>
                  $
                  {Math.abs(totalAmount).toFixed(2)}
                </span>
              </h1>
              <TransactionFilter
                sortby={sortby}
                setSortby={setSortby}
                loaded={filteredTransactions.length !== 0}
              />
            </animated.div>

            <animated.div
              className="TransactionList_MonthlyMain"
              ref={monthlyMainRef}
              style={springProps4}
            >
              {selectedData && Object.keys(selectedData).length !== 0 && (
                <TransactionListMonthly
                  swipedIndex={swipedIndex}
                  handleUnSwipe={handleUnSwipe}
                  handleSwipe={handleSwipe}
                  handleTransactionClick={handleTransactionClick}
                  useCustomSpring={useCustomSpring}
                  transactions={filteredTransactions}
                  netTotal={selectedData.netTotal}
                  percentageChange={selectedData.percentageChange}
                  month={selectedData.month}
                  year={selectedData.year}
                  sortby={sortby}
                  dataAvailability={dataAvailability}
                  setWhichMonth={setWhichMonth}
                  whichMonth={whichMonth}
                  isAddClicked={isAddClicked}
                  setOpen={setOpen}
                  setShowTransaction={setShowTransaction}
                  height={WindowHeight - 180}
                />
              )}
            </animated.div>
          </animated.div>
        </animated.div>
      )}
    </>
  );
};

export default TransactionList;
