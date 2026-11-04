import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import SaveInvestInsights from './SaveInvestInsights';
import SaveInvest from './SaveInvest';
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('recharts', () => Object.fromEntries(['Bar', 'BarChart', 'CartesianGrid', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map(key => [key, () => null])));
const cad = { currency: 'CAD', totalValueMinor: 10000, totalCashMinor: 10000, holdingsValueMinor: 0, totalLiabilitiesMinor: 0, gainLossMinor: 0 };
const usd = { ...cad, currency: 'USD', totalValueMinor: 25000, totalCashMinor: 25000 };
vi.mock('../../services/apiService', () => ({ getPortfolioAPI: async () => ({ totalsByCurrency: [cad, usd], accounts: [], emailActivities: [] }) }));
vi.mock('../../context/TransactionContext', () => ({ useTransactions: () => ({ allTransactions: { '2026-10': { transactions: [{ id: 1, Category: 'Saving', Currency: 'CAD', Amount: 10, Timestamp: '2026-10-02T12:00:00Z' }, { id: 3, Category: 'Saving', Currency: 'CAD', Amount: 10, PortfolioAction: 'BUY', Reason: 'Trade purchase', Timestamp: '2026-10-02T12:00:00Z' }, { id: 4, Category: 'Saving', Currency: 'CAD', Amount: 15, PortfolioAction: 'SELL', Reason: 'Trade sale', Timestamp: '2026-10-02T12:00:00Z' }, { id: 2, Category: 'Saving', Currency: 'CAD', Amount: 500, PortfolioAction: 'TRANSFER', Timestamp: '2026-10-02T12:00:00Z' }] } }, monthData: {}, setIsMoreClicked: vi.fn() }) }));
afterEach(cleanup);
test('account overview labels separate currency totals', async () => {
    render(<SaveInvest />);
    expect(await screen.findByText('Net account value · CAD')).toBeTruthy();
    expect(screen.getByText('Net account value · USD')).toBeTruthy();
    expect(screen.queryByText(/350\.00/)).toBeNull();
});
test('insights switches portfolio totals to the selected currency', async () => {
    render(<SaveInvestInsights />);
    await screen.findByRole('option', { name: 'CAD' });
    expect(screen.getByRole('heading', { level: 2, name: /100\.00/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Portfolio currency'), { target: { value: 'USD' } });
    expect(screen.getByText('Net account value · USD')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /250\.00/ })).toBeTruthy();
});

test('insights contribution total excludes internal transfers', async () => {
    render(<SaveInvestInsights />);
    await screen.findByRole('option', { name: 'CAD' });
    const metric = screen.getByText('All-time recorded').closest('article');
    expect(metric.textContent).toContain('10.00');
    expect(metric.textContent).not.toContain('510.00');
    expect(metric.textContent).toContain('1 contribution entries');
});

test('trade activity remains visible without increasing contribution totals', async () => {
 render(<SaveInvestInsights />);
 await screen.findByRole('option', { name: 'CAD' });
 expect(screen.getByText(/Trade purchase.*Buy/)).toBeTruthy();
 expect(screen.getByText(/Trade sale.*Sell/)).toBeTruthy();
 const metric=screen.getByText('All-time recorded').closest('article');
 expect(metric.textContent).toContain('10.00');
 expect(metric.textContent).toContain('1 contribution entries');
});
