import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import PendingTradeEstimate, { PendingTradeReviewItems } from './PendingTradeEstimate';
afterEach(cleanup);

test('shows separate trade projections and explains that recorded totals remain unchanged', () => {
    render(<PendingTradeEstimate account={{ currency: 'CAD', pendingTrades: [{ transactionId: 1, action: 'BUY', symbol: 'ABC', quantity: 1, status: 'pending' }],
        pendingTradeHoldings: [{ symbol: 'ABC', recordedQuantity: 10, quantityDelta: 1, estimatedQuantity: 11 }],
        pendingTradeCashDeltaMinor: -2000, estimatedCashWithTradesMinor: 98000 }} />);
    expect(screen.getByText(/recorded 10 shares/)).toBeInTheDocument();
    expect(screen.getByText(/estimated 11 shares/)).toBeInTheDocument();
    expect(screen.getByText(/awaiting bank confirmation/)).toBeInTheDocument();
    expect(screen.getByText(/Estimates do not change recorded cash/)).toBeInTheDocument();
});

test('shows unavailable estimates and review reasons without formatting null as zero', () => {
    render(<PendingTradeEstimate account={{ currency: 'USD', pendingTrades: [{ transactionId: 1, action: 'SELL', symbol: 'ABC', quantity: 12,
        status: 'review_required', reason: 'The holding currency differs from the trade currency' }],
        pendingTradeHoldings: [], pendingTradeReviewRequired: true, estimatedCashWithTradesMinor: null }} />);
    expect(screen.getByText(/Cash estimate unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/holding currency differs/)).toBeInTheDocument();
    expect(screen.queryByText(/Estimated cash including/)).not.toBeInTheDocument();
});

test('manual postings do not present a second pending cash estimate', () => {
    render(<PendingTradeEstimate account={{ pendingTrades: [{ transactionId: 1, action: 'BUY', quantity: 1, symbol: 'ABC', status: 'already_posted' }] }} />);
    expect(screen.getByText(/included in the manual balance/)).toBeInTheDocument();
    expect(screen.queryByText(/Pending trade cash change/)).not.toBeInTheDocument();
});

test('missing account and legacy holdings uncertainty remain visible for review', () => {
    render(<><PendingTradeReviewItems trades={[{ transactionId: 1, action: 'BUY', symbol: 'ABC', reason: 'The trade account needs confirmation' }]} />
        <PendingTradeEstimate account={{ holdingsReviewReason: 'Refresh bank holdings', pendingTrades: [] }} /></>);
    expect(screen.getByText(/trade account needs confirmation/)).toBeInTheDocument();
    expect(screen.getByText(/Holdings need review: Refresh bank holdings/)).toBeInTheDocument();
});
