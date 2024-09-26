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

  const [totalAmount, setTotalAmount] = useState(0);
  const [currentMonth, setCurrentMonth] = useState("");
  const [currentYear, setCurrentYear] = useState("");
  const [labelDistribution, setLabelDistribution] = useState([]);

  useEffect(() => {
    if (selectedData.length !== 0) {
      setTotalAmount(
        isMoreClicked === "Balance"
          ? selectedData.totalExpense +
              selectedData.totalIncome +
              selectedData.totalSaving
          : isMoreClicked === "Income"
          ? selectedData.totalIncome
          : isMoreClicked === "Expense"
          ? selectedData.totalExpense
          : selectedData.totalSaving
      );
      setCurrentMonth(selectedData.month);
      setCurrentYear(selectedData.year);

      const distribution =
        isMoreClicked === "Balance"
          ? selectedData.labelDistribution
          : isMoreClicked === "Income"
          ? selectedData.labelDistributionIncome
          : isMoreClicked === "Expense"
          ? selectedData.labelDistributionExpense
          : selectedData.labelDistributionSaving;

      let other = 0;
      let sortedData = Object.entries(distribution)
        .map(([category, percentage]) => {
          const percentageValue = percentage;
          if (
            category !== "Other" &&
            (Object.entries(distribution).length < 4 || percentageValue > 5)
          ) {
            return {
              category,
              percentage: percentageValue,
            };
          } else {
            other += percentageValue;
            return null;
          }
        })
        .filter((item) => item !== null)
        .sort((a, b) => b.percentage - a.percentage);

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
      setLabelDistribution(sortedData);
    }
  }, [selectedData, whichMonth, isMoreClicked]);

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

  const handleTransactionUnClick = () => {};

  const SummaryWidth = [
    labelDistribution.length > 0 && !!labelDistribution[0]
      ? labelDistribution[0].percentage
      : 0,
    labelDistribution.length > 0 && !!labelDistribution[1]
      ? labelDistribution[1].percentage
      : 0,
    labelDistribution.length > 0 && !!labelDistribution[2]
      ? labelDistribution[2].percentage
      : 0,
    labelDistribution.length > 0 && !!labelDistribution[3]
      ? labelDistribution[3].percentage
      : 0,
  ];

  const summaryStiles = [
    useSpring({
      width: SummaryWidth[0] + "%",
      color:
        isMoreClicked === "Balance" && labelDistribution.length > 0
          ? labelDistribution[0].category === "Income"
            ? "var(--Fc-2)"
            : labelDistribution[0].category === "Expense"
            ? "var(--Gc-2)"
            : "var(--Ac-2)"
          : "var(--Cc-2)",
      backgroundColor:
        isMoreClicked === "Balance" && labelDistribution.length > 0
          ? labelDistribution[0].category === "Income"
            ? "var(--Fc-2)"
            : labelDistribution[0].category === "Expense"
            ? "var(--Gc-2)"
            : "var(--Ac-2)"
          : "var(--Cc-2)",
    }),
    useSpring({
      width: SummaryWidth[1] + "%",
      color:
        isMoreClicked === "Balance" && labelDistribution.length > 0
          ? labelDistribution[1].category === "Income"
            ? "var(--Fc-2)"
            : labelDistribution[1].category === "Expense"
            ? "var(--Gc-2)"
            : "var(--Ac-2)"
          : "var(--Dc-2)",
      backgroundColor:
        isMoreClicked === "Balance" && labelDistribution.length > 0
          ? labelDistribution[1].category === "Income"
            ? "var(--Fc-2)"
            : labelDistribution[1].category === "Expense"
            ? "var(--Gc-2)"
            : "var(--Ac-2)"
          : "var(--Dc-2)",
    }),
    useSpring({
      width: SummaryWidth[2] + "%",
      justifyContent: "flex-end",
      color:
        isMoreClicked === "Balance" && labelDistribution.length > 0
          ? labelDistribution[2].category === "Income"
            ? "var(--Fc-2)"
            : labelDistribution[2].category === "Expense"
            ? "var(--Gc-2)"
            : "var(--Ac-2)"
          : "var(--Bc-2)",
      backgroundColor:
        isMoreClicked === "Balance" && labelDistribution.length > 0
          ? labelDistribution[2].category === "Income"
            ? "var(--Fc-2)"
            : labelDistribution[2].category === "Expense"
            ? "var(--Gc-2)"
            : "var(--Ac-2)"
          : "var(--Bc-2)",
    }),
    useSpring({
      width: SummaryWidth[3] + "%",
      color: "var(--Ac-1)",
      backgroundColor: "var(--Ac-2)",
      justifyContent: "flex-end",
    }),
  ];

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

    for (let index = 0; index < dataAvailabilityLength; index++) {
      const entries = Object.entries(dataAvailability);
      if (entries[index]) {
        const innerEntries = Object.entries(entries[index][1]);
        if (innerEntries[1]) {
          totalElementLength += Object.entries(innerEntries[1][1]).length;
        }
      }
    }

    setElementLength(totalElementLength);
  }, [dataAvailability, dataAvailabilityLength]);

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
                •<span>{isMoreClicked}</span>
                <div className="TransactionList_TitleMonth">
                  {currentMonth} | {currentYear}
                </div>
              </p>
              <h1>
                Total:{" "}
                <span style={colorStyle}>
                  $
                  {Math.abs(
                    isMoreClicked === "Balance"
                      ? selectedData.netTotal
                      : isMoreClicked === "Income"
                      ? selectedData.totalIncome
                      : isMoreClicked === "Expense"
                      ? selectedData.totalExpense
                      : selectedData.totalSaving
                  ).toFixed(2)}
                </span>
              </h1>
            </animated.div>
            <animated.div
              className="TransactionList_SummaryAmount"
              // style={springProps2}
            >
              {SummaryWidth[0] > 0 && (
                <animated.li
                  style={{
                    ...summaryStiles[0],
                    backgroundColor: "transparent",
                  }}
                >
                  $
                  {labelDistribution.length > 0
                    ? Math.abs((SummaryWidth[0] * totalAmount) / 100).toFixed(0)
                    : 0}
                </animated.li>
              )}
              {SummaryWidth[1] > 0 && (
                <animated.li
                  style={{
                    ...summaryStiles[1],
                    backgroundColor: "transparent",
                  }}
                >
                  $
                  {labelDistribution.length > 0
                    ? Math.abs((SummaryWidth[1] * totalAmount) / 100).toFixed(0)
                    : 0}
                </animated.li>
              )}
              {SummaryWidth[2] > 0 && (
                <animated.li
                  style={{
                    ...summaryStiles[2],
                    backgroundColor: "transparent",
                  }}
                >
                  $
                  {labelDistribution.length > 0
                    ? Math.abs((SummaryWidth[2] * totalAmount) / 100).toFixed(0)
                    : 0}
                </animated.li>
              )}
              {SummaryWidth[3] > 0 && (
                <animated.li
                  style={{
                    ...summaryStiles[3],
                    backgroundColor: "transparent",
                  }}
                >
                  $
                  {labelDistribution.length > 0
                    ? Math.abs((SummaryWidth[3] * totalAmount) / 100).toFixed(0)
                    : 0}
                </animated.li>
              )}
            </animated.div>
            <animated.div
              className="TransactionList_SummaryLines"
              // style={springProps2}
            >
              {SummaryWidth[0] > 0 && (
                <animated.li style={summaryStiles[0]}></animated.li>
              )}
              {SummaryWidth[1] > 0 && (
                <animated.li style={summaryStiles[1]}></animated.li>
              )}
              {SummaryWidth[2] > 0 && (
                <animated.li style={summaryStiles[2]}></animated.li>
              )}
              {SummaryWidth[3] > 0 && (
                <animated.li style={summaryStiles[3]}></animated.li>
              )}
            </animated.div>
            <animated.div
              className="TransactionList_SummaryNames"
              // style={springProps2}
            >
              {SummaryWidth[0] > 0 && (
                <animated.li>
                  <animated.span
                    style={{
                      ...summaryStiles[0],
                      width: "fit-content",
                      backgroundColor: "transparent",
                    }}
                  >
                    •
                  </animated.span>
                  {labelDistribution.length > 0
                    ? labelDistribution[0].category.split(" ")[0]
                    : ""}
                </animated.li>
              )}
              {SummaryWidth[1] > 0 && (
                <animated.li>
                  <animated.span
                    style={{
                      ...summaryStiles[1],
                      width: "fit-content",
                      backgroundColor: "transparent",
                    }}
                  >
                    •
                  </animated.span>
                  {labelDistribution.length > 0
                    ? labelDistribution[1].category.split(" ")[0]
                    : ""}
                </animated.li>
              )}
              {SummaryWidth[2] > 0 && (
                <animated.li>
                  <animated.span
                    style={{
                      ...summaryStiles[2],
                      width: "fit-content",
                      backgroundColor: "transparent",
                    }}
                  >
                    •
                  </animated.span>
                  {labelDistribution.length > 0
                    ? labelDistribution[2].category.split(" ")[0]
                    : ""}
                </animated.li>
              )}
              {SummaryWidth[3] > 0 && (
                <animated.li>
                  <animated.span
                    style={{
                      ...summaryStiles[3],
                      width: "fit-content",
                      backgroundColor: "transparent",
                    }}
                  >
                    •
                  </animated.span>
                  Other
                </animated.li>
              )}
            </animated.div>
            <TransactionFilter
              sortby={sortby}
              setSortby={setSortby}
              isMoreClicked={isMoreClicked}
              setIsCalendarClicked={setIsCalendarClicked}
              isCalendarClicked={isCalendarClicked}
            />

            <animated.div
              className="TransactionList_MonthlyMain"
              ref={monthlyMainRef}
              style={springProps4}
            >
              {selectedData.length !== 0 && (
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
