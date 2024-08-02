import React from "react";
import MoneyEntryAmount from "./MoneyEntryAmount.jsx";

const MoneyEntry = ({ Transactions, setIsMoreClicked }) => {
  const totalStyle = {
    color:
      Transactions.netTotal > 0
        ? "rgba(131, 255, 201, 0.85)"
        : "rgb(255 102 102 / 85%)",
  };

  return (
    <div className="MoneyEntry">
      <div className="MoneyEntry_Title">
        <h1>
          <span className="MoneyEntry_Dot" style={totalStyle}>
            •{" "}
          </span>
          <span>{Transactions.month}</span> Summary
        </h1>
      </div>
      <div className="MoneyEntry_Data">
        <div className="MoneyEntry_AmountBase">
          <MoneyEntryAmount
            type="Income"
            setIsMoreClicked={setIsMoreClicked}
            transaction={Transactions}
          />
          <MoneyEntryAmount
            type="Spending"
            setIsMoreClicked={setIsMoreClicked}
            transaction={Transactions}
          />
        </div>
        <div className="MoneyEntry_AmountBase">
          <MoneyEntryAmount
            type="Save&Invest"
            setIsMoreClicked={setIsMoreClicked}
            transaction={Transactions}
          />
          <MoneyEntryAmount
            type="Balance"
            setIsMoreClicked={setIsMoreClicked}
            transaction={Transactions}
          />
        </div>
      </div>
    </div>
  );
};

export default MoneyEntry;
