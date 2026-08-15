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
  const currency = accounts[0]?.currency || "CAD";
  const netValueMinor = Number(portfolio?.totalValueMinor || 0);
  const assetsMinor = Number(portfolio?.totalCashMinor || 0) +
    Number(portfolio?.holdingsValueMinor || 0);
  const debtMinor = Number(portfolio?.totalLiabilitiesMinor || 0);
  const holdingsMinor = Number(portfolio?.holdingsValueMinor || 0);
  const activeAccounts = statistics.filter((item) => item.transactionCount > 0).length;

  return (
    <main className="SaveInvestInsights AccountsOverview">
      <header className="SaveInvestInsights_Header">
        <div>
          <span className="SaveInvestInsights_Eyebrow">FINANCIAL OVERVIEW</span>
          <h1>Accounts</h1>
          <p>Balances and statistics for every connected account.</p>
        </div>
        <div className="SaveInvestInsights_Actions">
          <button type="button" onClick={() => navigate("/Accounts/Manage")}>Manage</button>
        </div>
      </header>

      <section className="SaveInvestInsights_Hero">
        <span>Net account value</span>
        <h2>{portfolio ? money(netValueMinor, currency) : "—"}</h2>
        <div className="SaveInvestInsights_HeroMeta">
          <span>{money(assetsMinor, currency)} assets</span>
          <span>{money(debtMinor, currency)} debt</span>
        </div>
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
          <strong>{accounts.length}</strong>
          <small>{activeAccounts} with recorded activity</small>
        </article>
        <article>
          <span>Investments</span>
          <strong>{money(holdingsMinor, currency)}</strong>
          <small>{accounts.reduce((sum, account) => sum + (account.holdings?.length || 0), 0)} holdings</small>
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
          {statistics.map(({ account, ...stats }) => {
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

                          return (
                            <div key={item.id} className="AccountsOverview_HoldingRow">
                              <div className="AccountsOverview_HoldingInfo">
                                <div className="AccountsOverview_SymbolBadge">
                                  <strong>{item.symbol}</strong>
                                  {item.name && <span className="name">· {item.name}</span>}
                                </div>
                                <div className="AccountsOverview_HoldingSub">
                                  {item.quantity} units @ {new Intl.NumberFormat(undefined, { style: "currency", currency: account.currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(itemPriceMicros / 1000000)}
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

          {portfolio && !accounts.length && (
            <div className="SaveInvestInsights_Empty">No accounts are stored yet.</div>
          )}
          {!portfolio && (
            <div className="SaveInvestInsights_Empty">Loading account summaries…</div>
          )}
        </div>
      </section>
    </main>
  );
};

export default SaveInvestInsights;
