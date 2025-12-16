import React, { useMemo, useCallback } from "react";
import TransactionListItem from "./TransactionListItem";
import { FixedSizeList as List } from "react-window"; // For virtualization

const TransactionListMonthly = ({
  MainIndex,
  swipedIndex,
  handleUnSwipe,
  handleSwipe,
  handleTransactionClick,
  transactions,
  sortby,
  isAddClicked,
  setOpen,
  setShowTransaction,
  height,
}) => {
  // Memoize the filtered transactions
  const filteredTransactions = useMemo(() => {
    const filtered = transactions
      .filter((transaction) => {
        if (sortby === "All") return true;

        // Strict Category Matching
        if (["Income", "Expense", "Save&Invest"].includes(sortby)) {
          return transaction.Category === sortby;
        }

        // Date Matching
        if (sortby === "Today") {
          const transDate = new Date(transaction.Timestamp);
          const today = new Date();
          return (
            transDate.getDate() === today.getDate() &&
            transDate.getMonth() === today.getMonth() &&
            transDate.getFullYear() === today.getFullYear()
          );
        }

        // Recurrence Filtering (Frequency)
        if (sortby === "daily") {
          return transaction.Frequency === "Daily";
        }

        if (sortby === "monthly") {
          return transaction.Frequency === "Monthly";
        }

        return true;
      })
      .reverse();

    return filtered;
  }, [transactions, sortby]);

  // Memoize the handleSwipe, handleUnSwipe, and handleTransactionClick to avoid re-creating functions
  const memoizedHandleSwipe = useCallback(
    (index) => handleSwipe(MainIndex, index),
    [MainIndex, handleSwipe]
  );

  const memoizedHandleUnSwipe = useCallback(handleUnSwipe, [handleUnSwipe]);

  const memoizedHandleTransactionClick = useCallback(
    (transaction) => handleTransactionClick(transaction),
    [handleTransactionClick]
  );

  const Row = ({ index, style }) => {
    const transaction = filteredTransactions[index];
    return (
      <div style={style}>
        <TransactionListItem
          key={index}
          index={index}
          icon={transaction.icon}
          description={transaction.Reason}
          type={transaction.Type}
          time={transaction.Timestamp}
          amount={transaction.Amount}
          category={transaction.Category}
          label={transaction.Label}
          isSwiped={
            swipedIndex &&
            swipedIndex[1] === index &&
            swipedIndex[0] === MainIndex
          }
          onSwipe={() => memoizedHandleSwipe(index)}
          onUnSwipe={memoizedHandleUnSwipe}
          onClick={() => memoizedHandleTransactionClick(transaction)}
          isAddClicked={isAddClicked}
          setOpen={setOpen}
          setShowTransaction={setShowTransaction}
        />
      </div>
    );
  };

  return (
    <>
      {filteredTransactions && (
        <div className="TransactionList_Monthly">
          <List
            height={height}
            itemCount={filteredTransactions.length}
            itemSize={55}
            className="TransactionList_TransactionList"
          >
            {Row}
          </List>
          {filteredTransactions.length === 0 && (
            <div style={{ textAlign: "center", padding: "20px", color: "var(--Ac-1)" }}>
              No transactions found
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default TransactionListMonthly;
