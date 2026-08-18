import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Lightbulb,
  Zap,
} from "lucide-react";
import MoreOpen from "../../components/MoreOpen/MoreOpen";
import { getMonthlyAiBriefAPI } from "../../services/apiService";
import { useTransactions } from "../../context/TransactionContext";
import { getTransactionIcon } from "../../components/Categories";
import { getTransactionDisplayReason } from "../../utils/transactionDisplay";
import TransactionDetailModal from "../../components/TransactionDetailModal/TransactionDetailModal";

const money = (minor) => new Intl.NumberFormat("en-CA", {
  style: "currency", currency: "CAD", maximumFractionDigits: 2,
}).format(Number(minor || 0) / 100);

const getInsightTheme = (insight, index) => {
  const title = (insight?.title || "").toLowerCase();
  const id = (insight?.id || "").toLowerCase();

  if (title.includes("fun fact") || id.includes("fun") || id.includes("fact") || title.includes("rhythm") || title.includes("density") || title.includes("ratio") || title.includes("weekend")) {
    return {
      type: "discovery",
      label: "Discovery",
      icon: <Lightbulb size={12} strokeWidth={2.4} />,
      accentClass: "is-amber",
    };
  }

  if (title.includes("increase") || title.includes("surge") || title.includes("rise") || title.includes("spike") || index === 0) {
    return {
      type: "shift-up",
      label: "Spending Shift",
      icon: <TrendingUp size={12} strokeWidth={2.4} />,
      accentClass: "is-coral",
    };
  }

  if (title.includes("decrease") || title.includes("drop") || title.includes("cut") || title.includes("win") || title.includes("saved") || index === 1) {
    return {
      type: "shift-down",
      label: "Spending Drop",
      icon: <TrendingDown size={12} strokeWidth={2.4} />,
      accentClass: "is-mint",
    };
  }

  return {
    type: "insight",
    label: "Key Takeaway",
    icon: <Sparkles size={12} strokeWidth={2.4} />,
    accentClass: "is-purple",
  };
};

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

const transactionDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
};

const clientBriefCache = new Map();

const MonthlyAiBrief = ({ month, transactions = [], allTransactions = null }) => {
  const { isMoreClicked, setIsMoreClicked } = useTransactions();
  const { targetMonth, isAutoAdjusted } = useMemo(() => getEffectiveCompletedMonth(month), [month]);

  const [brief, setBrief] = useState(() => {
    if (clientBriefCache.has(targetMonth)) {
      return clientBriefCache.get(targetMonth);
    }
    try {
      const stored = sessionStorage.getItem(`moni_brief_${targetMonth}`);
      if (stored) return JSON.parse(stored);
    } catch (_e) {}
    return null;
  });

  const [loading, setLoading] = useState(() => !clientBriefCache.has(targetMonth));
  const [refreshing, setRefreshing] = useState(false);
  const [selectedInsight, setSelectedInsight] = useState(null);
  const [viewingTx, setViewingTx] = useState(null);
  const requestVersion = useRef(0);

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
    const hasCached = clientBriefCache.has(targetMonth);

    if (refresh) {
      setRefreshing(true);
    } else if (!hasCached) {
      setLoading(true);
    }

    const result = await getMonthlyAiBriefAPI(targetMonth, refresh);
    if (version !== requestVersion.current) return;

    if (result) {
      clientBriefCache.set(targetMonth, result);
      try {
        sessionStorage.setItem(`moni_brief_${targetMonth}`, JSON.stringify(result));
      } catch (_e) {}
      setBrief(result);
    }

    setLoading(false);
    setRefreshing(false);
  }, [targetMonth]);

  useEffect(() => {
    // Check cache first for instant display
    if (clientBriefCache.has(targetMonth)) {
      setBrief(clientBriefCache.get(targetMonth));
      setLoading(false);
    } else {
      try {
        const stored = sessionStorage.getItem(`moni_brief_${targetMonth}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          clientBriefCache.set(targetMonth, parsed);
          setBrief(parsed);
          setLoading(false);
        } else {
          setBrief(null);
          setLoading(true);
        }
      } catch (_e) {
        setBrief(null);
        setLoading(true);
      }
    }

    handleCloseInsight();
    load(false);
    return () => {
      requestVersion.current += 1;
      setIsMoreClicked(null);
    };
  }, [targetMonth, load, handleCloseInsight, setIsMoreClicked]);

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

  const reviewTransactions = useMemo(() => {
    const currentMonthTxs = allTxList.filter(
      (t) => String(t.Timestamp || '').slice(0, 7) === targetMonth
    );
    return currentMonthTxs.filter((t) => {
      const label = String(t.Label || '').trim().toLowerCase();
      const isExpenseOrIncome = t.Category === 'Expense' || t.Category === 'Income' || t.Type === 'Expense' || t.Type === 'Debit' || t.Type === 'Income' || t.Type === 'Credit';
      if (!isExpenseOrIncome) return false;
      return ['other expense', 'other income', 'other', 'expense', 'income', ''].includes(label);
    }).sort((left, right) => new Date(right.Timestamp) - new Date(left.Timestamp));
  }, [allTxList, targetMonth]);

  const handleOpenReview = useCallback(() => {
    if (reviewTransactions.length === 0) return;
    const count = reviewTransactions.length;
    const insight = {
      id: 'data-review',
      title: 'Data Review Needed',
      fact: `${count} broadly categorized transaction${count === 1 ? '' : 's'} found in ${new Date(`${targetMonth}-01T12:00:00`).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}. Tap any transaction below to assign a specific category.`,
      evidence: {
        transactionIds: reviewTransactions.map((t) => t.id).filter(Boolean),
        count,
      },
    };
    setSelectedInsight(insight);
    setIsMoreClicked('AI_data-review');
  }, [reviewTransactions, targetMonth, setIsMoreClicked]);

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
              className="AccountTransactions_Row"
              key={transaction.id ?? `${transaction.Timestamp}-${index}`}
              onClick={() => setViewingTx(transaction)}
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
            >
              <div className="AccountTransactions_Icon" aria-hidden="true">
                {getTransactionIcon(transaction.Category, transaction.Label)}
              </div>
              <div className="AccountTransactions_Reason">
                <strong>{reason || "Transaction"}</strong>
                <span>{transactionDate(transaction.Timestamp)}</span>
              </div>
              <div className={`AccountTransactions_Amount ${direction}`}>
                <strong>{direction === "in" ? "+" : "−"}{money(txAmtMinor)}</strong>
                <span>{direction === "in" ? "in" : "out"}</span>
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

        <div
          className={`MonthlyAiBrief_Quality ${healthy ? "healthy" : "review"} ${!healthy && reviewTransactions.length > 0 ? "is-clickable" : ""}`}
          onClick={!healthy && reviewTransactions.length > 0 ? handleOpenReview : undefined}
          role={!healthy && reviewTransactions.length > 0 ? "button" : undefined}
          tabIndex={!healthy && reviewTransactions.length > 0 ? 0 : undefined}
        >
          <div className="MonthlyAiBrief_QualityLeft">
            {healthy ? <ShieldCheck aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
            <div>
              <strong>{healthy ? "Verified data" : "Data review needed"}</strong>
              <span>{healthy
                ? `${brief.summary.transactionCount} transactions checked · ${brief.source === "ai-synthesized" ? "AI synthesized" : brief.source === "ai-ranked" ? "AI prioritized" : "safe ranking"}`
                : brief.dataQuality.issues.join(" · ")}
              </span>
            </div>
          </div>
          {!healthy && reviewTransactions.length > 0 && (
            <div className="MonthlyAiBrief_QualityAction">
              <span>Categorize ({reviewTransactions.length})</span>
              <ChevronRight size={13} aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="MonthlyAiBrief_Grid">
          {brief.insights.map((insight, index) => {
            const theme = getInsightTheme(insight, index);
            const cleanTitle = (insight.title || "").replace(/^fun fact:\s*/i, "");
            const hasEvidence = insight.evidence?.count > 0;

            return (
              <article
                key={insight.id || index}
                className={`MonthlyAiBrief_Card ${theme.accentClass} ${hasEvidence ? "is-clickable" : ""}`}
                style={{ animationDelay: `${index * 90}ms` }}
                onClick={hasEvidence ? () => handleOpenInsight(insight) : undefined}
                role={hasEvidence ? "button" : undefined}
                tabIndex={hasEvidence ? 0 : undefined}
              >
                {/* Header Badge Row */}
                <div className="MonthlyAiCard_Header">
                  <div className="MonthlyAiCard_Badge">
                    {theme.icon}
                    <span>{theme.label}</span>
                  </div>
                  {hasEvidence && (
                    <span className="MonthlyAiCard_EvidenceTag">
                      {insight.evidence.count} {insight.evidence.count === 1 ? 'txn' : 'txns'}
                      <ChevronRight size={11} strokeWidth={2.4} />
                    </span>
                  )}
                </div>

                {/* Hero Stat Metric & Title */}
                <div className="MonthlyAiCard_StatRow">
                  {insight.metric && (
                    <span className={`MonthlyAiCard_MetricBadge ${theme.accentClass}`}>
                      {insight.metric}
                    </span>
                  )}
                  <h3 className="MonthlyAiCard_Title">{cleanTitle}</h3>
                </div>

                {/* Body Fact */}
                <p className="MonthlyAiCard_Fact">{insight.fact}</p>

                {/* Compact Action Pill */}
                {insight.action && (
                  <div className="MonthlyAiCard_ActionBox">
                    <span className="MonthlyAiCard_ActionTag">Tip</span>
                    <span className="MonthlyAiCard_ActionText">{insight.action}</span>
                  </div>
                )}
              </article>
            );
          })}
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
        onTransactionUpdated={(tx) => {
          setViewingTx(tx);
          clientBriefCache.delete(targetMonth);
          try {
            sessionStorage.removeItem(`moni_brief_${targetMonth}`);
          } catch (_e) {}
          load(true);
        }}
      />
    </>
  );
};

export default MonthlyAiBrief;
