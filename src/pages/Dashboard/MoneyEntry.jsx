import React from "react";
import MoneyEntryAmount from "./MoneyEntryAmount.jsx";
import { useNavigate } from "react-router-dom";
import BlurFade from "@/components/ui/blur-fade";

const MoneyEntry = ({ Transactions, setIsMoreClicked, verticalShift = 0 }) => {
  const totalStyle = {
    color:
      Transactions.netTotal > 0
        ? "rgba(131, 255, 201, 0.85)"
        : "rgb(255 102 102 / 85%)",
  };

  const redirect = useNavigate();

  const redirectClick = () => {
    redirect("/Transactions");
  };

  return (
    Transactions && (
      <div className="MoneyEntry" style={{ transform: `translateY(${-verticalShift * 0.5}%)`, transition: "transform 0.5s ease-out" }}>
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
              type="Income"
              setIsMoreClicked={setIsMoreClicked}
              transaction={Transactions}
              redirectClick={redirectClick}
              index={3}
            />

            <MoneyEntryAmount
              type="Expense"
              setIsMoreClicked={setIsMoreClicked}
              transaction={Transactions}
              redirectClick={redirectClick}
              index={2}
            />
          </div>
          <div className="MoneyEntry_AmountBase">
            <MoneyEntryAmount
              type="Save&Invest"
              setIsMoreClicked={setIsMoreClicked}
              transaction={Transactions}
              redirectClick={redirectClick}
              index={1}
            />
            <MoneyEntryAmount
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
