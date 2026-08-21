import React, { useState, useEffect, useCallback } from "react";
import { FiCalendar, FiCreditCard, FiTag, FiRepeat, FiCheckCircle, FiCheck, FiRefreshCw } from "react-icons/fi";
import { getTransactionIcon, CATEGORY_GROUPS, getCategoryForLabel } from "../Categories";
import { getTransactionDisplayReason } from "../../utils/transactionDisplay";
import { updateTransactionAPI } from "../../services/apiService";
import {
  isDateOnlyTransactionTimestamp,
  parseTransactionDate,
} from "../../utils/transactionDate";
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
  const date = parseTransactionDate(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    ...(isDateOnlyTransactionTimestamp(timestamp)
      ? {}
      : { hour: "numeric", minute: "2-digit" }),
  });
};

const GROUP_TABS = ["Expense", "Income", "Save&Invest", "Internal"];

const TransactionDetailModal = ({ transaction, onClose, onEdit = null, onTransactionUpdated = null }) => {
  const { monthData } = useTransactions();
  const [currentTx, setCurrentTx] = useState(transaction);
  const [selectedCategory, setSelectedCategory] = useState(transaction?.Category || "Expense");
  const [selectedLabel, setSelectedLabel] = useState(transaction?.Label || transaction?.Category || "");
  const [activeGroupTab, setActiveGroupTab] = useState("Expense");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  useEffect(() => {
    setCurrentTx(transaction);
    const cat = transaction?.Category || "Expense";
    const normalized = cat === "Saving" || cat === "Investment" ? "Save&Invest" : cat;
    setSelectedCategory(cat);
    setSelectedLabel(transaction?.Label || transaction?.Category || "");
    setActiveGroupTab(normalized);
    setSaveStatus(null);
  }, [transaction]);

  const hasChanges = Boolean(
    (selectedLabel && selectedLabel !== (currentTx?.Label || currentTx?.Category)) ||
    (selectedCategory && selectedCategory !== currentTx?.Category)
  );

  const isInternal = currentTx?.Category === "Internal" || currentTx?.Label === "Internal Transfer";

  const handleMarkInternalTransfer = useCallback(async () => {
    if (!currentTx?.id || isSaving) return;

    const direction = getTxDirection(currentTx);
    const sourceOrDest = currentTx.Account || currentTx.BankName || "Personal Account";
    const newReason = direction === "out"
      ? `Internal transfer: ${sourceOrDest} -> Temporary`
      : `Internal transfer: Temporary -> ${sourceOrDest}`;

    const updates = {
      Category: "Internal",
      Label: "Internal Transfer",
      Reason: newReason,
      Account: currentTx.Account || "Temporary",
    };

    setIsSaving(true);
    setSaveStatus("saving");

    try {
      const res = await updateTransactionAPI(currentTx.id, updates);
      if (res && res.status !== "error") {
        const updatedTx = res.data || { ...currentTx, ...updates };
        setCurrentTx(updatedTx);
        setSelectedCategory("Internal");
        setSelectedLabel("Internal Transfer");
        setActiveGroupTab("Internal");
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
  }, [currentTx, isSaving, monthData, onTransactionUpdated]);

  const handleReverseInternalTransfer = useCallback(async () => {
    if (!currentTx?.id || isSaving) return;

    const direction = getTxDirection(currentTx);
    const updates = {
      Category: direction === "in" ? "Income" : "Expense",
      Label: direction === "in" ? "Personal Transfers Received" : "Personal Transfers",
    };

    setIsSaving(true);
    setSaveStatus("saving");

    try {
      const res = await updateTransactionAPI(currentTx.id, updates);
      if (res && res.status !== "error") {
        const updatedTx = res.data || { ...currentTx, ...updates };
        setCurrentTx(updatedTx);
        setSelectedCategory(updates.Category);
        setSelectedLabel(updates.Label);
        setActiveGroupTab(updates.Category);
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
  }, [currentTx, isSaving, monthData, onTransactionUpdated]);

  const handleSaveReason = useCallback(async () => {
    if (!currentTx?.id || !selectedLabel) return;
    
    let targetCategory = selectedCategory;
    if (!targetCategory || targetCategory === "Save&Invest") {
      targetCategory = getCategoryForLabel(selectedLabel, currentTx.Category || "Expense");
    }

    let newReason = currentTx.Reason;
    let newAccount = currentTx.Account;
    if (targetCategory === "Internal" || selectedLabel === "Internal Transfer") {
      targetCategory = "Internal";
      const direction = getTxDirection(currentTx);
      const sourceOrDest = currentTx.Account || currentTx.BankName || "Personal Account";
      newReason = direction === "out"
        ? `Internal transfer: ${sourceOrDest} -> Temporary`
        : `Internal transfer: Temporary -> ${sourceOrDest}`;
      newAccount = currentTx.Account || "Temporary";
    }

    const updates = {
      Category: targetCategory,
      Label: selectedLabel,
      ...(targetCategory === "Internal" ? { Reason: newReason, Account: newAccount } : {}),
    };

    setIsSaving(true);
    setSaveStatus("saving");

    try {
      const res = await updateTransactionAPI(currentTx.id, updates);

      if (res && res.status !== "error") {
        const updatedTx = res.data || { ...currentTx, ...updates };
        setCurrentTx(updatedTx);
        setSelectedCategory(targetCategory);
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
  }, [currentTx, selectedLabel, selectedCategory, monthData, onTransactionUpdated]);

  if (!transaction || !currentTx) return null;

  const direction = getTxDirection(currentTx);
  const reason = getTransactionDisplayReason(currentTx.Reason, selectedLabel || currentTx.Label);
  const category = currentTx.Category || "Expense";
  const displayLabel = selectedLabel || currentTx.Label || category;
  const account = currentTx.Account || currentTx.BankName || currentTx.AccountName || "Personal Account";
  const frequency = currentTx.Frequency || (currentTx.Type === "Monthly" ? "Monthly Recurring" : "One-Time");

  const subcategories = (CATEGORY_GROUPS[activeGroupTab] || []).map(([name]) => name);

  const feed = () => (
    <div className="TxDetail_Sheet">
      <div className="TxDetail_Header">
        <div className={`TxDetail_IconBox ${direction} ${category.toLowerCase().replace(/[^a-z0-9]/g, '')}`}>
          {getTransactionIcon(category, displayLabel)}
        </div>
        <div className="TxDetail_BadgeRow">
          <span className={`TxDetail_CategoryBadge ${category.toLowerCase().replace(/[^a-z0-9]/g, '')}`}>{category}</span>
          {displayLabel && displayLabel !== category && (
            <span className="TxDetail_LabelBadge">{displayLabel}</span>
          )}
        </div>
        <h2 className="TxDetail_Reason">{reason || "Transaction"}</h2>
        <div className={`TxDetail_Amount ${direction}`}>
          <span>{direction === "in" ? "+" : "−"}{money(currentTx)}</span>
        </div>
      </div>

      <div className="TxDetail_QuickActions">
        <button
          type="button"
          className={`TxDetail_TransferActionBtn ${isInternal ? "active" : ""}`}
          onClick={isInternal ? handleReverseInternalTransfer : handleMarkInternalTransfer}
          disabled={isSaving}
        >
          <FiRefreshCw className={`TxDetail_ActionBtnIcon ${isSaving ? "spinning" : ""}`} />
          <span>{isInternal ? "↩ Reverse Internal Transfer" : "🔄 Mark as Internal Transfer"}</span>
        </button>
      </div>

      <div className="TxDetail_CategorySection">
        <div className="TxDetail_CategorySectionHeader">
          <span className="TxDetail_SectionTitle">
            <FiTag className="TxDetail_RowIcon" /> Recategorize
          </span>
          {hasChanges && (
            <button
              type="button"
              className="TxDetail_SavePillBtn"
              onClick={handleSaveReason}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : saveStatus === "saved" ? "✓ Saved" : "Save"}
            </button>
          )}
          {!hasChanges && saveStatus === "saved" && (
            <span className="TxDetail_StatusText saved">
              <FiCheck style={{ marginRight: 3 }} /> Saved
            </span>
          )}
        </div>

        <div className="TxDetail_GroupTabs">
          {GROUP_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`TxDetail_GroupTab ${activeGroupTab === tab ? "active" : ""} ${tab.toLowerCase().replace(/[^a-z0-9]/g, '')}`}
              onClick={() => setActiveGroupTab(tab)}
              disabled={isSaving}
            >
              {tab === "Save&Invest" ? "Save & Invest" : tab}
            </button>
          ))}
        </div>

        <div className="TxDetail_ReasonPills">
          {subcategories.map((subName) => {
            const isSubActive = String(selectedLabel).toLowerCase() === String(subName).toLowerCase();
            return (
              <button
                key={subName}
                type="button"
                className={`TxDetail_ReasonPill ${activeGroupTab.toLowerCase().replace(/[^a-z0-9]/g, '')} ${isSubActive ? "active" : ""}`}
                onClick={() => {
                  setSelectedLabel(subName);
                  setSelectedCategory(activeGroupTab === "Save&Invest" ? getCategoryForLabel(subName, "Saving") : activeGroupTab);
                  setSaveStatus(null);
                }}
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
