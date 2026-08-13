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

                {(Number(account.holdingsValueMinor || 0) > 0 || account.holdings?.length) && (
                  <div className="AccountsOverview_InvestmentStats">
                    <span>Cash <strong>{money(account.cashMinor, account.currency)}</strong></span>
                    <span>Holdings <strong>{money(account.holdingsValueMinor, account.currency)}</strong></span>
                    <span>
                      Gain/loss
                      <strong className={Number(account.gainLossMinor || 0) >= 0 ? "positive" : "negative"}>
                        {Number(account.gainLossMinor || 0) >= 0 ? "+" : ""}{money(account.gainLossMinor, account.currency)}
                      </strong>
                    </span>
                  </div>
                )}
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
