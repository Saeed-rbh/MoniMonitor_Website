import React, { useCallback, useEffect, useState } from "react";
import { useWindowHeight } from "../../utils/tools";
import { useNavigate } from "react-router-dom";
import AddTransactionFeed from "../../transactionFeedPage/AddTransactionFeed";
import TransactionList from "./TransactionList";
import MoreOpen from "../../components/MoreOpen/MoreOpen";
import TransactionDetailModal from "../../components/TransactionDetailModal/TransactionDetailModal";
import "./Transactions.css";
import Notification from "../../components/Notification/Notification";

import { useTransactions } from "../../context/TransactionContext";

const Transactions = ({ categoryOverride = null, onManageAccounts = null }) => {
  const {
    monthData,
    isMoreClicked,
    setIsMoreClicked,
    whichMonth,
    setWhichMonth,
    isDateClicked,
  } = useTransactions();
  const selectedData = monthData.selected;
  const navigate = useNavigate();
  const availabilityData = monthData.Availability;
  const transactionsData = monthData.transactions;

  const [modify, setModify] = useState(false);
  const [standaloneOpen, setStandaloneOpen] = useState(Boolean(categoryOverride));
  const activeCategory = categoryOverride || isMoreClicked;
  const setActiveCategory = useCallback((value) => {
    if (categoryOverride) {
      setStandaloneOpen(Boolean(value));
      return;
    }
    setIsMoreClicked(value);
  }, [categoryOverride, setIsMoreClicked]);
  const handleManageAccounts = useCallback(() => {
    if (onManageAccounts) {
      onManageAccounts();
      return;
    }
    navigate("/Accounts/Manage");
  }, [navigate, onManageAccounts]);
  const [open, setOpen] = useState(false);
  const [viewingTx, setViewingTx] = useState(null);

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
        isMoreClicked={activeCategory}
        setIsMoreClicked={setActiveCategory}
        setWhichMonth={setWhichMonth}
        whichMonth={whichMonth}
        dataAvailability={availabilityData}
        setIsAddClicked={setIsAddClicked}
        setAddTransaction={setAddTransaction}
        isAddClicked={isAddClicked}
        setOpen={setOpen}
        setShowTransaction={setAddTransaction}
        onTransactionClick={(tx) => setViewingTx(tx)}
        onManageAccounts={
          activeCategory === "Save&Invest" ? handleManageAccounts : null
        }
      />
    );
  }, [
    transactionsData,
    selectedData,
    activeCategory,
    whichMonth,
    availabilityData,
    isAddClicked,
    handleManageAccounts,
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
        isClicked={categoryOverride ? standaloneOpen : isMoreClicked}
        setIsClicked={categoryOverride ? setStandaloneOpen : setIsMoreClicked}
        feed={TransactionFeed}
        MoreOpenHeight={75}
        handleCloseAddTransaction={handleCloseAddTransaction}
        height={height}
        blur={isAddClicked !== null || isDateClicked || viewingTx !== null}
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
          overflow={"hidden"}
        />
      )}
      <TransactionDetailModal
        transaction={viewingTx}
        onClose={() => setViewingTx(null)}
        onEdit={(tx) => {
          setViewingTx(null);
          setIsAddClicked(tx.Category || "Expense");
          setAddTransaction({
            id: tx.id,
            Amount: tx.Amount,
            Category: tx.Category,
            Label: tx.Label,
            Reason: tx.Reason,
            Timestamp: tx.Timestamp,
            Type: tx.Type,
            Account: tx.Account,
            BankName: tx.BankName,
          });
        }}
      />
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
