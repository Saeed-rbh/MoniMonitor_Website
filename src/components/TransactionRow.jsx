import React from "react";
import "./TransactionRow.css";

export default function TransactionRow({ as: Component = "button", icon, reason, date, amount,
  direction = "out", investment = false, counterparty = false, className = "", children, ...props }) {
  return (
    <Component type={Component === "button" ? "button" : undefined}
      className={`TransactionCard AccountTransactions_Row ${counterparty ? "TransactionCard--counterparty" : ""} ${className}`} {...props}>
      <span className="AccountTransactions_Icon" aria-hidden="true">{icon}</span>
      <span className="AccountTransactions_Reason">
        <strong>{reason || "Transaction"}</strong>
        <span>{date}</span>
      </span>
      <span className={`AccountTransactions_Amount ${investment ? "investment" : direction}`}>
        <strong>{investment || direction === "neutral" ? "" : direction === "in" ? "+" : "−"}{amount}</strong>
        <span>{investment ? "invest" : direction === "neutral" ? "transfer" : direction === "in" ? "in" : "out"}</span>
      </span>
      {children}
    </Component>
  );
}
