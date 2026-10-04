import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import ReliabilityStatus from './ReliabilityStatus';
import { getReliabilityAPI, transactionReviewAPI } from '../services/apiService';
vi.mock('../services/apiService', () => ({ getReliabilityAPI: vi.fn(), transactionReviewAPI: vi.fn() }));
test('transaction card opens a question and saves its answer with evidence token', async () => {
  getReliabilityAPI.mockResolvedValue({ issues: [], cards: [{ id: 1, title: 'Google Cloud', amount: 19.96, currency: 'CAD', date: '2026-09-29', account: 'Credit card' }] });
  transactionReviewAPI.mockResolvedValueOnce({ transaction: { id: 1, Reason: 'Google Cloud', Amount: 19.96, Currency: 'CAD' }, issueKey: 'refund_direction:1', fingerprint: 'evidence', question: 'Was this a refund?', options: [{ value: 'refund', label: 'It was a refund' }] }).mockResolvedValueOnce({ transaction: { id: 1, Amount: 19.96, Currency: 'CAD' }, resolved: true, options: [] });
  render(<ReliabilityStatus />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review transaction' }));
  expect(await screen.findByText('Was this a refund?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'It was a refund' }));
  await waitFor(() => expect(transactionReviewAPI).toHaveBeenLastCalledWith(1, { issueKey: 'refund_direction:1', fingerprint: 'evidence', answer: 'refund' }));
  expect(await screen.findByText(/Your review is complete/)).toBeTruthy();
});
