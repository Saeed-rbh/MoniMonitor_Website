import React, { useMemo, useCallback } from "react";
import TransactionListItem from "./TransactionListItem";
import { parseTransactionDate } from "../../utils/transactionDate";

/**
 * Groups transactions into intuitive, chronological timeline sections:
 * - Today
 * - Yesterday
 * - This Week (e.g. This Week · Aug 10–16)
 * - Week ranges in the active month (e.g. Week · Aug 3–9, Week · Aug 1–2)
 * - Historical Months (e.g. July 2026, June 2026)
 */
export const groupTransactionsByTimeline = (transactions = []) => {
  if (!transactions || transactions.length === 0) return [];

  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth();
  const todayDate = now.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(todayDate - 1);
  const yYear = yesterday.getFullYear();
  const yMonth = yesterday.getMonth();
  const yDate = yesterday.getDate();

  // Current week's Monday & Sunday (Monday = 1, Sunday = 0 -> 7)
  const day = now.getDay();
  const diff = todayDate - day + (day === 0 ? -6 : 1);
  const curMonday = new Date(now);
  curMonday.setDate(diff);
  curMonday.setHours(0, 0, 0, 0);
  const curSunday = new Date(curMonday);
  curSunday.setDate(curMonday.getDate() + 6);
  curSunday.setHours(23, 59, 59, 999);

  const sectionsMap = new Map();

  transactions.forEach((tx) => {
    if (!tx || !tx.Timestamp) return;
    const date = parseTransactionDate(tx.Timestamp);
    if (Number.isNaN(date.getTime())) return;

    const txYear = date.getFullYear();
    const txMonth = date.getMonth();
    const txDay = date.getDate();

    let sectionKey = "";
    let sectionTitle = "";
    let sectionPriority = 0;
    let sortRank = 0;

    // 1. Is Today?
    if (txYear === todayYear && txMonth === todayMonth && txDay === todayDate) {
      sectionKey = "timeline_today";
      sectionTitle = "Today";
      sectionPriority = 4;
      sortRank = new Date(todayYear, todayMonth, todayDate, 23, 59, 59, 999).getTime();
    }
    // 2. Is Yesterday?
    else if (txYear === yYear && txMonth === yMonth && txDay === yDate) {
      sectionKey = "timeline_yesterday";
      sectionTitle = "Yesterday";
      sectionPriority = 3;
      sortRank = new Date(yYear, yMonth, yDate, 23, 59, 59, 999).getTime();
    }
    // 3. Is This Week?
    else if (date >= curMonday && date <= curSunday) {
      const startMon = curMonday.toLocaleString("en-US", { month: "short" });
      const endMon = curSunday.toLocaleString("en-US", { month: "short" });
      const weekLabel =
        startMon === endMon
          ? `${startMon} ${curMonday.getDate()}–${curSunday.getDate()}`
          : `${startMon} ${curMonday.getDate()} – ${endMon} ${curSunday.getDate()}`;
      sectionKey = "timeline_this_week";
      sectionTitle = `This Week · ${weekLabel}`;
      sectionPriority = 2;
      sortRank = curSunday.getTime();
    }
    // 4. Same month or past month:
    else {
      const txDayOfWeek = date.getDay();
      const txDiff = txDay - txDayOfWeek + (txDayOfWeek === 0 ? -6 : 1);
      const monday = new Date(date);
      monday.setDate(txDiff);
      monday.setHours(0, 0, 0, 0);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);

      if (txYear === todayYear && txMonth === todayMonth) {
        const startMon = monday.toLocaleString("en-US", { month: "short" });
        const endMon = sunday.toLocaleString("en-US", { month: "short" });
        const startDay = monday.getDate();
        const endDay = sunday.getDate();

        const weekLabel =
          startMon === endMon
            ? `${startMon} ${startDay}–${endDay}`
            : `${startMon} ${startDay} – ${endMon} ${endDay}`;

        sectionKey = `week_${monday.toISOString().slice(0, 10)}`;
        sectionTitle = `Week · ${weekLabel}`;
        sectionPriority = 1;
        sortRank = sunday.getTime();
      } else {
        const monthName = date.toLocaleString("en-US", {
          month: "long",
          year: "numeric",
        });
        sectionKey = `month_${txYear}_${String(txMonth + 1).padStart(2, "0")}`;
        sectionTitle = monthName;
        sectionPriority = 1;
        sortRank = new Date(txYear, txMonth + 1, 0, 23, 59, 59, 999).getTime();
      }
    }

    if (!sectionsMap.has(sectionKey)) {
      sectionsMap.set(sectionKey, {
        key: sectionKey,
        title: sectionTitle,
        sectionPriority,
        sortRank,
        items: [],
      });
    }

    sectionsMap.get(sectionKey).items.push(tx);
  });

  return Array.from(sectionsMap.values()).sort(
    (a, b) => b.sectionPriority - a.sectionPriority || b.sortRank - a.sortRank
  );
};

const TransactionListMonthly = ({
  MainIndex,
  swipedIndex,
  handleUnSwipe,
  handleSwipe,
  handleTransactionClick,
  transactions,
  isAddClicked,
  setOpen,
  setShowTransaction,
  totalTransactionCount = null,
}) => {
  const filteredTransactions = useMemo(() => transactions || [], [transactions]);
  const transactionCount = totalTransactionCount ?? filteredTransactions.length;

  const sections = useMemo(
    () => groupTransactionsByTimeline(filteredTransactions),
    [filteredTransactions]
  );

  const memoizedHandleSwipe = useCallback(
    (index) => handleSwipe(MainIndex, index),
    [MainIndex, handleSwipe]
  );

  const memoizedHandleUnSwipe = useCallback(handleUnSwipe, [handleUnSwipe]);

  const memoizedHandleTransactionClick = useCallback(
    (transaction) => handleTransactionClick(transaction),
    [handleTransactionClick]
  );

  let globalIndex = 0;

  return (
    <div className="TransactionList_Monthly">
      {sections.map((section) => (
        <div key={section.key} className="TransactionList_TimelineSection">
          <div className="TransactionList_TimelineHeader">
            <span className="TransactionList_TimelineTitle">{section.title}</span>
            <span className="TransactionList_TimelineCount">
              {transactionCount} {transactionCount === 1 ? "transaction" : "transactions"}
            </span>
          </div>
          <ul className="TransactionList_TransactionList">
            {section.items.map((transaction) => {
              const currentIndex = globalIndex++;
              return (
                <TransactionListItem
                  key={transaction.id ?? `${transaction.Timestamp}-${currentIndex}`}
                  index={currentIndex}
                  icon={transaction.icon}
                  description={transaction.Reason}
                  type={transaction.Type}
                  time={transaction.Timestamp}
                  amount={transaction.Amount}
                  category={transaction.Category}
                  label={transaction.Label}
                  isSwiped={
                    swipedIndex &&
                    swipedIndex[1] === currentIndex &&
                    swipedIndex[0] === MainIndex
                  }
                  onSwipe={() => memoizedHandleSwipe(currentIndex)}
                  onUnSwipe={memoizedHandleUnSwipe}
                  onClick={() => memoizedHandleTransactionClick(transaction)}
                  isAddClicked={isAddClicked}
                  setOpen={setOpen}
                  setShowTransaction={setShowTransaction}
                />
              );
            })}
          </ul>
        </div>
      ))}
      {filteredTransactions.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "30px 20px",
            color: "var(--Ac-3)",
            fontSize: "0.82rem",
          }}
        >
          No transactions found
        </div>
      )}
    </div>
  );
};

export default TransactionListMonthly;

