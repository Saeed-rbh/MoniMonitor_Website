import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTransactions } from "../../context/TransactionContext";
import { getPortfolioAPI } from "../../services/apiService";
import "./SaveInvestInsights.css";

const isSaveInvestTransaction = (transaction) =>
  ["Saving", "SavingWithdrawal", "Save&Invest", "Investment"].includes(transaction?.Category);

const isContributionTransaction = (transaction) =>
  ["Saving", "Save&Invest"].includes(transaction?.Category);

const money = (value, currency = "USD") =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const unitPrice = (value, currency = "USD") =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value || 0));

const SaveInvestInsights = () => {
  const navigate = useNavigate();
  const { allTransactions, monthData, setIsMoreClicked } = useTransactions();
  const [portfolio, setPortfolio] = useState(null);
  const [range, setRange] = useState(6);

  useEffect(() => {
    let active = true;
    getPortfolioAPI().then((data) => {
      if (active) setPortfolio(data);
    });
    return () => {
      active = false;
    };
  }, []);

  const monthlyData = useMemo(
    () =>
      Object.entries(allTransactions || {})
        .map(([month, data]) => ({
          month,
          savings: Number(data?.totalSaving || 0),
          transactions: (data?.transactions || []).filter(isSaveInvestTransaction),
        }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    [allTransactions]
  );

  const savingTransactions = useMemo(
    () =>
      monthlyData
        .flatMap((entry) => entry.transactions)
        .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp)),
    [monthlyData]
  );

  const contributionTransactions = useMemo(
    () => savingTransactions.filter(isContributionTransaction),
    [savingTransactions]
  );

  const visibleMonthlyData =
    range === 0 ? monthlyData : monthlyData.slice(-range);
  const totalContributed = monthlyData.reduce(
    (sum, entry) => sum + entry.savings,
    0
  );
  const currentContribution = Number(monthData?.selected?.totalSaving || 0);
  const previousContribution =
    monthlyData.length > 1 ? monthlyData[monthlyData.length - 2].savings : 0;
  const contributionChange =
    previousContribution > 0
      ? ((currentContribution - previousContribution) / previousContribution) * 100
      : null;
  const averageContribution = visibleMonthlyData.length
    ? visibleMonthlyData.reduce((sum, entry) => sum + entry.savings, 0) /
      visibleMonthlyData.length
    : 0;

  const labels = useMemo(() => {
    const totals = new Map();
    contributionTransactions.forEach((transaction) => {
      const label = transaction.Label || "Other";
      totals.set(label, (totals.get(label) || 0) + Number(transaction.Amount || 0));
    });
    return [...totals.entries()]
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 4);
  }, [contributionTransactions]);

  const currency = portfolio?.accounts?.[0]?.currency || "USD";
  const portfolioValue = Number(portfolio?.totalValueMinor || 0) / 100;
  const cashValue = Number(portfolio?.totalCashMinor || 0) / 100;
  const holdingsValue = Number(portfolio?.holdingsValueMinor || 0) / 100;
  const gainLoss = Number(portfolio?.gainLossMinor || 0) / 100;
  const assetValue = cashValue + holdingsValue;
  const cashPercent = assetValue > 0 ? (cashValue / assetValue) * 100 : 0;
  const holdingsPercent =
    assetValue > 0 ? (holdingsValue / assetValue) * 100 : 0;
  const holdingsCount = (portfolio?.accounts || []).reduce(
    (count, account) => count + (account.holdings?.length || 0),
    0
  );

  const openTransactions = () => {
    setIsMoreClicked("Save&Invest");
    navigate("/Transactions");
  };

  return (
    <main className="SaveInvestInsights">
      <header className="SaveInvestInsights_Header">
        <div>
          <span className="SaveInvestInsights_Eyebrow">SAVE & INVEST</span>
          <h1>Insights</h1>
          <p>Track contributions, allocation, and portfolio progress.</p>
        </div>
        <div className="SaveInvestInsights_Actions">
          <button type="button" onClick={openTransactions}>Activity</button>
          <button type="button" onClick={() => navigate("/SaveInvest/Accounts")}>
            Accounts
          </button>
        </div>
      </header>

      <section className="SaveInvestInsights_Hero">
        <span>Net account value</span>
        <h2>{portfolio ? money(portfolioValue, currency) : "Loading…"}</h2>
        <div className="SaveInvestInsights_HeroMeta">
          <span className={gainLoss >= 0 ? "positive" : "negative"}>
            {gainLoss >= 0 ? "+" : ""}{money(gainLoss, currency)} gain/loss
          </span>
          <span>{portfolio?.accounts?.length || 0} accounts</span>
        </div>
      </section>

      <section className="SaveInvestInsights_MetricGrid">
        <article>
          <span>This month</span>
          <strong>{money(currentContribution, currency)}</strong>
          <small className={
            contributionChange === null
              ? ""
              : contributionChange >= 0
                ? "positive"
                : "negative"
          }>
            {contributionChange === null
              ? "No prior month comparison"
              : (contributionChange >= 0 ? "▲ " : "▼ ") +
                Math.abs(contributionChange).toFixed(1) +
                "% from prior month"}
          </small>
        </article>
        <article>
          <span>All-time recorded</span>
          <strong>{money(totalContributed, currency)}</strong>
          <small>{contributionTransactions.length} contribution entries</small>
        </article>
        <article>
          <span>Cash</span>
          <strong>{money(cashValue, currency)}</strong>
          <small>{cashPercent.toFixed(0)}% of portfolio</small>
        </article>
        <article>
          <span>Investments</span>
          <strong>{money(holdingsValue, currency)}</strong>
          <small>{holdingsCount} holdings · {holdingsPercent.toFixed(0)}%</small>
        </article>
      </section>

      <section className="SaveInvestInsights_Card">
        <div className="SaveInvestInsights_CardHeader">
          <div>
            <h2>Contribution trend</h2>
            <p>Average {money(averageContribution, currency)} per month</p>
          </div>
          <div className="SaveInvestInsights_Range">
            {[6, 12, 0].map((value) => (
              <button
                type="button"
                key={value}
                className={range === value ? "active" : ""}
                onClick={() => setRange(value)}
              >
                {value || "All"}
              </button>
            ))}
          </div>
        </div>
        <div className="SaveInvestInsights_Chart">
          {visibleMonthlyData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={visibleMonthlyData}
                margin={{ top: 8, right: 4, left: -22, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.08} vertical={false} />
                <XAxis
                  dataKey="month"
                  stroke="var(--Ac-3)"
                  fontSize={9}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => {
                    const parts = value.split("-");
                    return parts[1] + "/" + parts[0].slice(2);
                  }}
                />
                <YAxis
                  stroke="var(--Ac-3)"
                  fontSize={9}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => "$" + Math.round(value)}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,.03)" }}
                  contentStyle={{
                    background: "var(--Ec-1)",
                    border: "1px solid var(--Bc-3)",
                    borderRadius: "12px",
                    fontSize: ".75rem",
                  }}
                  formatter={(value) => [money(value, currency), "Saved / invested"]}
                />
                <Bar
                  dataKey="savings"
                  fill="var(--Bc-1)"
                  radius={[7, 7, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="SaveInvestInsights_Empty">No contribution history yet.</div>
          )}
        </div>
      </section>

      <section className="SaveInvestInsights_Card">
        <div className="SaveInvestInsights_CardHeader">
          <div>
            <h2>Allocation</h2>
            <p>Cash compared with investment holdings</p>
          </div>
        </div>
        <div className="SaveInvestInsights_Allocation">
          <div>
            <span>Cash</span>
            <strong>{cashPercent.toFixed(0)}%</strong>
          </div>
          <div className="SaveInvestInsights_AllocationBar">
            <span style={{ width: Math.min(100, cashPercent) + "%" }} />
          </div>
          <div>
            <span>Investments</span>
            <strong>{holdingsPercent.toFixed(0)}%</strong>
          </div>
          <div className="SaveInvestInsights_AllocationBar investments">
            <span style={{ width: Math.min(100, holdingsPercent) + "%" }} />
          </div>
        </div>
      </section>

      <section className="SaveInvestInsights_Card">
        <div className="SaveInvestInsights_CardHeader">
          <div>
            <h2>Your accounts</h2>
            <p>Balances and holdings stored in your portfolio</p>
          </div>
          <button
            type="button"
            className="SaveInvestInsights_TextButton"
            onClick={() => navigate("/SaveInvest/Accounts")}
          >
            Manage
          </button>
        </div>

        <div className="SaveInvestInsights_Accounts">
          {(portfolio?.accounts || []).map((account) => (
            <article className="SaveInvestInsights_Account" key={account.id}>
              <header>
                <div>
                  <h3>{account.name}</h3>
                  <p>
                    {account.institution || "Independent"} · {account.accountType}
                  </p>
                </div>
                <strong>
                  {money(Number(account.totalValueMinor || 0) / 100, account.currency)}
                </strong>
              </header>

              <div className="SaveInvestInsights_AccountSummary">
                <span>
                  Cash
                  <strong>
                    {money(Number(account.cashMinor || 0) / 100, account.currency)}
                  </strong>
                </span>
                <span>
                  Investments
                  <strong>
                    {money(
                      Number(account.holdingsValueMinor || 0) / 100,
                      account.currency
                    )}
                  </strong>
                </span>
                <span>
                  Gain/loss
                  <strong className={
                    Number(account.gainLossMinor || 0) >= 0 ? "positive" : "negative"
                  }>
                    {Number(account.gainLossMinor || 0) >= 0 ? "+" : ""}
                    {money(
                      Number(account.gainLossMinor || 0) / 100,
                      account.currency
                    )}
                  </strong>
                </span>
              </div>

              {account.holdings?.length ? (
                <div className="SaveInvestInsights_Holdings">
                  {account.holdings.map((holding) => {
                    const pricePerShare = Number.isSafeInteger(holding.priceMicros)
                      ? holding.priceMicros / 1000000
                      : Number(holding.priceMinor || 0) / 100;
                    const averageCost = Number.isSafeInteger(holding.averageCostMicros)
                      ? holding.averageCostMicros / 1000000
                      : Number(holding.averageCostMinor || 0) / 100;
                    const positionValue =
                      Number(holding.quantity || 0) * pricePerShare;
                    return (
                      <div className="SaveInvestInsights_Holding" key={holding.id}>
                        <div>
                          <strong>{holding.symbol}</strong>
                          {holding.name && <span>{holding.name}</span>}
                          <small>
                            {Number(holding.quantity || 0).toLocaleString(
                              undefined,
                              { maximumFractionDigits: 6 }
                            )} shares × {unitPrice(
                              pricePerShare,
                              holding.currency || account.currency
                            )} each
                          </small>
                        </div>
                        <div>
                          <strong>
                            {money(
                              positionValue,
                              holding.currency || account.currency
                            )}
                          </strong>
                          <small>
                            Avg. cost {unitPrice(
                              averageCost,
                              holding.currency || account.currency
                            )}
                          </small>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="SaveInvestInsights_CashOnly">
                  Cash-only account · no investment holdings
                </p>
              )}
            </article>
          ))}
          {portfolio && !portfolio.accounts?.length && (
            <div className="SaveInvestInsights_Empty">
              No accounts are stored yet. Select Manage to add one.
            </div>
          )}
          {!portfolio && (
            <div className="SaveInvestInsights_Empty">Loading accounts…</div>
          )}
        </div>
      </section>

      <section className="SaveInvestInsights_Card">
        <div className="SaveInvestInsights_CardHeader">
          <div>
            <h2>Top destinations</h2>
            <p>Where recorded contributions went</p>
          </div>
        </div>
        <div className="SaveInvestInsights_Rows">
          {labels.length ? labels.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{money(item.amount, currency)}</strong>
            </div>
          )) : <div className="SaveInvestInsights_Empty">No categories available yet.</div>}
        </div>
      </section>

      <section className="SaveInvestInsights_Card">
        <div className="SaveInvestInsights_CardHeader">
          <div>
            <h2>Recent activity</h2>
            <p>Latest saving and investment transactions</p>
          </div>
          <button type="button" className="SaveInvestInsights_TextButton" onClick={openTransactions}>
            View all
          </button>
        </div>
        <div className="SaveInvestInsights_Rows">
          {savingTransactions.slice(0, 5).map((transaction) => (
            <div key={transaction.id || transaction.Timestamp + transaction.Reason}>
              <span>
                {transaction.Reason || transaction.Label || "Save & Invest"}
                <small>{new Date(transaction.Timestamp).toLocaleDateString()}</small>
              </span>
              <strong>{money(transaction.Amount, currency)}</strong>
            </div>
          ))}
          {!savingTransactions.length && (
            <div className="SaveInvestInsights_Empty">No saving or investment activity yet.</div>
          )}
        </div>
      </section>
    </main>
  );
};

export default SaveInvestInsights;
