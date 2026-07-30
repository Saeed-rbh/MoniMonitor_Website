import React, { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useTransactions } from "../../context/TransactionContext";

const SaveInvestTransactions = () => {
  const { setIsMoreClicked } = useTransactions();

  useEffect(() => {
    setIsMoreClicked("Save&Invest");
  }, [setIsMoreClicked]);

  return <Navigate to="/Transactions" replace />;
};

export default SaveInvestTransactions;
