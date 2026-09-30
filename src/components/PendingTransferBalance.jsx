import React from 'react';

export default function PendingTransferBalance({ account }) {
    if (!account.pendingTransfers?.length) return null;
    const money = (minor) => new Intl.NumberFormat(undefined, { style: 'currency', currency: account.currency || 'CAD' }).format(minor / 100);
    return <div aria-label="Pending transfer estimate">
        <p>{account.pendingTransfers.length} transfer{account.pendingTransfers.length === 1 ? '' : 's'} awaiting bank confirmation.</p>
        {account.estimatedCashMinor === null
            ? <p role="status">Estimate unavailable until the transfer or balance is reviewed.</p>
            : <p>Pending cash change: {money(account.pendingCashDeltaMinor)}. Estimated cash: {money(account.estimatedCashMinor)}.</p>}
        <p>Estimates may already be included in the bank snapshot. Confirmed totals use the recorded balance.</p>
        {account.pendingBalanceReviewRequired && <p role="status">This estimate needs review.</p>}
        {account.pendingTransfers.filter((transfer) => transfer.reason).map((transfer) =>
            <p key={transfer.transactionId} role="status">{transfer.reason}</p>)}
    </div>;
}
