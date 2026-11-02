import React, { useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useTransactions } from "../../context/TransactionContext";
import TransactionDetailModal from "../../components/TransactionDetailModal/TransactionDetailModal";
import { getTransactionIcon } from "../../components/Categories";
import { getTransactionDisplayReason } from "../../utils/transactionDisplay";
import { parseTransactionDate, parseTransactionCalendarDate, isDateOnlyTransactionTimestamp } from "../../utils/transactionDate";
import "../../components/TransactionRow.css";
import "./TransactionSearch.css";

const categories = ["All", "Expense", "Income", "Save & invest"];
const pageSize = 30;
const transactionDate = value => {
  const date = parseTransactionDate(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    ...(isDateOnlyTransactionTimestamp(value) ? {} : { hour: "numeric", minute: "2-digit" }),
  });
};
const money = transaction => new Intl.NumberFormat("en-CA", {
  style: "currency", currency: transaction.Currency || "CAD", maximumFractionDigits: 2,
}).format(Math.abs(Number.isFinite(Number(transaction.AmountMinor))
  ? Number(transaction.AmountMinor) / 100 : Number(transaction.Amount || 0)));

export default function TransactionSearch() {
  const { allTransactions } = useTransactions();
  const [viewingTransaction, setViewingTransaction] = useState(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const invalidRange = Boolean(startDate && endDate && startDate > endDate);
  const [limit, setLimit] = useState(pageSize);
  const inputRef = useRef(null);
  const transactions = useMemo(() => Object.values(allTransactions || {})
    .flatMap(month => month.transactions || [])
    .sort((a, b) => String(b.Timestamp).localeCompare(String(a.Timestamp))), [allTransactions]);
  const results = useMemo(() => {
    if (invalidRange) return [];
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return transactions.filter(transaction => {
      if (startDate || endDate) {
        const date = parseTransactionCalendarDate(transaction.Timestamp);
        if (Number.isNaN(date.getTime())) return false;
        const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        if ((startDate && day < startDate) || (endDate && day > endDate)) return false;
      }
      const matchesCategory = category === "All" || (category === "Save & invest"
        ? ["Saving", "Save&Invest", "Investment"].includes(transaction.Category)
        : transaction.Category === category);
      const text = [transaction.Reason, transaction.Label, transaction.Amount,
        transaction.BankName, transaction.Category, transaction.Type, transaction.Timestamp]
        .filter(value => value != null).join(" ").toLocaleLowerCase();
      return matchesCategory && terms.every(term => text.includes(term));
    });
  }, [transactions, query, category, startDate, endDate, invalidRange]);

  const clear = () => {
    setQuery("");
    setCategory("All");
    setStartDate("");
    setEndDate("");
    setLimit(pageSize);
    inputRef.current?.focus();
  };

  return (
    <section className="transaction-search" aria-label="Transaction search">
      <label className="transaction-search-label" htmlFor="transaction-query">Merchant, category, bank or amount</label>
      <form className="transaction-search-field" role="search" onSubmit={event => { event.preventDefault(); inputRef.current?.blur(); }}>
        <Search size={20} aria-hidden="true" />
        <input ref={inputRef} enterKeyHint="search" autoComplete="off" id="transaction-query" type="search"
          placeholder="Merchant, bank or amount" value={query}
          onChange={event => { setQuery(event.target.value); setLimit(pageSize); }} />
        {query && <button type="button" aria-label="Clear search" onClick={() => {
          setQuery(""); setLimit(pageSize); inputRef.current?.focus();
        }}><X size={18} aria-hidden="true" /></button>}
      </form>
      <div className="transaction-search-filters" role="group" aria-label="Transaction category">
        {categories.map(item => <button key={item} type="button" aria-pressed={category === item}
          onClick={() => { setCategory(item); setLimit(pageSize); }}>{item}</button>)}
      </div>
      <fieldset className="transaction-search-dates">
        <legend className="transaction-search-label">Date range</legend>
        <label htmlFor="transaction-start-date"><span className="transaction-search-label">From</span>
          <input id="transaction-start-date" type="date" value={startDate} max={endDate || undefined}
            aria-invalid={invalidRange} aria-describedby={invalidRange ? "transaction-date-error" : undefined}
            onChange={event => { setStartDate(event.target.value); setLimit(pageSize); }} />
        </label>
        <label htmlFor="transaction-end-date"><span className="transaction-search-label">To</span>
          <input id="transaction-end-date" type="date" value={endDate} min={startDate || undefined}
            aria-invalid={invalidRange} aria-describedby={invalidRange ? "transaction-date-error" : undefined}
            onChange={event => { setEndDate(event.target.value); setLimit(pageSize); }} />
        </label>
        {(startDate || endDate) && <button type="button" className="transaction-search-date-reset"
          onClick={() => { setStartDate(""); setEndDate(""); setLimit(pageSize); }}>Clear dates</button>}
      </fieldset>
      {invalidRange && <p id="transaction-date-error" className="transaction-search-date-error" role="alert">Choose an end date on or after the start date.</p>}
      <p className="transaction-search-count" role="status">
        {results.length} {results.length === 1 ? "transaction" : "transactions"}
        {query.trim() ? " found" : " · Newest first"}
      </p>
      <div className="transaction-search-results">
        {results.slice(0, limit).map((transaction, index) => {
          const flow = String(transaction.AccountFlow || "").toUpperCase();
          const isIncome = transaction.Category === "Income" || ["income", "credit"].includes(String(transaction.Type || "").toLowerCase());
          const direction = transaction.Category === "Internal" ? "neutral"
            : flow === "IN" ? "in" : flow === "OUT" ? "out" : isIncome ? "in" : "out";
          return (
            <button type="button" className="transaction-search-result AccountTransactions_Row"
              key={transaction.id || `${transaction.Timestamp}-${index}`}
              onClick={() => setViewingTransaction(transaction)} aria-haspopup="dialog">
              <span className="AccountTransactions_Icon" aria-hidden="true">
                {getTransactionIcon(transaction.Category, transaction.Label)}
              </span>
              <span className="AccountTransactions_Reason">
                <strong>{getTransactionDisplayReason(transaction.Reason, transaction.Label)}</strong>
                <span>{transactionDate(transaction.Timestamp)}</span>
              </span>
              <span className={`AccountTransactions_Amount ${direction}`}>
                <strong>{direction === "neutral" ? "" : direction === "in" ? "+" : "−"}{money(transaction)}</strong>
                <span>{direction === "neutral" ? "transfer" : direction === "in" ? "in" : "out"}</span>
              </span>
            </button>
          );
        })}
        {!results.length && !invalidRange && <div className="transaction-search-empty">
          <Search size={28} aria-hidden="true" />
          <h2>{transactions.length ? "No matching transactions" : "No transactions yet"}</h2>
          <p>{transactions.length ? "Try a different merchant, a shorter phrase, or another category, or a wider date range." : "Your transactions will appear here once they’re added."}</p>
          {(query || category !== "All" || startDate || endDate) && <button type="button" onClick={clear}>Clear search and filters</button>}
        </div>}
        {results.length > limit && <button className="transaction-search-more" type="button"
          onClick={() => setLimit(value => value + pageSize)}>Show more transactions</button>}
      </div>
      <TransactionDetailModal
        transaction={viewingTransaction}
        onClose={() => setViewingTransaction(null)}
        onTransactionUpdated={setViewingTransaction}
      />
    </section>
  );
}
