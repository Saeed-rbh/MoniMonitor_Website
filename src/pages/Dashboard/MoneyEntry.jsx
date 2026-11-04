import { useTransactions } from '../../context/TransactionContext';
import { useRemoteData } from '../../hooks/useRemoteData';
import DataStatus from '../../components/DataStatus';
import React from "react";
import MoneyEntryAmount from "./MoneyEntryAmount.jsx";
import { useNavigate } from "react-router-dom";
import BlurFade from "@/components/ui/blur-fade";
import { getPortfolioAPI } from '../../services/apiService';

const MoneyEntry = ({ Transactions, setIsMoreClicked }) => {
  const { currency } = useTransactions();
  const remote = useRemoteData(getPortfolioAPI);
  const portfolio = remote.data;
  const totalStyle = {
    color:
      Transactions.netTotal > 0
        ? "rgba(131, 255, 201, 0.85)"
        : "rgb(255 102 102 / 85%)",
  };

  const redirect = useNavigate();

  const redirectClick = (path = '/Transactions') => {
    redirect(path);
  };

  return (
    Transactions && (
      <div className="MoneyEntry">
        <DataStatus {...remote} />
        <BlurFade delay={0.3 + 0.05 * 4} duration={0.4}>
          <div className="MoneyEntry_Title">
            <h1>
              <span className="MoneyEntry_Dot" style={totalStyle}>
                •{" "}
              </span>
              <span>{Transactions.month}</span> Summary
            </h1>
          </div>
        </BlurFade>
        <div className="MoneyEntry_Data">
          <div className="MoneyEntry_AmountBase">
            <MoneyEntryAmount
              currency={currency}
              type="Income"
              setIsMoreClicked={setIsMoreClicked}
              transaction={Transactions}
              redirectClick={redirectClick}
              index={3}
            />

            <MoneyEntryAmount
              currency={currency}
              type="Expense"
              setIsMoreClicked={setIsMoreClicked}
              transaction={Transactions}
              redirectClick={redirectClick}
              index={2}
            />
          </div>
          <div className="MoneyEntry_AmountBase">
            <MoneyEntryAmount
              currency={currency}
              type="Save&Invest"
              setIsMoreClicked={setIsMoreClicked}
              transaction={Transactions}
              redirectClick={redirectClick}
              portfolio={portfolio}
              portfolioLoading={remote.isLoading}
              portfolioError={Boolean(remote.error)}
              index={1}
            />
            <MoneyEntryAmount
              currency={currency}
              type="Balance"
              setIsMoreClicked={setIsMoreClicked}
              transaction={Transactions}
              redirectClick={redirectClick}
              index={0}
            />
          </div>
        </div>
      </div>
    )
  );
};

export default MoneyEntry;
