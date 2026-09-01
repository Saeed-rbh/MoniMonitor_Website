import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getTransactionIcon } from "../../components/Categories";
import MoreOpen from "../../components/MoreOpen/MoreOpen";
import { useTransactions } from "../../context/TransactionContext";
import { getPortfolioAPI } from "../../services/apiService";
import { getTransactionDisplayReason } from "../../utils/transactionDisplay";
import { getAccountTransactionFlow, getAccountTransactions } from "./accountStatistics";
import TransactionDetailModal from "../../components/TransactionDetailModal/TransactionDetailModal";
import "./SaveInvestInsights.css";

const ITEMS_PER_PAGE = 40;

const money = (transaction, currency = "CAD") => {
  const amount = Number.isFinite(Number(transaction?.AmountMinor))
    ? Number(transaction.AmountMinor) / 100
    : Number(transaction?.Amount || 0);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
};

const transactionDirection = (transaction) => {
  return getAccountTransactionFlow(transaction) === "IN" ? "in" : "out";
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

const AccountTransactions = () => {
  const { accountId } = useParams();
  const { allTransactions } = useTransactions();
  const [portfolio, setPortfolio] = useState(null);
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [open, setOpen] = useState(true);
  const [viewingTx, setViewingTx] = useState(null);
  const sentinelRef = useRef(null);

  useEffect(() => {
    let active = true;
    getPortfolioAPI().then((data) => {
      if (active) setPortfolio(data);
    });
    return () => { active = false; };
  }, []);

  const account = useMemo(
    () => portfolio?.accounts?.find((item) => String(item.id) === String(accountId)),
    [accountId, portfolio]
  );
  const transactions = useMemo(
    () => account ? getAccountTransactions(account, allTransactions) : [],
    [account, allTransactions]
  );
  const visibleTransactions = transactions.slice(0, visibleCount);

  useEffect(() => setVisibleCount(ITEMS_PER_PAGE), [accountId]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= transactions.length) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisibleCount((count) => Math.min(count + ITEMS_PER_PAGE, transactions.length));
      }
    }, { rootMargin: "180px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [transactions.length, visibleCount]);

  const accountFeed = () => (
    <main className="SaveInvestInsights AccountTransactions AccountTransactions_Sheet">
      {portfolio && !account ? (
        <div className="SaveInvestInsights_Empty AccountTransactions_NotFound">Account not found.</div>
      ) : (
        <>
          <header className="SaveInvestInsights_Header AccountTransactions_Header">
            <div>
              <span className="SaveInvestInsights_Eyebrow">ACCOUNT HISTORY</span>
              <h1>{account?.name || "Loading account…"}</h1>
              <p>{account ? `${account.institution || "Independent"} · ${account.accountType}` : "Loading transactions…"}</p>
            </div>
            {account && (
              <div className="AccountsOverview_Balance">
                <strong>{new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: account.currency || "CAD",
                }).format(Math.abs(Number(account.totalValueMinor || 0)) / 100)}</strong>
                <small>{account.accountType === "Credit Card" ? "owed" : "current value"}</small>
              </div>
            )}
          </header>

          {account && (
            <section className="SaveInvestInsights_Card AccountTransactions_ListCard">
              <div className="SaveInvestInsights_CardHeader">
                <div>
                  <h2>Transactions</h2>
                  <p>{transactions.length.toLocaleString()} all-time transactions</p>
                </div>
              </div>

              <div className="AccountTransactions_List">
                {visibleTransactions.map((transaction, index) => {
                  const direction = transactionDirection(transaction);
                  const reason = getTransactionDisplayReason(transaction.Reason, transaction.Label);
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
                        <strong>{direction === "in" ? "+" : "−"}{money(transaction, account.currency)}</strong>
                        <span>{direction === "in" ? "in" : "out"}</span>
                      </div>
                    </article>
                  );
                })}
                {!transactions.length && (
                  <div className="SaveInvestInsights_Empty">No transactions found for this account.</div>
                )}
                <div ref={sentinelRef} className="AccountTransactions_Sentinel" aria-hidden="true" />
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );

  return (
    <>
      <MoreOpen
        isClicked={open}
        setIsClicked={setOpen}
        feed={accountFeed}
        MoreOpenHeight={75}
        toRedirect="/Accounts"
        overflow="hidden"
      />
      <TransactionDetailModal
        transaction={viewingTx}
        onClose={() => setViewingTx(null)}
        onTransactionUpdated={(tx) => setViewingTx(tx)}
      />
    </>
  );
};

export default AccountTransactions;
