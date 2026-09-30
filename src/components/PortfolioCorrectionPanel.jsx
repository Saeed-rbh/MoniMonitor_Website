import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPortfolioCorrectionAPI, submitPortfolioCorrectionAPI } from '../services/apiService';
import semantics from '../../shared/financialSemantics.cjs';

export default function PortfolioCorrectionPanel({ transaction, onCorrected }) {
    const [preview, setPreview] = useState(null);
    const [reason, setReason] = useState('');
    const [verified, setVerified] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [trade, setTrade] = useState({ action: 'BUY', symbol: '', quantity: '', price: '', amount: '' });
    useEffect(() => {
        let active = true;
        setPreview(null); setVerified(false); setReason(''); setMessage('');
        if (transaction?.id && ['Investment', 'Saving', 'SavingWithdrawal'].includes(transaction.Category)) {
            getPortfolioCorrectionAPI(transaction.id).then(data => {
                if (!active) return;
                setPreview(data);
                if (data) setTrade({ action: data.source.action || 'BUY', symbol: data.source.symbol || '',
                    quantity: String(data.source.quantity ?? ''), price: String(data.source.price ?? ''),
                    amount: String((data.source.amountMinor || 0) / 100) });
            }).catch(() => { if (active) setMessage('Could not load the portfolio correction preview. Reopen this transaction to retry.'); });
        }
        return () => { active = false; };
    }, [transaction?.id, transaction?.Category, refresh]);

    const submit = async action => {
        setBusy(true); setMessage('');
        try {
            const input = { token: preview.token, reason, verifiedBaseline: verified };
            if (action === 'correct') input.correction = { action: trade.action, symbol: trade.symbol.trim().toUpperCase(),
                quantity: Number(trade.quantity), price: Number(trade.price), amountMinor: semantics.toMinorUnits(trade.amount) };
            const result = await submitPortfolioCorrectionAPI(transaction.id, action, input);
            setPreview(await getPortfolioCorrectionAPI(transaction.id));
            setVerified(false);
            setMessage(result.corrected ? 'Trade corrected. Cash, shares and cost basis updated together.'
                : result.preservedBaseline ? 'History reversed. The reviewed or newer bank baseline was preserved.'
                    : 'Activity reversed. Original shares and cost basis restored.');
            window.dispatchEvent(new Event('monimonitor-portfolio-changed'));
            onCorrected?.(result.data || transaction);
        } catch (error) { setMessage(error.message || 'Correction failed. Refresh the preview and try again.'); }
        finally { setBusy(false); }
    };
    if (!preview && !message) return null;
    const ready = reason.trim().length >= 3 && !busy && (!preview?.requiresBaselineReview || verified);
    const field = { width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' };
    return <section className="TxDetail_SourceSection" aria-label="Portfolio correction">
        <h3>Portfolio correction</h3>
        {message && <p role="status">{message}</p>}
        {message && <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh correction preview</button>}
        {preview?.reversedAt ? <p>This activity was reversed on {new Date(preview.reversedAt).toLocaleString()}. Its history is retained.</p> : preview && <>
            <p>{preview.kind.replace('EMAIL_', '')} · {preview.accountName}</p>
            <p>Reversing this record keeps its source evidence and audit history.</p>
            {(preview.cashAbsorbed || preview.holdingsAbsorbed) && <p>Newer bank or replacement balances will be preserved.</p>}
            {preview.requiresBaselineReview && <>
                <p>{preview.reason}</p>
                <p><Link to="/Accounts/Manage">Review cash and holdings</Link> before confirming the baseline below.</p>
                <label><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} />
                    I reviewed the current cash and all holdings. Keep this baseline and reverse only the history record.</label>
            </>}
            <label>Correction reason<textarea aria-label="Portfolio correction reason" value={reason}
                onChange={event => setReason(event.target.value)} maxLength={500} style={field} /></label>
            <button type="button" disabled={!ready} onClick={() => submit('reverse')}>Reverse recorded portfolio activity</button>
            {preview.canCorrect && <details>
                <summary>Correct and repost trade</summary>
                <label>Action<select aria-label="Corrected trade action" value={trade.action} onChange={event => setTrade({ ...trade, action: event.target.value })} style={field}>
                    <option value="BUY">Buy</option><option value="SELL">Sell</option></select></label>
                {['symbol', 'quantity', 'price', 'amount'].map(key => <label key={key}>Corrected {key}
                    <input aria-label={`Corrected trade ${key}`} type={key === 'symbol' ? 'text' : 'number'}
                        min={key === 'symbol' ? undefined : '0'} step="any" value={trade[key]}
                        onChange={event => setTrade({ ...trade, [key]: event.target.value })} style={field} /></label>)}
                <button type="button" disabled={!ready} onClick={() => submit('correct')}>Apply corrected trade</button>
            </details>}
        </>}
    </section>;
}
