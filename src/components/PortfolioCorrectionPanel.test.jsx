import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PortfolioCorrectionPanel from './PortfolioCorrectionPanel';
import { getPortfolioCorrectionAPI, submitPortfolioCorrectionAPI } from '../services/apiService';
vi.mock('../services/apiService', () => ({ getPortfolioCorrectionAPI: vi.fn(), submitPortfolioCorrectionAPI: vi.fn() }));
const transaction = { id: 9, Category: 'Investment' };
const preview = { token: 'a'.repeat(64), kind: 'EMAIL_BUY', accountName: 'TFSA', canCorrect: true,
    source: { action: 'BUY', symbol: 'ABC', quantity: 2, price: 10, amountMinor: 2000 } };
const show = (callback = vi.fn()) => render(<MemoryRouter><PortfolioCorrectionPanel transaction={transaction} onCorrected={callback} /></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); getPortfolioCorrectionAPI.mockResolvedValue(preview); });
describe('Portfolio corrections', () => {
    it('requires a reason and explicit acknowledgement for a reviewed baseline', async () => {
        getPortfolioCorrectionAPI.mockResolvedValue({ ...preview, requiresBaselineReview: true, reason: 'Review legacy holdings', canCorrect: false });
        show();
        const button = await screen.findByRole('button', { name: 'Reverse recorded portfolio activity' });
        expect(button.disabled).toBe(true);
        fireEvent.change(screen.getByLabelText('Portfolio correction reason'), { target: { value: 'Duplicate entry' } });
        expect(button.disabled).toBe(true);
        fireEvent.click(screen.getByRole('checkbox'));
        expect(button.disabled).toBe(false);
        expect(submitPortfolioCorrectionAPI).not.toHaveBeenCalled();
    });
    it('posts exact correction amounts and refreshes the owning views after success', async () => {
        const updated = { ...transaction, AmountMinor: 1200 };
        submitPortfolioCorrectionAPI.mockResolvedValue({ corrected: true, data: updated });
        const callback = vi.fn();
        show(callback);
        await screen.findByLabelText('Portfolio correction reason');
        fireEvent.change(screen.getByLabelText('Portfolio correction reason'), { target: { value: 'Correct quantity' } });
        fireEvent.change(screen.getByLabelText('Corrected trade quantity'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Corrected trade price'), { target: { value: '12' } });
        fireEvent.change(screen.getByLabelText('Corrected trade amount'), { target: { value: '12.00' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply corrected trade' }));
        await waitFor(() => expect(callback).toHaveBeenCalledWith(updated));
        expect(submitPortfolioCorrectionAPI).toHaveBeenCalledWith(9, 'correct', { token: preview.token, reason: 'Correct quantity', verifiedBaseline: false,
            correction: { action: 'BUY', symbol: 'ABC', quantity: 1, price: 12, amountMinor: 1200 } });
    });
    it('shows conflicts without reporting success and lets the user obtain a fresh preview', async () => {
        submitPortfolioCorrectionAPI.mockRejectedValue(new Error('Account changed. Refresh the correction preview.'));
        const callback = vi.fn(); show(callback);
        await screen.findByLabelText('Portfolio correction reason');
        fireEvent.change(screen.getByLabelText('Portfolio correction reason'), { target: { value: 'Duplicate entry' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reverse recorded portfolio activity' }));
        await screen.findByText('Account changed. Refresh the correction preview.');
        expect(callback).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh correction preview' }));
        await waitFor(() => expect(getPortfolioCorrectionAPI).toHaveBeenCalledTimes(2));
        expect(screen.getByLabelText('Portfolio correction reason').value).toBe('');
    });
});
