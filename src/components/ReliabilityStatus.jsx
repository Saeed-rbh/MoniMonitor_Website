import React, { useEffect, useState } from 'react';
import { getReliabilityAPI, transactionReviewAPI } from '../services/apiService';

export default function ReliabilityStatus() {
  const [report, setReport] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => getReliabilityAPI().then(value => { if (active) setReport(value); }).catch(() => { if (active) setError('Could not load transactions. Please try again.'); });
    load(); const timer = setInterval(load, 60000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const open = async id => {
    setBusy(true); setError('');
    try { setReview(await transactionReviewAPI(id)); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const answer = async value => {
    if (value === 'later') { setReview(null); return; }
    setBusy(true); setError('');
    try {
      setReview(await transactionReviewAPI(review.transaction.id, { issueKey: review.issueKey, fingerprint: review.fingerprint, answer: value }));
      setReport(await getReliabilityAPI()); setPage(0);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const cards = report?.cards || [];
  const visible = cards.slice(page * 5, page * 5 + 5);
  const cardStyle = { border: '1px solid var(--border-color, #8885)', borderRadius: 12, padding: 12, marginBottom: 10 };
  return <section aria-label="Transactions to review" style={{ width: '100%', marginBottom: '1rem' }}>
    <h2 style={{ fontSize: '1rem' }}>Transactions to review</h2>
    {error && <p role="alert">{error}</p>}
    {!report && <p role="status">Loading transactions…</p>}
    {review ? <div style={cardStyle}>
      <strong>{review.transaction.Reason || review.transaction.Label || 'Transaction'}</strong>
      <p>{review.transaction.Currency} {Number(review.transaction.Amount).toFixed(2)} · {review.transaction.Timestamp?.slice(0, 10)} · {review.transaction.Account || review.transaction.BankName}</p>
      <p role="status">{review.resolved ? 'Your review is complete. No open questions remain for this transaction.' : review.question}</p>
      {review.options.map(option => <button key={option.value} disabled={busy} onClick={() => answer(option.value)} style={{ display: 'block', marginBottom: 8 }}>{option.label}</button>)}
      <button disabled={busy} onClick={() => setReview(null)}>Back to transactions</button>
    </div> : report && <>
      <p>{cards.length ? `${cards.length} transactions need a quick check. Choose one to answer a question.` : 'No transactions need your review.'}</p>
      {visible.map(card => <article key={card.id} style={cardStyle}>
        <strong>{card.title}</strong>
        <p>{card.currency} {card.amount.toFixed(2)} · {card.date?.slice(0, 10)} · {card.account}</p>
        <button disabled={busy} onClick={() => open(card.id)}>Review transaction</button>
      </article>)}
      {cards.length > 5 && <div>
        <button disabled={page === 0 || busy} onClick={() => setPage(page - 1)}>Previous</button>
        <span> {page + 1} / {Math.ceil(cards.length / 5)} </span>
        <button disabled={(page + 1) * 5 >= cards.length || busy} onClick={() => setPage(page + 1)}>Next</button>
      </div>}
      {report.issues.some(i => !i.transactionId) && <p>An account balance needs statement verification. Open the account to compare its statement balance.</p>}
    </>}
  </section>;
}
