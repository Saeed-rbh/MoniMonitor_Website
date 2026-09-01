import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTransactions } from "../../context/TransactionContext";
import { getPortfolioAPI } from "../../services/apiService";
import { buildAccountStatistics } from "./accountStatistics";
import "./SaveInvestInsights.css";

const money = (minorValue, currency = "CAD") =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(minorValue || 0) / 100);

const shortDate = (value) => value
  ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  : "No activity";

const hasAccountValue = (account = {}) =>
  Number(account.cashMinor || 0) !== 0 || Number(account.holdingsValueMinor || 0) !== 0;

const generateSvgPath = (points, width = 160, height = 48, padding = 5) => {
  if (!points || points.length < 2) {
    if (points && points.length === 1) {
      return `M 0,${height / 2} L ${width},${height / 2}`;
    }
    return "";
  }
  const minVal = Math.min(...points);
  const maxVal = Math.max(...points);
  const range = maxVal - minVal || 1;
  const usableHeight = height - padding * 2;

  const coords = points.map((val, idx) => {
    const x = (idx / (points.length - 1)) * width;
    const y = height - padding - ((val - minVal) / range) * usableHeight;
    return [x, y];
  });

  let d = `M ${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[i + 1];
    const cpx1 = (x0 + (x1 - x0) / 2).toFixed(1);
    const cpy1 = y0.toFixed(1);
    const cpx2 = (x0 + (x1 - x0) / 2).toFixed(1);
    const cpy2 = y1.toFixed(1);
    d += ` C ${cpx1},${cpy1} ${cpx2},${cpy2} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
};

const SaveInvestInsights = () => {
  const navigate = useNavigate();
  const { allTransactions } = useTransactions();
  const [portfolio, setPortfolio] = useState(null);

  useEffect(() => {
    let active = true;
    getPortfolioAPI().then((data) => {
      if (active) setPortfolio(data);
    });
    return () => { active = false; };
  }, [allTransactions]);

  const accounts = portfolio?.accounts || [];
  const statistics = useMemo(
    () => buildAccountStatistics(accounts, allTransactions),
    [accounts, allTransactions]
  );
  const activeStatistics = useMemo(
    () => statistics.filter(({ account }) => hasAccountValue(account)),
    [statistics]
  );
  const unusedStatistics = useMemo(
    () => statistics.filter(({ account }) => !hasAccountValue(account)),
    [statistics]
  );
  const currency = accounts[0]?.currency || "CAD";
  const netValueMinor = Number(portfolio?.totalValueMinor || 0);
  const assetsMinor = Number(portfolio?.totalCashMinor || 0) +
    Number(portfolio?.holdingsValueMinor || 0);
  const debtMinor = Number(portfolio?.totalLiabilitiesMinor || 0);
  const holdingsMinor = Number(portfolio?.holdingsValueMinor || 0);
  const visibleAccounts = activeStatistics.map((item) => item.account);

  const trendPoints = useMemo(() => {
    if (!allTransactions) return [];
    const monthKeys = Object.keys(allTransactions)
      .filter((k) => /^\d{4}-\d{2}$/.test(k))
      .sort();
    if (monthKeys.length === 0) return [];

    let runningBalance = 0;
    const points = [];
    monthKeys.forEach((key) => {
      const monthData = allTransactions[key];
      const inc = Number(monthData?.totalIncome || 0);
      const exp = Number(monthData?.totalExpense || 0);
      runningBalance += (inc - exp);
      points.push(runningBalance);
    });
    return points;
  }, [allTransactions]);

  const trendPath = useMemo(() => generateSvgPath(trendPoints), [trendPoints]);

  return (
    <main className="SaveInvestInsights AccountsOverview">
      <header className="SaveInvestInsights_Header">
        <div>
          <span className="SaveInvestInsights_Eyebrow">FINANCIAL OVERVIEW</span>
          <h1>Accounts</h1>
          <p>Balances and statistics for accounts with recorded activity.</p>
        </div>
        <div className="SaveInvestInsights_Actions">
          <button type="button" onClick={() => navigate("/Accounts/Manage")}>Manage</button>
        </div>
      </header>

      <section className="SaveInvestInsights_Hero">
        <div className="SaveInvestInsights_HeroContent">
          <span>Net account value</span>
          <h2>{portfolio ? money(netValueMinor, currency) : "—"}</h2>
          <div className="SaveInvestInsights_HeroMeta">
            <span>{money(assetsMinor, currency)} assets</span>
            <span>{money(debtMinor, currency)} debt</span>
          </div>
        </div>
        {trendPath && (
          <div className="SaveInvestInsights_HeroTrend" aria-label="All-time net value trend">
            <svg viewBox="0 0 160 48" className="AccountsHero_TrendSvg" preserveAspectRatio="none">
              <defs>
                <linearGradient id="heroTrendGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="var(--Bc-1)" stopOpacity="0.75" />
                  <stop offset="100%" stopColor="#4ade80" stopOpacity="1" />
                </linearGradient>
                <filter id="heroTrendGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(212, 157, 129, 0.45)" />
                </filter>
              </defs>
              <path
                d={trendPath}
                fill="none"
                stroke="url(#heroTrendGrad)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#heroTrendGlow)"
              />
            </svg>
          </div>
        )}
      </section>

      <section className="SaveInvestInsights_MetricGrid AccountsOverview_Metrics">
        <article>
          <span>Assets</span>
          <strong>{money(assetsMinor, currency)}</strong>
          <small>Cash and investment holdings</small>
        </article>
        <article>
          <span>Debt</span>
          <strong className={debtMinor > 0 ? "negative" : ""}>{money(debtMinor, currency)}</strong>
          <small>Outstanding credit balances</small>
        </article>
        <article>
          <span>Accounts</span>
          <strong>{visibleAccounts.length}</strong>
          <small>With recorded transactions</small>
        </article>
        <article>
          <span>Investments</span>
          <strong>{money(holdingsMinor, currency)}</strong>
          <small>{visibleAccounts.reduce((sum, account) => sum + (account.holdings?.length || 0), 0)} holdings</small>
        </article>
      </section>

      <section className="SaveInvestInsights_Card AccountsOverview_ListCard">
        <div className="SaveInvestInsights_CardHeader">
          <div>
            <h2>Account summary</h2>
            <p>Current value and all-time account statistics</p>
          </div>
        </div>

        <div className="SaveInvestInsights_Accounts">
          {activeStatistics.map(({ account, ...stats }) => {
            const isDebt = account.accountType === "Credit Card";
            const valueMinor = Number(account.totalValueMinor || 0);
            const displayValueMinor = isDebt ? Math.abs(valueMinor) : valueMinor;
            const comparisonTotal = isDebt ? debtMinor : assetsMinor;
            const share = comparisonTotal > 0
              ? Math.min(100, (displayValueMinor / comparisonTotal) * 100)
              : 0;

            const canHoldInvestments = !["Chequing", "Credit Card"].includes(account.accountType);
            const hasHoldings = Boolean((account.holdings && account.holdings.length > 0) || Number(account.holdingsValueMinor || 0) > 0);
            const isInvestmentAccount = canHoldInvestments || hasHoldings;

            const cashVal = Number(account.cashMinor || 0);
            const holdingsVal = Number(account.holdingsValueMinor || 0);
            const totalVal = cashVal + holdingsVal;
            const cashShare = totalVal > 0 ? (cashVal / totalVal) * 100 : (cashVal > 0 ? 100 : 0);
            const holdingsShare = totalVal > 0 ? (holdingsVal / totalVal) * 100 : (holdingsVal > 0 ? 100 : 0);

            return (
              <article
                className="SaveInvestInsights_Account AccountsOverview_Account"
                key={account.id}
                role="link"
                tabIndex={0}
                aria-label={`Open ${account.name} transactions`}
                onClick={() => navigate(`/Accounts/${encodeURIComponent(account.id)}/Transactions`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(`/Accounts/${encodeURIComponent(account.id)}/Transactions`);
                  }
                }}
              >
                <div
                  className="AccountsOverview_OpenAccount"
                  aria-hidden="true"
                >
                  <span>View transactions</span>
                  <span>›</span>
                </div>
                <header>
                  <div>
                    <h3>{account.name}</h3>
                    <p>{account.institution || "Independent"} · {account.accountType}</p>
                    {account.accountRef && <small>{account.accountRef}</small>}
                  </div>
                  <div className="AccountsOverview_Balance">
                    <strong className={isDebt ? "negative" : ""}>
                      {money(displayValueMinor, account.currency)}
                    </strong>
                    <small>{isDebt ? "owed" : "current value"}</small>
                  </div>
                </header>

                <div className={`AccountsOverview_Share ${isDebt ? "debt" : ""}`} aria-hidden="true">
                  <span style={{ width: `${share}%` }} />
                </div>
                <div className="AccountsOverview_ShareLabel">
                  {share.toFixed(1)}% of {isDebt ? "total debt" : "total assets"}
                </div>

                {/* Asset Breakdown for Investment / Holdings Accounts (TFSA, Crypto, RRSP, Brokerage, etc.) */}
                {isInvestmentAccount && (
                  <div className="AccountsOverview_AssetBreakdown" onClick={(e) => e.stopPropagation()}>
                    <div className="AccountsOverview_AssetHeader">
                      <span className="AccountsOverview_AssetTitle">Asset Breakdown</span>
                      <span className="AccountsOverview_TotalVal">Total: {money(totalVal, account.currency)}</span>
                    </div>

                    <div className="AccountsOverview_AssetBar" aria-hidden="true">
                      <span className="cash" style={{ width: `${cashShare}%` }} title={`Cash: ${cashShare.toFixed(1)}%`} />
                      <span className="holdings" style={{ width: `${holdingsShare}%` }} title={`Holdings: ${holdingsShare.toFixed(1)}%`} />
                    </div>

                    <div className="AccountsOverview_AssetLegend">
                      <div className="AccountsOverview_LegendItem">
                        <span className="dot cash" />
                        <div>
                          <span className="label">Cash</span>
                          <strong>{money(cashVal, account.currency)} <small>({cashShare.toFixed(1)}%)</small></strong>
                        </div>
                      </div>
                      <div className="AccountsOverview_LegendItem">
                        <span className="dot holdings" />
                        <div>
                          <span className="label">Holdings</span>
                          <strong>{money(holdingsVal, account.currency)} <small>({holdingsShare.toFixed(1)}%)</small></strong>
                        </div>
                      </div>
                      {Number(account.gainLossMinor || 0) !== 0 && (
                        <div className="AccountsOverview_LegendItem">
                          <span className="label">Stock Gain/Loss</span>
                          <strong className={Number(account.gainLossMinor || 0) >= 0 ? "positive" : "negative"}>
                            {Number(account.gainLossMinor || 0) >= 0 ? "+" : ""}{money(account.gainLossMinor, account.currency)}
                          </strong>
                        </div>
                      )}
                    </div>

                    {/* Detailed Holdings List */}
                    {account.holdings && account.holdings.length > 0 && (
                      <div className="AccountsOverview_HoldingsList">
                        <div className="AccountsOverview_HoldingsHeader">
                          <span>Holdings ({account.holdings.length})</span>
                          <span>Value & Share</span>
                        </div>
                        {account.holdings.map((item) => {
                          const itemPriceMicros = Number.isSafeInteger(item.priceMicros) ? item.priceMicros : item.priceMinor * 10000;
                          const itemCostMicros = Number.isSafeInteger(item.averageCostMicros) ? item.averageCostMicros : item.averageCostMinor * 10000;
                          const itemVal = Math.round((item.quantity * itemPriceMicros) / 10000);
                          const itemCost = Math.round((item.quantity * itemCostMicros) / 10000);
                          const itemGain = itemVal - itemCost;
                          const itemGainPct = itemCost > 0 ? ((itemGain / itemCost) * 100).toFixed(1) : "0.0";
                          const itemShare = totalVal > 0 ? ((itemVal / totalVal) * 100).toFixed(1) : "0.0";

                          const formattedQuantity = Number(Number(item.quantity || 0).toFixed(4)).toString();

                          return (
                            <div key={item.id} className="AccountsOverview_HoldingRow">
                              <div className="AccountsOverview_HoldingInfo">
                                <div className="AccountsOverview_SymbolBadge">
                                  <strong>{item.symbol}</strong>
                                  {item.name && <span className="name">· {item.name}</span>}
                                </div>
                                <div className="AccountsOverview_HoldingSub">
                                  {formattedQuantity} units @ {new Intl.NumberFormat(undefined, { style: "currency", currency: account.currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(itemPriceMicros / 1000000)}
                                </div>
                              </div>
                              <div className="AccountsOverview_HoldingVal">
                                <strong>{money(itemVal, account.currency)}</strong>
                                <div className="AccountsOverview_HoldingMeta">
                                  <span className="share">{itemShare}% of account</span>
                                  <span className={`gain ${itemGain >= 0 ? "positive" : "negative"}`}>
                                    {itemGain >= 0 ? "+" : ""}{money(itemGain, account.currency)} ({itemGainPct}%)
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div className="SaveInvestInsights_AccountSummary AccountsOverview_Stats">
                  <span>
                    Money in
                    <strong className="positive">{money(stats.moneyInMinor, account.currency)}</strong>
                  </span>
                  <span>
                    Money out
                    <strong>{money(stats.moneyOutMinor, account.currency)}</strong>
                  </span>
                  <span>
                    Transactions
                    <strong>{stats.transactionCount.toLocaleString()}</strong>
                  </span>
                  <span>
                    Net flow
                    <strong className={stats.netFlowMinor >= 0 ? "positive" : "negative"}>
                      {stats.netFlowMinor >= 0 ? "+" : ""}{money(stats.netFlowMinor, account.currency)}
                    </strong>
                  </span>
                </div>

                <div className="AccountsOverview_Period">
                  <span>First activity <strong>{shortDate(stats.firstActivity)}</strong></span>
                  <span>Latest activity <strong>{shortDate(stats.latestActivity)}</strong></span>
                </div>
              </article>
            );
          })}

          {portfolio && !activeStatistics.length && (
            <div className="SaveInvestInsights_Empty">No accounts with a current balance.</div>
          )}
          {!portfolio && (
            <div className="SaveInvestInsights_Empty">Loading account summaries…</div>
          )}
        </div>
      </section>

      {unusedStatistics.length > 0 && (
        <section className="SaveInvestInsights_Card AccountsOverview_ListCard AccountsOverview_UnusedSection">
          <div className="SaveInvestInsights_CardHeader">
            <div>
              <h2>Unused accounts</h2>
              <p>No current cash balance or investment holdings</p>
            </div>
            <span className="AccountsOverview_UnusedCount">{unusedStatistics.length}</span>
          </div>
          <div className="AccountsOverview_UnusedList">
            {unusedStatistics.map(({ account }) => (
              <article
                className="AccountsOverview_UnusedAccount"
                key={account.id}
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/Accounts/${encodeURIComponent(account.id)}/Transactions`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(`/Accounts/${encodeURIComponent(account.id)}/Transactions`);
                  }
                }}
              >
                <div>
                  <h3>{account.name}</h3>
                  <p>{account.institution || "Independent"} · {account.accountType}</p>
                  {account.accountRef && <small>{account.accountRef}</small>}
                </div>
                <div className="AccountsOverview_UnusedBalance">
                  <strong>{money(0, account.currency)}</strong>
                  <span>View transactions ›</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
};

export default SaveInvestInsights;
