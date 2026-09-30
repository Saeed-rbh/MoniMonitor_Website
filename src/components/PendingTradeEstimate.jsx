import React from 'react';

export default function PendingTradeEstimate({ account }) {
    const money = (minor) => new Intl.NumberFormat(undefined, {
        style: 'currency', currency: account.currency || 'CAD',
    }).format(minor / 100);
    return <>
        {account.holdingsSource === 'plaid' && account.holdingsAsOf &&
            <p>Bank holdings imported {new Date(account.holdingsAsOf).toLocaleString()}.</p>}
        {account.holdingsReviewReason && <p role="status">Holdings need review: {account.holdingsReviewReason}</p>}
        {account.pendingTrades?.length > 0 && <section aria-label="Pending trade estimates">
            <p>Recent email trades</p>
            <ul>{account.pendingTrades.map((trade) => <li key={trade.transactionId}>
                {trade.action} {trade.quantity ?? 'unknown quantity'} {trade.symbol || 'unknown security'}:
                {' '}{trade.status === 'already_posted' ? 'included in the manual balance and holdings' : trade.status === 'review_required' ? 'needs review' : 'awaiting bank confirmation'}.
                {trade.reason && <span role="status"> {trade.reason}</span>}
            </li>)}</ul>
            {account.pendingTradeHoldings?.map((holding) => <p key={holding.symbol}>
                {holding.symbol}: recorded {holding.recordedQuantity} shares;
                {' '}pending change {holding.quantityDelta > 0 ? '+' : ''}{holding.quantityDelta};
                {' '}estimated {holding.estimatedQuantity} shares.
                {holding.reason && <span role="status"> {holding.reason}</span>}
            </p>)}
            {account.pendingTrades.some((trade) => trade.status !== 'already_posted') &&
                (account.estimatedCashWithTradesMinor === null
                    ? <p role="status">Cash estimate unavailable until the trade or balance is reviewed.</p>
                    : <p>Pending trade cash change: {money(account.pendingTradeCashDeltaMinor)}.
                        {' '}Estimated cash including pending transfers and trades: {money(account.estimatedCashWithTradesMinor)}.</p>)}
            {account.pendingTradeReviewRequired && <p role="status">These trade estimates need review.</p>}
            <p>Bank snapshots may already include these trades. Estimates do not change recorded cash, holdings, or portfolio totals.</p>
        </section>}
    </>;
}

export function PendingTradeReviewItems({ trades = [] }) {
    if (!trades.length) return null;
    return <section aria-label="Trades needing an account">
        <p role="status">Some recent email trades need an account before an estimate can be shown.</p>
        <ul>{trades.map((trade) => <li key={trade.transactionId}>
            {trade.action} {trade.symbol || 'unknown security'}: {trade.reason}.
        </li>)}</ul>
    </section>;
}
