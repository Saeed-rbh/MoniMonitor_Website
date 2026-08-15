import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronRight, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import MoreOpen from "../../components/MoreOpen/MoreOpen";
import { getMonthlyAiBriefAPI } from "../../services/apiService";
import { useTransactions } from "../../context/TransactionContext";
import TransactionListItem from "../Transactions/TransactionListItem";
import "../Transactions/Transactions.css";

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

  const evidenceFeed = () => (
    <div
      className="TransactionList_Main"
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
      <div className="TransactionList_Wall" style={{ height: "100%", width: "100%", paddingTop: "25px" }}>
        <div className="TransactionList_TopLine"></div>
        <div className="TransactionList_Title" style={{ width: "100%", paddingRight: "60px", boxSizing: "border-box" }}>
          <p style={{ color: "var(--Bc-2)", cursor: "default" }}>
            <span>{selectedInsight?.title || "Supporting Data"}</span>
            <div className="TransactionList_TitleMonth">
              {new Date(`${targetMonth}-01T12:00:00`).toLocaleDateString("en-CA", { month: "short", year: "numeric" })}
            </div>
          </p>
          <h1>
            Total:{" "}
            <span style={{ color: "var(--Bc-2)" }}>
              ${(evidenceTotalMinor / 100).toFixed(2)}
            </span>
          </h1>
        </div>

        {selectedInsight?.fact && (
          <div style={{ width: "calc(100% - 10px)", margin: "-4px 0 14px", color: "var(--Ac-2)", fontSize: "0.74rem", lineHeight: "1.4", textAlign: "left", paddingLeft: "4px" }}>
            {selectedInsight.fact}
          </div>
        )}

        <div
          className="TransactionList_MonthlyMain"
          style={{ width: "100%", flex: 1, overflowY: "auto", minHeight: 0 }}
        >
          <div className="TransactionList_Monthly">
            {evidenceTransactions.map((transaction, index) => (
              <TransactionListItem
                key={transaction.id ?? `${transaction.Timestamp}-${index}`}
                index={index}
                icon={transaction.icon}
                description={transaction.Reason}
                type={transaction.Type}
                time={transaction.Timestamp}
                amount={transaction.Amount}
                category={transaction.Category}
                label={transaction.Label}
              />
            ))}
            {evidenceTransactions.length === 0 && (
              <div style={{ textAlign: "center", padding: "30px 20px", color: "var(--Ac-2)", fontSize: "0.85rem" }}>
                No supporting transactions found
              </div>
            )}
          </div>
        </div>
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
  if (!brief) return null;

  const healthy = brief.dataQuality.status === "healthy";
  return (
    <>
      <section className="MonthlyAiBrief">
        <header className="MonthlyAiBrief_Header">
          <div>
            <span className="MonthlyAiBrief_Eyebrow"><Sparkles aria-hidden="true" /> Monthly AI brief</span>
            <h2>{new Date(`${targetMonth}-01T12:00:00`).toLocaleDateString("en-CA", { month: "long", year: "numeric" })} Brief</h2>
            {isAutoAdjusted && (
              <span style={{ fontSize: "0.64rem", color: "var(--Ac-3)", marginTop: "2px", display: "block" }}>
                Completed month · Compared with prior months
              </span>
            )}
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
    </>
  );
};

export default MonthlyAiBrief;
