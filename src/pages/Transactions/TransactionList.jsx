import React, { useEffect, useRef, useState } from "react";
import TransactionListMonthly from "./TransactionListMonthly";
import TransactionModification from "./TransactionModification";
import { useSpring, animated } from "@react-spring/web";
import TransactionFilter from "./transactionFilter";
import { useCustomSpring, useWindowHeight } from "../../utils/tools";
import ChooseTransactionMonth from "./ChooseTransactionMonth";
import MoreOpen from "../../components/MoreOpen/MoreOpen";
import "./Transactions.css";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const ITEMS_PER_PAGE = 30;

  // Reset page when settings or search change
  useEffect(() => {
    setCurrentPage(0);
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

  // Calculate paginated subset
  const pageCount = Math.ceil(searchedTransactions.length / ITEMS_PER_PAGE);
  const paginatedTransactions = React.useMemo(() => {
    const start = currentPage * ITEMS_PER_PAGE;
    return searchedTransactions.slice(start, start + ITEMS_PER_PAGE);
  }, [searchedTransactions, currentPage]);

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

  const springProps4 = useSpring({
    height: WindowHeight - 230,
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
    if (!isCalendarClicked) {
      handleUnSwipe();
    }
  }, [isCalendarClicked]);

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
                loaded={filteredTransactions.length !== 0}
                isMoreClicked={isMoreClicked}
                availabilityMap={{
                  Income: Transactions.some((t) => t.Category === "Income"),
                  Expense: Transactions.some((t) => t.Category === "Expense"),
                  "Save&Invest": Transactions.some(
                    (t) => t.Category === "Save&Invest"
                  ),
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
              style={springProps4}
            >
              {selectedData && Object.keys(selectedData).length !== 0 && (
                <TransactionListMonthly
                  swipedIndex={swipedIndex}
                  handleUnSwipe={handleUnSwipe}
                  handleSwipe={handleSwipe}
                  handleTransactionClick={handleTransactionClick}
                  useCustomSpring={useCustomSpring}
                  transactions={paginatedTransactions}
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
                  height={WindowHeight - 230}
                />
              )}
            </animated.div>

            {/* Pagination Controls */}
            {pageCount > 1 && (
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 20px",
                borderTop: "1px solid rgba(255, 255, 255, 0.05)",
                background: "rgba(0, 0, 0, 0.2)",
                borderRadius: "0 0 20px 20px"
              }}>
                <button
                  disabled={currentPage === 0}
                  onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                  style={{
                    border: "1px solid var(--Bc-3)",
                    background: "rgba(255, 255, 255, 0.02)",
                    color: currentPage === 0 ? "rgba(255, 255, 255, 0.2)" : "var(--Ac-1)",
                    borderRadius: "20px",
                    padding: "4px 12px",
                    fontSize: "0.75rem",
                    cursor: currentPage === 0 ? "default" : "pointer"
                  }}
                >
                  Previous
                </button>
                <span style={{ fontSize: "0.75rem", color: "var(--Ac-3)" }}>
                  Page {currentPage + 1} of {pageCount}
                </span>
                <button
                  disabled={currentPage >= pageCount - 1}
                  onClick={() => setCurrentPage(prev => Math.min(pageCount - 1, prev + 1))}
                  style={{
                    border: "1px solid var(--Bc-3)",
                    background: "rgba(255, 255, 255, 0.02)",
                    color: currentPage >= pageCount - 1 ? "rgba(255, 255, 255, 0.2)" : "var(--Ac-1)",
                    borderRadius: "20px",
                    padding: "4px 12px",
                    fontSize: "0.75rem",
                    cursor: currentPage >= pageCount - 1 ? "default" : "pointer"
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </animated.div>
        </div>
      }
    </>
  );
};

export default TransactionList;
