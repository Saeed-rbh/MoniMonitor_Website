import React from "react";
import { useNavigate } from "react-router-dom";
import Transactions from "../Transactions/Transactions";

const SaveInvestTransactions = () => {
  const navigate = useNavigate();

  return (
    <Transactions
      categoryOverride="Save&Invest"
      onManageAccounts={() => navigate("/SaveInvest/Accounts")}
    />
  );
};

export default SaveInvestTransactions;
