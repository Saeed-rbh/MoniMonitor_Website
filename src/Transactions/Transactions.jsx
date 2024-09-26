import React, { useEffect, useState } from "react";
import { useWindowHeight } from "../Tools/tools";
import AddTransactionFeed from "../transactionFeedPage/AddTransactionFeed";
import TransactionList from "./TransactionList";
import MoreOpen from "../Tools/MoreOpen";
import "./Transactions.css";

const Transactions = ({
  monthData,
  isMoreClicked,
  setIsMoreClicked,
  whichMonth,
  setWhichMonth,
  isDateClicked,
}) => {
  useEffect(() => {
    !isMoreClicked && setIsMoreClicked("Balance");
  }, []);
  const selectedData = monthData.selected;
  const availabilityData = monthData.Availability;
  const transactionsData = monthData.transactions;

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
        MoreOpenHeight={90}
        handleCloseAddTransaction={handleCloseAddTransaction}
        height={height}
        blur={isAddClicked !== null || isDateClicked}
        toRedirect={"/"}
      />
      <MoreOpen
        isClicked={isAddClicked}
        setIsClicked={setIsAddClicked}
        feed={AddFeed}
        MoreOpenHeight={90}
        handleCloseAddTransaction={handleCloseAddTransaction}
        height={height}
        zIndex={110}
      />
      {/* <Notif
        addTransaction={addTransaction}
        setAddTransaction={setAddTransaction}
        modify={modify}
        setModify={setModify}
        open={open}
        setOpen={setOpen}
      /> */}
    </>
  );
};

export default Transactions;
