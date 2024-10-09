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
    const filtered =
      sortby === "All"
        ? [...transactions].reverse()
        : transactions
            .filter((transaction) => transaction.Type === sortby)
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
          isSwiped={swipedIndex[1] === index && swipedIndex[0] === MainIndex}
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
        </div>
      )}
    </>
  );
};

export default TransactionListMonthly;
