import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PendingTransferBalance from './PendingTransferBalance';

describe('pending transfer balances', () => {
    it('labels pending cash separately and explains snapshot uncertainty', () => {
        render(<PendingTransferBalance account={{ currency: 'CAD', pendingTransfers: [{ transactionId: 1 }],
            pendingCashDeltaMinor: -2500, estimatedCashMinor: 7500 }} />);
        expect(screen.getByText(/awaiting bank confirmation/)).toBeInTheDocument();
        expect(screen.getByText(/Pending cash change.*Estimated cash/)).toBeInTheDocument();
        expect(screen.getByText(/may already be included in the bank snapshot/)).toBeInTheDocument();
    });
    it('shows a review reason instead of converting an unavailable estimate to zero', () => {
        render(<PendingTransferBalance account={{ currency: 'USD', pendingTransfers: [{ transactionId: 1, reason: 'Exchange rate required' }],
            pendingCashDeltaMinor: null, estimatedCashMinor: null, pendingBalanceReviewRequired: true }} />);
        expect(screen.getByText(/Estimate unavailable/)).toBeInTheDocument();
        expect(screen.getByText('Exchange rate required')).toBeInTheDocument();
        expect(screen.queryByText(/Estimated cash:/)).not.toBeInTheDocument();
    });
});
