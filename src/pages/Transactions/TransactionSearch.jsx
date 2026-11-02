import React, { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import MoreOpen from "../../components/MoreOpen/MoreOpen";
import { Search, X, CalendarDays, Check, ArrowDownLeft, ArrowUpRight, Landmark, Layers } from "lucide-react";
import { useTransactions } from "../../context/TransactionContext";
import TransactionDetailModal from "../../components/TransactionDetailModal/TransactionDetailModal";
import { getTransactionIcon } from "../../components/Categories";
import { getTransactionDisplayReason } from "../../utils/transactionDisplay";
import { parseTransactionDate, parseTransactionCalendarDate, isDateOnlyTransactionTimestamp } from "../../utils/transactionDate";
import "../../components/TransactionRow.css";
import "./TransactionSearch.css";

const categories = ["All", "Expense", "Income", "Save & invest"];
const categoryIcons = { All: Layers, Expense: ArrowUpRight, Income: ArrowDownLeft, "Save & invest": Landmark };
const shortDate = value => parseTransactionCalendarDate(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const pageSize = 30;
const savedSearches = new Map();
const dateInputValue = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const quickDateRanges = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  return [
    { label: "Today", from: today, to: today },
    { label: "Last 7 days", from: new Date(year, month, today.getDate() - 6), to: today },
    { label: "This month", from: new Date(year, month, 1), to: new Date(year, month + 1, 0) },
    { label: "Last month", from: new Date(year, month - 1, 1), to: new Date(year, month, 0) },
  ].map(range => ({ label: range.label, start: dateInputValue(range.from), end: dateInputValue(range.to) }));
};
const dateGroup = value => {
  const date = parseTransactionCalendarDate(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
};
const highlight = (text, query) => {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!terms.length) return text;
  const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return text.split(new RegExp(`(${escaped.join("|")})`, "gi")).map((part, index) =>
    index % 2 ? <mark key={index}>{part}</mark> : part);
};
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
  const reducedMotion = useReducedMotion();
  const { allTransactions, userData } = useTransactions();
  const cacheKey = userData?.userId || "current";
  const initial = useRef(savedSearches.get(cacheKey) || {}).current;
  const [viewingTransaction, setViewingTransaction] = useState(null);
  const [query, setQuery] = useState(initial.query || "");
  const [category, setCategory] = useState(initial.category || "All");
  const [startDate, setStartDate] = useState(initial.startDate || "");
  const [endDate, setEndDate] = useState(initial.endDate || "");
  const invalidRange = Boolean(startDate && endDate && startDate > endDate);
  const [limit, setLimit] = useState(initial.limit || pageSize);
  const [datesOpen, setDatesOpen] = useState(false);
  const inputRef = useRef(null);
  const pageRef = useRef(null);
  const sentinelRef = useRef(null);
  const snapshot = useRef(initial);
  const previousFilters = useRef(JSON.stringify([query, category, startDate, endDate]));
  useEffect(() => {
    const next = JSON.stringify([query, category, startDate, endDate]);
    if (previousFilters.current !== next) {
      pageRef.current.scrollTop = 0;
      previousFilters.current = next;
    }
  }, [query, category, startDate, endDate]);
  useLayoutEffect(() => { pageRef.current.scrollTop = initial.scrollTop || 0; }, [initial]);
  useEffect(() => {
    snapshot.current = { query, category, startDate, endDate, limit,
      scrollTop: pageRef.current?.scrollTop || 0 };
  }, [query, category, startDate, endDate, limit]);
  useEffect(() => () => { savedSearches.set(cacheKey, snapshot.current); }, [cacheKey]);
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

  useEffect(() => {
    if (!sentinelRef.current || limit >= results.length || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setLimit(value => Math.min(value + pageSize, results.length));
    }, { root: pageRef.current, rootMargin: "180px" });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [limit, results.length]);
  const hasFilters = Boolean(query || category !== "All" || startDate || endDate);
  const clearDates = () => { setStartDate(""); setEndDate(""); setLimit(pageSize); };

  const clear = () => {
    setQuery("");
    setCategory("All");
    setStartDate("");
    setEndDate("");
    setLimit(pageSize);
    inputRef.current?.focus();
  };

  return (
    <motion.section ref={pageRef} className="transaction-search" aria-label="Transaction search"
      initial={reducedMotion ? false : { opacity: 0, y: 10, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: reducedMotion ? 0 : 0.3, ease: "easeOut" }}
      onScroll={event => { snapshot.current.scrollTop = event.currentTarget.scrollTop; }}>
      <label className="transaction-search-label" htmlFor="transaction-query">Merchant, category, bank or amount</label>
      <form className="transaction-search-field" role="search" onSubmit={event => { event.preventDefault(); inputRef.current?.blur(); }}>
        <Search size={20} aria-hidden="true" />
        <input ref={inputRef} enterKeyHint="search" autoComplete="off" id="transaction-query" type="search"
          placeholder="Merchant, bank or amount" value={query}
          onChange={event => { setQuery(event.target.value); setLimit(pageSize); }} />
        {query && <button type="button" aria-label="Clear search" onClick={() => {
          setQuery(""); setLimit(pageSize); inputRef.current?.focus();
        }}><X size={18} aria-hidden="true" /></button>}
        <button type="button" className={startDate || endDate ? "has-date-filter" : undefined} aria-label="Date filters" aria-haspopup="dialog" aria-expanded={datesOpen} aria-controls="transaction-date-filters"
          onClick={() => setDatesOpen(value => !value)}><CalendarDays size={20} aria-hidden="true" /></button>
      </form>
      <div className="transaction-search-filters" role="group" aria-label="Transaction category">
        {categories.map(item => {
          const Icon = categoryIcons[item];
          return <button key={item} type="button" aria-pressed={category === item}
            onClick={() => { setCategory(item); setLimit(pageSize); }}>
            <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>{item}</span>
          </button>;
        })}
      </div>
      <div className="transaction-search-active-filters">
        {(startDate || endDate) && <button type="button" className="transaction-search-range-chip" onClick={clearDates}
          aria-label="Remove date range"><CalendarDays size={15} aria-hidden="true" /><span>{startDate || "Any date"} – {endDate || "Any date"}</span><X size={14} aria-hidden="true" /></button>}
        {hasFilters && <button type="button" className="transaction-search-clear-all" onClick={clear}>Clear all</button>}
      </div>
      <MoreOpen
        isClicked={datesOpen}
        setIsClicked={() => setDatesOpen(false)}
        dialogLabel="Date filters"
        sheetHeight="auto"
        zIndex={125}
        overflow="auto"
        feed={() => (
          <div id="transaction-date-filters" className="transaction-date-popup">
            <div className="transaction-date-popup-header">
              <h2>Date filters</h2>
            </div>
            <div className="transaction-date-shortcuts" role="group" aria-label="Quick date ranges">
              {quickDateRanges().map(range => (
                <button key={range.label} type="button"
                  aria-pressed={startDate === range.start && endDate === range.end}
                  onClick={() => { setStartDate(range.start); setEndDate(range.end); setLimit(pageSize); setDatesOpen(false); }}>
                  <span className="transaction-date-shortcut-top"><CalendarDays size={17} aria-hidden="true" /><span>{range.label}</span>
                    <Check className="transaction-date-shortcut-check" size={16} aria-hidden="true" />
                  </span>
                  <span className="transaction-date-shortcut-caption" aria-hidden="true">{shortDate(range.start)}{range.start !== range.end ? ` – ${shortDate(range.end)}` : ""}</span>
                </button>
              ))}
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
            <button type="button" className="transaction-date-done" disabled={invalidRange}
              onClick={() => setDatesOpen(false)}>Done</button>
          </div>
        )}
      />
      {!datesOpen && invalidRange && <p className="transaction-search-date-error" role="alert">Choose an end date on or after the start date.</p>}
      <div className="transaction-search-results">
        {results.slice(0, limit).map((transaction, index) => {
          const flow = String(transaction.AccountFlow || "").toUpperCase();
          const isIncome = transaction.Category === "Income" || ["income", "credit"].includes(String(transaction.Type || "").toLowerCase());
          const direction = transaction.Category === "Internal" ? "neutral"
            : flow === "IN" ? "in" : flow === "OUT" ? "out" : isIncome ? "in" : "out";
          const group = dateGroup(transaction.Timestamp);
          return (
            <Fragment key={transaction.id || `${transaction.Timestamp}-${index}`}>
            {(index === 0 || group !== dateGroup(results[index - 1].Timestamp)) && <h2 className="transaction-search-date-group">{group}</h2>}
            <button type="button" className="transaction-search-result AccountTransactions_Row"
              key={transaction.id || `${transaction.Timestamp}-${index}`}
              onClick={() => setViewingTransaction(transaction)} aria-haspopup="dialog">
              <span className="AccountTransactions_Icon" aria-hidden="true">
                {getTransactionIcon(transaction.Category, transaction.Label)}
              </span>
              <span className="AccountTransactions_Reason">
                <strong>{highlight(getTransactionDisplayReason(transaction.Reason, transaction.Label), query)}</strong>
                <span>{transactionDate(transaction.Timestamp)}</span>
              </span>
              <span className={`AccountTransactions_Amount ${direction}`}>
                <strong>{direction === "neutral" ? "" : direction === "in" ? "+" : "−"}{money(transaction)}</strong>
                <span>{direction === "neutral" ? "transfer" : direction === "in" ? "in" : "out"}</span>
              </span>
            </button>
            </Fragment>
          );
        })}
        {!results.length && !invalidRange && <div className="transaction-search-empty">
          <Search size={28} aria-hidden="true" />
          <h2>{transactions.length ? "No matching transactions" : "No transactions yet"}</h2>
          <p>{transactions.length ? "Try a different merchant, a shorter phrase, or another category, or a wider date range." : "Your transactions will appear here once they’re added."}</p>
          {(query || category !== "All" || startDate || endDate) && <button type="button" onClick={clear}>Clear search and filters</button>}
        </div>}
        {results.length > limit && <div ref={sentinelRef}><button className="transaction-search-more" type="button"
          onClick={() => setLimit(value => value + pageSize)}>Show more transactions</button></div>}
      </div>
      <TransactionDetailModal
        transaction={viewingTransaction}
        onClose={() => setViewingTransaction(null)}
        onTransactionUpdated={setViewingTransaction}
      />
    </motion.section>
  );
}
