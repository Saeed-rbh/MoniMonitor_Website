import React from "react";
import TransactionListItem from "./TransactionListItem";
import { animated } from "react-spring";

const TransactionListMonthly = ({
  MainIndex,
  swipedIndex,
  handleUnSwipe,
  handleSwipe,
  handleTransactionClick,
  transactions,
  sortby,
}) => {
  const filteredTransactions =
    sortby === "All"
      ? transactions
      : transactions.filter((transaction) => transaction.Type === sortby);

  return (
    <animated.div className="TransactionList_Monthly">
      <ul className="TransactionList_TransactionList">
        {filteredTransactions.map((transaction, index) => (
          <TransactionListItem
            key={index}
            index={index}
            icon={transaction.icon}
            description={transaction.Reason}
            type={transaction.Type}
            time={transaction.Timestamp}
            amount={transaction.Amount}
            isSwiped={swipedIndex[1] === index && swipedIndex[0] === MainIndex}
            onSwipe={() => handleSwipe(MainIndex, index)}
            onUnSwipe={handleUnSwipe}
            onClick={(y) => handleTransactionClick(transaction)}
          />
        ))}
      </ul>
    </animated.div>
  );
};

export default TransactionListMonthly;
