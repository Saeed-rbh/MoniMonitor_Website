import React, { useCallback, useEffect, useState } from "react";
import { useWindowHeight } from "../Tools/tools";
import AddTransactionFeed from "../transactionFeedPage/AddTransactionFeed";
import TransactionList from "./TransactionList";
import MoreOpen from "../Tools/MoreOpen";
import "./Transactions.css";
import Notification from "@/Notification/Notification";

const Transactions = ({
  monthData,
  isMoreClicked,
  setIsMoreClicked,
  whichMonth,
  setWhichMonth,
  isDateClicked,
}) => {
  const selectedData = monthData.selected;
  const availabilityData = monthData.Availability;
  const transactionsData = monthData.transactions;

  const [modify, setModify] = useState(false);
  const [open, setOpen] = useState(false);

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

  const height = useWindowHeight(90);

  const TransactionFeed = useCallback(() => {
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
        isAddClicked={isAddClicked}
        setOpen={setOpen}
        setShowTransaction={setAddTransaction}
      />
    );
  }, [
    transactionsData,
    selectedData,
    isMoreClicked,
    whichMonth,
    availabilityData,
    isAddClicked,
  ]);

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
        MoreOpenHeight={75}
        handleCloseAddTransaction={handleCloseAddTransaction}
        height={height}
        blur={isAddClicked !== null || isDateClicked}
        toRedirect={"/"}
      />
      {isAddClicked !== null && (
        <MoreOpen
          isClicked={isAddClicked}
          setIsClicked={setIsAddClicked}
          feed={AddFeed}
          MoreOpenHeight={75}
          handleCloseAddTransaction={handleCloseAddTransaction}
          height={height}
          zIndex={110}
        />
      )}
      {open && (
        <Notification
          addTransaction={addTransaction}
          setAddTransaction={setAddTransaction}
          modify={modify}
          setModify={setModify}
          open={open}
          setOpen={setOpen}
        />
      )}
    </>
  );
};

export default Transactions;
