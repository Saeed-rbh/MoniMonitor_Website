import React from "react";
import { FiCalendar, FiCreditCard, FiTag, FiRepeat, FiCheckCircle } from "react-icons/fi";
import { getTransactionIcon } from "../Categories";
import { getTransactionDisplayReason } from "../../utils/transactionDisplay";
import MoreOpen from "../MoreOpen/MoreOpen";
import "./TransactionDetailModal.css";

const money = (transaction) => {
  const minor = Number.isFinite(Number(transaction?.AmountMinor))
    ? Number(transaction.AmountMinor)
    : Math.round(Number(transaction?.Amount || 0) * 100);
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: transaction?.Currency || "CAD",
    maximumFractionDigits: 2,
  }).format(Math.abs(minor) / 100);
};

const getTxDirection = (tx) => {
  const flow = String(tx?.AccountFlow || "").toUpperCase();
  if (flow === "IN") return "in";
  if (flow === "OUT") return "out";
  const cat = String(tx?.Category || "").toLowerCase();
  const type = String(tx?.Type || "").toLowerCase();
  return cat === "income" || type === "income" || type === "credit" ? "in" : "out";
};

const formatFullDate = (timestamp) => {
  if (!timestamp) return "Date unrecorded";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const TransactionDetailModal = ({ transaction, onClose, onEdit = null }) => {
  if (!transaction) return null;

  const direction = getTxDirection(transaction);
  const reason = getTransactionDisplayReason(transaction.Reason, transaction.Label);
  const category = transaction.Category || "Expense";
  const label = transaction.Label || category;
  const account = transaction.Account || transaction.BankName || transaction.AccountName || "Personal Account";
  const frequency = transaction.Frequency || (transaction.Type === "Monthly" ? "Monthly Recurring" : "One-Time");

  const feed = () => (
    <div className="TxDetail_Sheet">
      <div className="TxDetail_Header">
        <div className={`TxDetail_IconBox ${direction} ${category.toLowerCase().replace(/[^a-z0-9]/g, '')}`}>
          {getTransactionIcon(category, label)}
        </div>
        <div className="TxDetail_BadgeRow">
          <span className={`TxDetail_CategoryBadge ${category.toLowerCase().replace(/[^a-z0-9]/g, '')}`}>{category}</span>
          {label && label !== category && (
            <span className="TxDetail_LabelBadge">{label}</span>
          )}
        </div>
        <h2 className="TxDetail_Reason">{reason || "Transaction"}</h2>
        <div className={`TxDetail_Amount ${direction}`}>
          <span>{direction === "in" ? "+" : "−"}{money(transaction)}</span>
        </div>
      </div>

      <div className="TxDetail_Card">
        <div className="TxDetail_Row">
          <div className="TxDetail_RowLeft">
            <FiCalendar className="TxDetail_RowIcon" />
            <span>Date & Time</span>
          </div>
          <strong className="TxDetail_RowRight">{formatFullDate(transaction.Timestamp)}</strong>
        </div>

        <div className="TxDetail_Row">
          <div className="TxDetail_RowLeft">
            <FiCreditCard className="TxDetail_RowIcon" />
            <span>Account</span>
          </div>
          <strong className="TxDetail_RowRight">{account}</strong>
        </div>

        <div className="TxDetail_Row">
          <div className="TxDetail_RowLeft">
            <FiTag className="TxDetail_RowIcon" />
            <span>Category</span>
          </div>
          <strong className="TxDetail_RowRight">{category} {label && label !== category ? `· ${label}` : ""}</strong>
        </div>

        <div className="TxDetail_Row">
          <div className="TxDetail_RowLeft">
            <FiRepeat className="TxDetail_RowIcon" />
            <span>Frequency</span>
          </div>
          <strong className="TxDetail_RowRight">{frequency}</strong>
        </div>

        <div className="TxDetail_Row">
          <div className="TxDetail_RowLeft">
            <FiCheckCircle className="TxDetail_RowIcon" />
            <span>Status</span>
          </div>
          <strong className="TxDetail_RowRight status-verified">Verified & Recorded</strong>
        </div>
      </div>

      {onEdit && (
        <button
          type="button"
          className="TxDetail_EditBtn"
          onClick={() => onEdit(transaction)}
        >
          Edit Transaction
        </button>
      )}
    </div>
  );

  return (
    <MoreOpen
      isClicked={Boolean(transaction)}
      setIsClicked={onClose}
      feed={feed}
      sheetHeight="56dvh"
      zIndex={125}
      overflow="hidden"
      showBackdrop={true}
    />
  );
};

export default TransactionDetailModal;
