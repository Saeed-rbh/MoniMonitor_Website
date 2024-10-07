import React from "react";
import TransactionListItem from "./TransactionListItem";
import { animated } from "react-spring";
import BlurFade from "@/components/ui/blur-fade";

const TransactionListMonthly = ({
  MainIndex,
  swipedIndex,
  handleUnSwipe,
  handleSwipe,
  handleTransactionClick,
  transactions,
  sortby,
  isAddClicked,
}) => {
  const filteredTransactions =
    sortby === "All"
      ? [...transactions].reverse()
      : transactions
          .filter((transaction) => transaction.Type === sortby)
          .reverse();

  return (
    <animated.div className="TransactionList_Monthly">
      <ul className="TransactionList_TransactionList">
        {filteredTransactions.map((transaction, index) => {
          const transactionItem = (
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
                swipedIndex[1] === index && swipedIndex[0] === MainIndex
              }
              onSwipe={() => handleSwipe(MainIndex, index)}
              onUnSwipe={handleUnSwipe}
              onClick={() => handleTransactionClick(transaction)}
              isAddClicked={isAddClicked}
            />
          );

          return index < 7 ? (
            <BlurFade key={index} delay={0.15 * index}>
              {transactionItem}
            </BlurFade>
          ) : (
            transactionItem
          );
        })}
      </ul>
    </animated.div>
  );
};

export default TransactionListMonthly;
