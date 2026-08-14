import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronRight, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import MoreOpen from "../../components/MoreOpen/MoreOpen";
import { getTransactionIcon } from "../../components/Categories";
import { getMonthlyAiBriefAPI } from "../../services/apiService";
import { getTransactionDisplayReason } from "../../utils/transactionDisplay";

const money = (minor) => new Intl.NumberFormat("en-CA", {
  style: "currency", currency: "CAD", maximumFractionDigits: 2,
}).format(Number(minor || 0) / 100);

const transactionDirection = (transaction) => {
  const flow = String(transaction?.AccountFlow || "").toUpperCase();
  if (flow === "IN") return "in";
  if (flow === "OUT") return "out";
  return transaction?.Category === "Income" ? "in" : "out";
};

const MonthlyAiBrief = ({ month, transactions = [] }) => {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedInsight, setSelectedInsight] = useState(null);
  const requestVersion = useRef(0);

  const load = useCallback(async (refresh = false) => {
    const version = ++requestVersion.current;
    refresh ? setRefreshing(true) : setLoading(true);
    const result = await getMonthlyAiBriefAPI(month, refresh);
    if (version !== requestVersion.current) return;
    if (result) setBrief(result);
    setLoading(false);
    setRefreshing(false);
  }, [month]);

  useEffect(() => {
    setBrief(null);
    setSelectedInsight(null);
    load(false);
    return () => { requestVersion.current += 1; };
  }, [load]);

  const transactionMap = useMemo(
    () => new Map(transactions.map((transaction) => [String(transaction.id), transaction])),
    [transactions]
  );
  const evidenceTransactions = useMemo(() => {
    if (!selectedInsight) return [];
    return selectedInsight.evidence.transactionIds
      .map((id) => transactionMap.get(String(id)))
      .filter(Boolean)
      .sort((left, right) => new Date(right.Timestamp) - new Date(left.Timestamp));
  }, [selectedInsight, transactionMap]);

  const evidenceFeed = () => (
    <main className="MonthlyAiBrief_EvidenceSheet">
      <header>
        <span>Supporting data</span>
        <h1>{selectedInsight?.title}</h1>
        <p>{selectedInsight?.fact}</p>
      </header>
      <div className="MonthlyAiBrief_EvidenceList">
        {evidenceTransactions.map((transaction) => {
          const direction = transactionDirection(transaction);
          return (
            <article key={transaction.id} className="MonthlyAiBrief_EvidenceRow">
              <div className="MonthlyAiBrief_EvidenceIcon">
                {getTransactionIcon(transaction.Category, transaction.Label)}
              </div>
              <div className="MonthlyAiBrief_EvidenceCopy">
                <strong>{getTransactionDisplayReason(transaction.Reason, transaction.Label)}</strong>
                <span>{[transaction.Label, transaction.Account, new Date(transaction.Timestamp).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })].filter(Boolean).join(" · ")}</span>
              </div>
              <strong className={`MonthlyAiBrief_EvidenceAmount ${direction}`}>
                {direction === "in" ? "+" : "−"}{money(transaction.AmountMinor ?? Math.round(Number(transaction.Amount || 0) * 100))}
              </strong>
            </article>
          );
        })}
        {!evidenceTransactions.length && (
          <p className="MonthlyAiBrief_EmptyEvidence">No transaction rows are needed for this observation.</p>
        )}
      </div>
    </main>
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
            <h2>{new Date(`${month}-01T12:00:00`).toLocaleDateString("en-CA", { month: "long", year: "numeric" })}</h2>
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
              ? `${brief.summary.transactionCount} transactions checked · ${brief.source === "ai-ranked" ? "AI prioritized" : "safe ranking"}`
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
                  <button type="button" onClick={() => setSelectedInsight(insight)}>
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
        setIsClicked={setSelectedInsight}
        feed={evidenceFeed}
        MoreOpenHeight={75}
        overflow="auto"
      />
    </>
  );
};

export default MonthlyAiBrief;
