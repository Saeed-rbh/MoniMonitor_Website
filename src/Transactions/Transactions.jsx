import React, { useState } from "react";
import { useTransactionData, useWindowHeight } from "../Tools/tools";
import AddTransactionFeed from "../transactionFeedPage/AddTransactionFeed";
import TransactionList from "./TransactionList";
import MoreOpen from "../Tools/MoreOpen";
import "./Transactions.css";

const Transactions = ({ userId }) => {
  const [isAddClicked, setIsAddClicked] = useState(null);
  const [addTransaction, setAddTransaction] = useState({
    Amount: "",
    Category: "",
    Label: "",
    Reason: "",
    Timestamp: "",
    Type: "",
  });
  const handleCloseAddTransaction = () => {
    setAddTransaction({
      Amount: "",
      Category: "",
      Label: "",
      Reason: "",
      Timestamp: "",
      Type: "",
    });
  };
  const [isMoreClicked, setIsMoreClicked] = useState("Balance");
  const [whichMonth, setWhichMonth] = useState(0);

  const {
    selected: selectedData,
    Availability: availabilityData,
    transactions: transactionsData,
  } = useTransactionData(whichMonth, userId);

  const height = useWindowHeight(100);

  const TransactionFeed = () => {
    return (
      <TransactionList
        Transactions={transactionsData}
        selectedData={selectedData}
        isMoreClicked={isMoreClicked}
        setIsMoreClicked={setIsMoreClicked}
        setWhichMonth={setWhichMonth}
        whichMonth={whichMonth}
        dataAvailability={availabilityData}
        setIsAddClicked={setIsAddClicked}
        setAddTransaction={setAddTransaction}
      />
    );
  };

  const [modify, setModify] = useState(false);
  const [open, setOpen] = useState(false);
  const AddFeed = () => {
    return (
      <AddTransactionFeed
        isAddClicked={isAddClicked}
        setIsClicked={setIsAddClicked}
        setAddTransaction={setAddTransaction}
        addTransaction={addTransaction}
        setModify={setModify}
        setOpen={setOpen}
      />
    );
  };
  return (
    <>
      <MoreOpen
        isClicked={isMoreClicked}
        setIsClicked={setIsMoreClicked}
        feed={TransactionFeed}
        MoreOpenHeight={95}
        handleCloseAddTransaction={handleCloseAddTransaction}
        height={height}
        blur={isAddClicked}
      />
      <MoreOpen
        isClicked={isAddClicked}
        setIsClicked={setIsAddClicked}
        feed={AddFeed}
        MoreOpenHeight={100}
        handleCloseAddTransaction={handleCloseAddTransaction}
        height={height}
        zIndex={110}
      />
    </>
  );
};

export default Transactions;
