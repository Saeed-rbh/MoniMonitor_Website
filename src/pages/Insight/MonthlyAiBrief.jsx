import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronRight, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import MoreOpen from "../../components/MoreOpen/MoreOpen";
import { getMonthlyAiBriefAPI } from "../../services/apiService";
import { useTransactions } from "../../context/TransactionContext";
import { getTransactionIcon } from "../../components/Categories";
import { getTransactionDisplayReason } from "../../utils/transactionDisplay";
import TransactionDetailModal from "../../components/TransactionDetailModal/TransactionDetailModal";

const money = (minor) => new Intl.NumberFormat("en-CA", {
  style: "currency", currency: "CAD", maximumFractionDigits: 2,
}).format(Number(minor || 0) / 100);

const getEffectiveCompletedMonth = (monthStr) => {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return { targetMonth: monthStr, isAutoAdjusted: false };
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  const lastDayOfCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const isLastDay = now.getDate() === lastDayOfCurrentMonth;

  if (monthStr === currentMonthStr && !isLastDay) {
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    return { targetMonth: prevMonthStr, isAutoAdjusted: true };
  }

  return { targetMonth: monthStr, isAutoAdjusted: false };
};

const MonthlyAiBrief = ({ month, transactions = [], allTransactions = null }) => {
  const { isMoreClicked, setIsMoreClicked } = useTransactions();
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedInsight, setSelectedInsight] = useState(null);
  const [viewingTx, setViewingTx] = useState(null);
  const requestVersion = useRef(0);

  const { targetMonth, isAutoAdjusted } = useMemo(() => getEffectiveCompletedMonth(month), [month]);

  const handleOpenInsight = useCallback((insight) => {
    setSelectedInsight(insight);
    setIsMoreClicked(`AI_${insight.id}`);
  }, [setIsMoreClicked]);

  const handleCloseInsight = useCallback(() => {
    setSelectedInsight(null);
    setIsMoreClicked(null);
  }, [setIsMoreClicked]);

  const load = useCallback(async (refresh = false) => {
    const version = ++requestVersion.current;
    refresh ? setRefreshing(true) : setLoading(true);
    const result = await getMonthlyAiBriefAPI(targetMonth, refresh);
    if (version !== requestVersion.current) return;
    if (result) setBrief(result);
    setLoading(false);
    setRefreshing(false);
  }, [targetMonth]);

  useEffect(() => {
    setBrief(null);
    handleCloseInsight();
    load(false);
    return () => {
      requestVersion.current += 1;
      setIsMoreClicked(null);
    };
  }, [load, handleCloseInsight, setIsMoreClicked]);

  const allTxList = useMemo(() => {
    if (!allTransactions) return transactions || [];
    let list = [];
    Object.values(allTransactions).forEach((monthData) => {
      if (Array.isArray(monthData?.transactions)) {
        list = list.concat(monthData.transactions);
      }
    });
    return list.length > 0 ? list : (transactions || []);
  }, [allTransactions, transactions]);

  const transactionMap = useMemo(
    () => new Map(allTxList.map((transaction) => [String(transaction.id), transaction])),
    [allTxList]
  );
  const evidenceTransactions = useMemo(() => {
    if (!selectedInsight || !selectedInsight.evidence?.transactionIds) return [];
    return selectedInsight.evidence.transactionIds
      .map((id) => transactionMap.get(String(id)))
      .filter(Boolean)
      .sort((left, right) => new Date(right.Timestamp) - new Date(left.Timestamp));
  }, [selectedInsight, transactionMap]);

  const evidenceTotalMinor = useMemo(() => {
    return evidenceTransactions.reduce((sum, tx) => {
      const amt = Number.isFinite(Number(tx?.AmountMinor))
        ? Number(tx.AmountMinor)
        : Math.round(Number(tx?.Amount || 0) * 100);
      return sum + amt;
    }, 0);
  }, [evidenceTransactions]);

  const formatTxDate = (timestamp) => {
    if (!timestamp) return "Date unrecorded";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Unknown date";
    return date.toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getTxDirection = (tx) => {
    const flow = String(tx?.AccountFlow || "").toUpperCase();
    if (flow === "IN") return "in";
    if (flow === "OUT") return "out";
    return tx?.Category === "Income" ? "in" : "out";
  };

  const evidenceFeed = () => (
    <div className="AiEvidence_Sheet">
      <header className="AiEvidence_Header">
        <span className="AiEvidence_Eyebrow">
          <Sparkles aria-hidden="true" />
          Supporting transactions · {new Date(`${targetMonth}-01T12:00:00`).toLocaleDateString("en-CA", { month: "long", year: "numeric" })}
        </span>
        <h2 className="AiEvidence_Title">{selectedInsight?.title}</h2>
        <p className="AiEvidence_Fact">{selectedInsight?.fact}</p>
      </header>

      <div className="AiEvidence_StatsBar">
        <div className="AiEvidence_StatCard">
          <span>Supporting total</span>
          <strong>{money(evidenceTotalMinor)}</strong>
        </div>
        <div className="AiEvidence_StatCard">
          <span>Verified records</span>
          <strong>{evidenceTransactions.length} transaction{evidenceTransactions.length === 1 ? "" : "s"}</strong>
        </div>
      </div>

      <div className="AiEvidence_List">
        {evidenceTransactions.map((transaction, index) => {
          const direction = getTxDirection(transaction);
          const reason = getTransactionDisplayReason(transaction.Reason, transaction.Label);
          const txAmtMinor = Number.isFinite(Number(transaction.AmountMinor))
            ? Number(transaction.AmountMinor)
            : Math.round(Number(transaction.Amount || 0) * 100);

          return (
            <article
              className="AiEvidence_Card"
              key={transaction.id ?? `${transaction.Timestamp}-${index}`}
              onClick={() => setViewingTx(transaction)}
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
            >
              <div className="AiEvidence_Left">
                <div className="AiEvidence_Icon" aria-hidden="true">
                  {getTransactionIcon(transaction.Category, transaction.Label)}
                </div>
                <div className="AiEvidence_Copy">
                  <strong className="AiEvidence_Reason">{reason || "Transaction"}</strong>
                  <span className="AiEvidence_Meta">
                    {[
                      formatTxDate(transaction.Timestamp),
                      transaction.Account || transaction.BankName,
                      transaction.Label || transaction.Category,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </div>
              <div className="AiEvidence_Right">
                <strong className={`AiEvidence_Amount ${direction}`}>
                  {direction === "in" ? "+" : "−"}{money(txAmtMinor)}
                </strong>
                <span className="AiEvidence_Tag">{transaction.Category || "Expense"}</span>
              </div>
            </article>
          );
        })}

        {evidenceTransactions.length === 0 && (
          <div className="AiEvidence_Empty">
            No supporting transactions found in ledger for this timeframe.
          </div>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <section className="MonthlyAiBrief MonthlyAiBrief_Loading" aria-label="Loading monthly AI brief" aria-live="polite">
        <div className="ai-skeleton-header">
          <Sparkles className="MonthlyAiBrief_Spark" aria-hidden="true" />
          <div className="ai-skeleton-line short" />
        </div>
        <div className="ai-skeleton-block">
          <div className="ai-skeleton-line medium" />
          <div className="ai-skeleton-line long" />
          <div className="ai-skeleton-line full" />
        </div>
        <div className="ai-skeleton-block">
          <div className="ai-skeleton-line short" />
          <div className="ai-skeleton-line long" />
          <div className="ai-skeleton-line full" />
        </div>
      </section>
    );
  }

  if (!brief || !brief.insights || brief.insights.length === 0) {
    return null;
  }

  const healthy = brief.dataQuality.status === "healthy";

  return (
    <>
      <section className="MonthlyAiBrief" aria-label="Monthly financial intelligence brief">
        <header className="MonthlyAiBrief_Header">
          <div>
            <span className="MonthlyAiBrief_Eyebrow">
              <Sparkles aria-hidden="true" />
              MONTHLY AI INTELLIGENCE BRIEF
            </span>
            <h2>
              {new Date(`${targetMonth}-01T12:00:00`).toLocaleDateString("en-CA", { month: "long", year: "numeric" })} Brief
              {isAutoAdjusted ? " · Completed month" : ""}
            </h2>
          </div>
          <button type="button" onClick={() => load(true)} disabled={refreshing} aria-label="Refresh monthly AI brief">
            <RefreshCw className={refreshing ? "is-spinning" : ""} aria-hidden="true" />
          </button>
        </header>

        <div className={`MonthlyAiBrief_Quality ${healthy ? "healthy" : "review"}`}>
          {healthy ? <ShieldCheck aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
          <div>
            <strong>{healthy ? "Verified data" : "Data review needed"}</strong>
            <span>{healthy
              ? `${brief.summary.transactionCount} transactions checked · ${brief.source === "ai-synthesized" ? "AI synthesized" : brief.source === "ai-ranked" ? "AI prioritized" : "safe ranking"}`
              : brief.dataQuality.issues.join(" · ")}
            </span>
          </div>
        </div>

        <div className="MonthlyAiBrief_List">
          {brief.insights.map((insight, index) => (
            <article key={insight.id} className="MonthlyAiBrief_Item" style={{ animationDelay: `${index * 80}ms` }}>
              <div className="MonthlyAiBrief_Number">{String(index + 1).padStart(2, "0")}</div>
              <div className="MonthlyAiBrief_Copy">
                <div className="MonthlyAiBrief_TitleRow">
                  <h3>{insight.title}</h3>
                  <span>{insight.confidence}</span>
                </div>
                <p>{insight.fact}</p>
                <div className="MonthlyAiBrief_Action"><strong>Try</strong> {insight.action}</div>
                {insight.evidence.count > 0 && (
                  <button type="button" onClick={() => handleOpenInsight(insight)}>
                    View {insight.evidence.count} supporting transaction{insight.evidence.count === 1 ? "" : "s"}
                    <ChevronRight aria-hidden="true" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        <footer>Amounts are calculated by MoniMonitor. AI only prioritizes verified observations and suggested actions.</footer>
      </section>

      <MoreOpen
        isClicked={selectedInsight}
        setIsClicked={handleCloseInsight}
        feed={evidenceFeed}
        MoreOpenHeight={75}
        overflow="hidden"
      />

      <TransactionDetailModal
        transaction={viewingTx}
        onClose={() => setViewingTx(null)}
      />
    </>
  );
};

export default MonthlyAiBrief;
