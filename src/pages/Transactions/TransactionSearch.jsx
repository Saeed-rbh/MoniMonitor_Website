import { matchesReportingCategory, isInvestTransaction } from "../../services/transactionService";
import TransactionRow from "../../components/TransactionRow";
import React, { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import DateRangeCalendar, { validCalendarDate } from "./DateRangeCalendar";
import MoreOpen from "../../components/MoreOpen/MoreOpen";
import { Search, X, CalendarDays, CalendarCheck, CalendarRange, History, ArrowDownLeft, ArrowUpRight, Landmark, Layers } from "lucide-react";
import { useTransactions } from "../../context/TransactionContext";
import TransactionDetailModal from "../../components/TransactionDetailModal/TransactionDetailModal";
import { getTransactionIcon } from "../../components/Categories";
import { getTransactionDisplayReason } from "../../utils/transactionDisplay";
import { parseTransactionDate, parseTransactionCalendarDate, isDateOnlyTransactionTimestamp } from "../../utils/transactionDate";
import "../../components/TransactionRow.css";
import "./TransactionSearch.css";

const categories = ["All", "Expense", "Income", "Invest"];
const categoryIcons = { All: Layers, Expense: ArrowUpRight, Income: ArrowDownLeft, "Invest": Landmark };
const shortDate = value => parseTransactionCalendarDate(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const compactRange = range => range.start === range.end ? shortDate(range.start)
  : `${shortDate(range.start)}–${range.start.slice(0, 7) === range.end.slice(0, 7) ? Number(range.end.slice(-2)) : shortDate(range.end)}`;
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
    { label: "This month", from: new Date(year, month, 1), to: today },
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
  const invalidDate = Boolean((startDate && !validCalendarDate(startDate)) || (endDate && !validCalendarDate(endDate)));
  const invalidRange = invalidDate || Boolean(startDate && endDate && startDate > endDate);
  const dateError = invalidDate ? "Enter a valid date as YYYY-MM-DD, or select a day below." : "Choose an end date on or after the start date.";
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
  const availableDates = useMemo(() => new Set(transactions.flatMap(transaction => {
    const date = parseTransactionCalendarDate(transaction.Timestamp);
    return Number.isNaN(date.getTime()) ? [] : [dateInputValue(date)];
  })), [transactions]);
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
      const matchesCategory = category === "All" || (category === "Invest"
        ? isInvestTransaction(transaction)
        : matchesReportingCategory(transaction, category));
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
          return <button key={item} type="button" data-category={item} aria-pressed={category === item}
            onClick={() => { setCategory(item); setLimit(pageSize); }}>
            <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>{item}</span>
          </button>;
        })}
      </div>
      <div className="transaction-search-active-filters">
        {(startDate || endDate) && <button type="button" className="transaction-search-range-chip" onClick={clearDates}
          aria-label="Remove date range"><CalendarDays size={15} aria-hidden="true" /><span>{startDate && startDate === endDate ? startDate : `${startDate || "Any date"} – ${endDate || "Any date"}`}</span><X size={14} aria-hidden="true" /></button>}
        {Boolean(query || startDate || endDate) && <button type="button" className="transaction-search-clear-all" onClick={clear}>Clear all</button>}
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
              {quickDateRanges().map((range, index) => {
                const Icon = [CalendarCheck, History, CalendarDays, CalendarRange][index];
                return (
                <button key={range.label} type="button" aria-label={range.label} title={range.label}
                  aria-pressed={startDate === range.start && endDate === range.end}
                  onClick={() => { setStartDate(range.start); setEndDate(range.end); setLimit(pageSize); setDatesOpen(false); }}>
                  <span className="transaction-date-shortcut-top"><Icon size={16} aria-hidden="true" /><span>{compactRange(range)}</span>
                  </span>
                </button>
              );
              })}
            </div>
            <DateRangeCalendar availableDates={availableDates} onComplete={() => setDatesOpen(false)} start={startDate} end={endDate}
              onChange={(start, end) => { setStartDate(start); setEndDate(end); setLimit(pageSize); }} />
            {(startDate || endDate) && <button type="button" className="transaction-search-date-reset" onClick={clearDates}>Clear dates</button>}
      {invalidRange && <p id="transaction-date-error" className="transaction-search-date-error" role="alert">{dateError}</p>}
          </div>
        )}
      />
      {!datesOpen && invalidRange && <p className="transaction-search-date-error" role="alert">{dateError}</p>}
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
            <TransactionRow className="transaction-search-result"
              onClick={() => setViewingTransaction(transaction)} aria-haspopup="dialog"
              icon={getTransactionIcon(transaction.Category, transaction.Label)}
              reason={highlight(getTransactionDisplayReason(transaction.Reason, transaction.Label), query)}
              date={transactionDate(transaction.Timestamp)} direction={direction} investment={isInvestTransaction(transaction)} amount={money(transaction)}
            />
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
