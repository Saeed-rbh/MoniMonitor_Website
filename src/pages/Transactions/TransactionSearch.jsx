import React, { useMemo, useRef, useState } from "react";
import { Search, X, ChevronDown, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useTransactions } from "../../context/TransactionContext";
import "./TransactionSearch.css";

const categories = ["All", "Expense", "Income", "Save & invest"];
const pageSize = 30;

export default function TransactionSearch() {
  const { allTransactions } = useTransactions();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [limit, setLimit] = useState(pageSize);
  const inputRef = useRef(null);
  const transactions = useMemo(() => Object.values(allTransactions || {})
    .flatMap(month => month.transactions || [])
    .sort((a, b) => String(b.Timestamp).localeCompare(String(a.Timestamp))), [allTransactions]);
  const results = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return transactions.filter(transaction => {
      const matchesCategory = category === "All" || (category === "Save & invest"
        ? ["Saving", "Save&Invest", "Investment"].includes(transaction.Category)
        : transaction.Category === category);
      const text = [transaction.Reason, transaction.Label, transaction.Amount,
        transaction.BankName, transaction.Category, transaction.Type, transaction.Timestamp]
        .filter(value => value != null).join(" ").toLocaleLowerCase();
      return matchesCategory && terms.every(term => text.includes(term));
    });
  }, [transactions, query, category]);

  const clear = () => {
    setQuery("");
    setCategory("All");
    setLimit(pageSize);
    inputRef.current?.focus();
  };

  return (
    <section className="transaction-search" aria-labelledby="transaction-search-title">
      <header>
        <h1 id="transaction-search-title">Transactions</h1>
        <p>All your activity, in one place.</p>
      </header>
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
      <p className="transaction-search-count" role="status">
        {results.length} {results.length === 1 ? "transaction" : "transactions"}
        {query.trim() ? " found" : " · Newest first"}
      </p>
      <div className="transaction-search-results">
        {results.slice(0, limit).map((transaction, index) => (
          <details className="transaction-search-result" key={transaction.id || `${transaction.Timestamp}-${index}`}>
            <summary>
              <span className={`transaction-search-category ${transaction.Category === "Income" ? "is-income" : ""}`} aria-hidden="true">
                {transaction.Category === "Income" ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
              </span>
              <span className="transaction-search-description">
                <strong>{transaction.Reason || transaction.Label || "Transaction"}</strong>
                <span>{String(transaction.Timestamp || "").slice(0, 10)} · {transaction.Label || transaction.Category}</span>
              </span>
              <strong className="transaction-search-amount">
                {transaction.Category === "Income" ? "+" : "−"}${Math.abs(Number(transaction.Amount) || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>
              <ChevronDown className="transaction-search-chevron" size={16} aria-hidden="true" />
            </summary>
            <dl>
              <div><dt>Category</dt><dd>{transaction.Category || "Uncategorized"}</dd></div>
              <div><dt>Bank</dt><dd>{transaction.BankName || "Not specified"}</dd></div>
              <div><dt>Date</dt><dd>{transaction.Timestamp || "Not specified"}</dd></div>
              {transaction.Type && <div><dt>Type</dt><dd>{transaction.Type}</dd></div>}
            </dl>
          </details>
        ))}
        {!results.length && <div className="transaction-search-empty">
          <Search size={28} aria-hidden="true" />
          <h2>{transactions.length ? "No matching transactions" : "No transactions yet"}</h2>
          <p>{transactions.length ? "Try a different merchant, a shorter phrase, or another category." : "Your transactions will appear here once they’re added."}</p>
          {(query || category !== "All") && <button type="button" onClick={clear}>Clear search and filters</button>}
        </div>}
        {results.length > limit && <button className="transaction-search-more" type="button"
          onClick={() => setLimit(value => value + pageSize)}>Show more transactions</button>}
      </div>
    </section>
  );
}
