import React, { useState, useEffect, useCallback } from "react";
import { FiCalendar, FiCreditCard, FiTag, FiRepeat, FiCheckCircle, FiCheck } from "react-icons/fi";
import { getTransactionIcon, CATEGORY_GROUPS } from "../Categories";
import { getTransactionDisplayReason } from "../../utils/transactionDisplay";
import { updateTransactionAPI } from "../../services/apiService";
import { useTransactions } from "../../context/TransactionContext";
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

const TransactionDetailModal = ({ transaction, onClose, onEdit = null, onTransactionUpdated = null }) => {
  const { monthData } = useTransactions();
  const [currentTx, setCurrentTx] = useState(transaction);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  useEffect(() => {
    setCurrentTx(transaction);
    setSaveStatus(null);
  }, [transaction]);

  const handleSelectReason = useCallback(async (newLabel) => {
    if (!currentTx?.id) return;
    
    const targetCategory = currentTx.Category || "Expense";
    const updatedTx = {
      ...currentTx,
      Category: targetCategory,
      Label: newLabel,
    };

    // Optimistic local update
    setCurrentTx(updatedTx);
    setIsSaving(true);
    setSaveStatus("saving");

    try {
      const res = await updateTransactionAPI(currentTx.id, {
        Category: targetCategory,
        Label: newLabel,
      });

      if (res && res.status !== "error") {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(null), 2000);
        monthData?.refetch?.();
        if (onTransactionUpdated) {
          onTransactionUpdated(updatedTx);
        }
      } else {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus(null), 2500);
      }
    } catch (_err) {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus(null), 2500);
    } finally {
      setIsSaving(false);
    }
  }, [currentTx, monthData, onTransactionUpdated]);

  if (!transaction || !currentTx) return null;

  const direction = getTxDirection(currentTx);
  const reason = getTransactionDisplayReason(currentTx.Reason, currentTx.Label);
  const category = currentTx.Category || "Expense";
  const label = currentTx.Label || category;
  const account = currentTx.Account || currentTx.BankName || currentTx.AccountName || "Personal Account";
  const frequency = currentTx.Frequency || (currentTx.Type === "Monthly" ? "Monthly Recurring" : "One-Time");

  const normalizedCategory = category === "Saving" || category === "Investment" ? "Save&Invest" : category;
  const subcategories = (CATEGORY_GROUPS[normalizedCategory] || []).map(([name]) => name);

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
          <span>{direction === "in" ? "+" : "−"}{money(currentTx)}</span>
        </div>
      </div>

      {/* Reason / Category Pills Section */}
      <div className="TxDetail_CategorySection">
        <div className="TxDetail_CategorySectionHeader">
          <span className="TxDetail_SectionTitle">
            <FiTag className="TxDetail_RowIcon" /> Reason
          </span>
          {saveStatus === "saving" && <span className="TxDetail_StatusText saving">Saving...</span>}
          {saveStatus === "saved" && (
            <span className="TxDetail_StatusText saved">
              <FiCheck style={{ marginRight: 3 }} /> Updated
            </span>
          )}
        </div>

        {/* Reason Pills */}
        <div className="TxDetail_ReasonPills">
          {subcategories.map((subName) => {
            const isSubActive = String(label).toLowerCase() === String(subName).toLowerCase();
            return (
              <button
                key={subName}
                type="button"
                className={`TxDetail_ReasonPill ${category.toLowerCase().replace(/[^a-z0-9]/g, '')} ${isSubActive ? "active" : ""}`}
                onClick={() => handleSelectReason(subName)}
                disabled={isSaving}
              >
                {isSubActive && <FiCheck className="TxDetail_PillCheck" />}
                <span>{subName}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="TxDetail_Card">
        <div className="TxDetail_Row">
          <div className="TxDetail_RowLeft">
            <FiCalendar className="TxDetail_RowIcon" />
            <span>Date & Time</span>
          </div>
          <strong className="TxDetail_RowRight">{formatFullDate(currentTx.Timestamp)}</strong>
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
          onClick={() => onEdit(currentTx)}
        >
          Edit Full Details
        </button>
      )}
    </div>
  );

  return (
    <MoreOpen
      isClicked={Boolean(transaction)}
      setIsClicked={onClose}
      feed={feed}
      sheetHeight="auto"
      zIndex={125}
      overflow="hidden"
      showBackdrop={true}
    />
  );
};

export default TransactionDetailModal;
