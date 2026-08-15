import React, { useEffect, useRef, useState } from "react";
import TransactionListMonthly from "./TransactionListMonthly";
import TransactionModification from "./TransactionModification";
import { useSpring, animated, easings } from "@react-spring/web";
import TransactionFilter from "./transactionFilter";
import { useCustomSpring, useWindowHeight } from "../../utils/tools";
import ChooseTransactionMonth from "./ChooseTransactionMonth";
import MoreOpen from "../../components/MoreOpen/MoreOpen";
import "./Transactions.css";
import {
  isInternalTransfer,
  isSaveInvestTransaction,
  uniqueInternalTransfers,
} from "../../services/transactionService";

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
  onManageAccounts,
  setShowTransaction,
  onTransactionClick,
  isDetailOpen = false,
}) => {
  const filteredTransactions = React.useMemo(() => {
    if (isMoreClicked === "Internal") return uniqueInternalTransfers(Transactions);
    if (isMoreClicked === "Save&Invest") return Transactions.filter(isSaveInvestTransaction);
    return Transactions.filter((transaction) => transaction.Category === isMoreClicked);
  }, [Transactions, isMoreClicked]);

  const WindowHeight = useWindowHeight(100);

  const [sortby, setSortby] = useState("All");
  const [isCalendarClicked, setIsCalendarClicked] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const ITEMS_PER_BATCH = 40;
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_BATCH);

  useEffect(() => {
    setVisibleCount(ITEMS_PER_BATCH);
  }, [whichMonth, isMoreClicked, sortby, searchQuery]);

  // Apply search query filter
  const searchedTransactions = React.useMemo(() => {
    if (!searchQuery.trim()) return filteredTransactions;
    const q = searchQuery.toLowerCase().trim();
    return filteredTransactions.filter(t => 
      (t.Reason && t.Reason.toLowerCase().includes(q)) ||
      (t.Label && t.Label.toLowerCase().includes(q)) ||
      (t.Amount && String(t.Amount).includes(q)) ||
      (t.BankName && t.BankName.toLowerCase().includes(q))
    );
  }, [filteredTransactions, searchQuery]);

  const sortedTransactions = React.useMemo(() => searchedTransactions
    .filter((transaction) => {
      if (sortby === "All") return true;
      if (["Income", "Expense"].includes(sortby)) return transaction.Category === sortby;
      if (sortby === "Save&Invest") return isSaveInvestTransaction(transaction);
      if (sortby === "Internal") return isInternalTransfer(transaction);
      if (sortby === "Today") {
        const transactionDate = new Date(transaction.Timestamp);
        const today = new Date();
        return transactionDate.getDate() === today.getDate() &&
          transactionDate.getMonth() === today.getMonth() &&
          transactionDate.getFullYear() === today.getFullYear();
      }
      if (sortby === "daily") return transaction.Frequency === "Daily";
      if (sortby === "monthly") return transaction.Frequency === "Monthly";
      return true;
    })
    .reverse(), [searchedTransactions, sortby]);

  const visibleTransactions = React.useMemo(
    () => sortedTransactions.slice(0, visibleCount),
    [sortedTransactions, visibleCount]
  );
  const hasMoreTransactions = visibleCount < sortedTransactions.length;
  const loadMoreTransactions = React.useCallback(() => {
    setVisibleCount((current) => Math.min(current + ITEMS_PER_BATCH, sortedTransactions.length));
  }, [sortedTransactions.length]);

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
        isMoreClicked === "Internal"
          ? selectedData.totalInternal || 0
          : isMoreClicked === "Income"
            ? selectedData.totalIncome
            : isMoreClicked === "Expense"
              ? selectedData.totalExpense
              : selectedData.totalSaveInvest ?? selectedData.totalSaving;

      const rawDistribution =
        isMoreClicked === "Internal"
          ? selectedData.labelDistributionInternal
          : isMoreClicked === "Income"
            ? selectedData.labelDistributionIncome
            : isMoreClicked === "Expense"
              ? selectedData.labelDistributionExpense
              : selectedData.labelDistributionSaveInvest ?? selectedData.labelDistributionSaving;
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
  const [transactionListHeight, setTransactionListHeight] = useState(1);

  useEffect(() => {
    const container = monthlyMainRef.current;
    if (!container) return undefined;

    const updateHeight = () => {
      const nextHeight = Math.max(
        1,
        Math.floor(container.getBoundingClientRect().height)
      );
      setTransactionListHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight
      );
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => window.removeEventListener("resize", updateHeight);
    }

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

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
    if (onTransactionClick) {
      onTransactionClick(transaction);
      return;
    }

    setIsAddClicked(transaction.Category);

    setAddTransaction({
      id: transaction.id,
      Amount: transaction.Amount,
      Category: transaction.Category,
      Label: transaction.Label,
      Reason: transaction.Reason,
      Timestamp: transaction.Timestamp,
      Type: transaction.Type,
    });
  };

  const handleTransactionUnClick = () => { };


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

  const isBlurred = Boolean(
    isDetailOpen || isAddClicked !== null || isCalendarClicked || transactionClickAnim
  );

  const ClickBlurStyle = useSpring({
    filter: isBlurred ? "blur(10px)" : "blur(0px)",
    opacity: isBlurred ? 0.45 : 1,
    scale: isBlurred ? 0.92 : 1,
    config: { duration: 250, easing: easings.easeInOutQuad },
  });

  useEffect(() => {
    if (monthlyMainRef.current) {
      monthlyMainRef.current.scrollTop = 0;
    }
  }, [whichMonth, isMoreClicked, sortby, searchQuery]);

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
    if (!isCalendarClicked) {
      handleUnSwipe();
    }
  }, [isCalendarClicked]);

  const TransactionList_Line = useSpring({
    width:
      isMoreClicked === "Expense"
        ? `25px`
        : isMoreClicked === "Income" || isMoreClicked === "Internal"
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
        isMoreClicked === "Internal"
          ? selectedData.totalInternal || 0
          : isMoreClicked === "Income"
            ? selectedData.totalIncome
            : isMoreClicked === "Expense"
              ? selectedData.totalExpense
              : selectedData.totalSaveInvest ?? selectedData.totalSaving
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
      {
        <div
          className="TransactionList_Main"
          // Removed redundant spring style `Open_TransactionList`
          style={{ width: '100%', height: '100%', position: 'relative' }}
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
            </animated.div>
              <TransactionFilter
                sortby={sortby}
                setSortby={setSortby}
                loaded={Boolean(onManageAccounts) || filteredTransactions.length !== 0}
                isMoreClicked={isMoreClicked}
                onManageAccounts={onManageAccounts}
                availabilityMap={{
                  Income: Transactions.some((t) => t.Category === "Income"),
                  Expense: Transactions.some((t) => t.Category === "Expense"),
                  "Save&Invest": Transactions.some(isSaveInvestTransaction),
                  Internal: Transactions.some(isInternalTransfer),
                  Today: filteredTransactions.some((t) => {
                    const d = new Date(t.Timestamp);
                    const now = new Date();
                    return (
                      d.getDate() === now.getDate() &&
                      d.getMonth() === now.getMonth() &&
                      d.getFullYear() === now.getFullYear()
                    );
                  }),
                  daily: filteredTransactions.some(
                    (t) => t.Frequency === "Daily"
                  ),
                  monthly: filteredTransactions.some(
                    (t) => t.Frequency === "Monthly"
                  ),
                  All: true,
                }}
              />

            {/* Search Input Bar */}
            <div className="TransactionList_Search">
              <input
                className="TransactionList_SearchInput"
                type="text"
                placeholder="Search transactions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <animated.div
              className="TransactionList_MonthlyMain"
              ref={monthlyMainRef}
            >
              {selectedData && Object.keys(selectedData).length !== 0 && (
                <TransactionListMonthly
                  key={`${whichMonth}-${isMoreClicked}-${sortby}-${searchQuery}`}
                  swipedIndex={swipedIndex}
                  handleUnSwipe={handleUnSwipe}
                  handleSwipe={handleSwipe}
                  handleTransactionClick={handleTransactionClick}
                  useCustomSpring={useCustomSpring}
                  transactions={visibleTransactions}
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
                  height={transactionListHeight}
                  hasMore={hasMoreTransactions}
                  onLoadMore={loadMoreTransactions}
                />
              )}
            </animated.div>

          </animated.div>
        </div>
      }
    </>
  );
};

export default TransactionList;
