import React, { act } from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { vi, beforeEach, afterEach, test, expect } from 'vitest';
import Account from './Account';
import * as api from '../../services/apiService';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { username: 'test' }, logout: vi.fn() }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../components/ui/blur-fade', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../services/apiService', () => ({
    createBackupAPI: vi.fn(), createPlaidLinkTokenAPI: vi.fn(), disconnectPlaidItemAPI: vi.fn(),
    downloadBackupAPI: vi.fn(), exchangePlaidPublicTokenAPI: vi.fn(), GetDataFromDB: vi.fn(),
    getBackupStatusAPI: vi.fn(), getPlaidStatusAPI: vi.fn(), getSettingsAPI: vi.fn(),
    restoreBackupAPI: vi.fn(), saveSettingsAPI: vi.fn(), syncPlaidAPI: vi.fn(),
}));

let linkOptions;
const item = { itemId: 'cibc-item', institutionName: 'CIBC', status: 'login_required', accountCount: 1 };

beforeEach(() => {
    vi.clearAllMocks();
    api.getSettingsAPI.mockResolvedValue({});
    api.getBackupStatusAPI.mockResolvedValue({});
    api.getPlaidStatusAPI.mockResolvedValue({ configured: true, items: [item] });
    api.createPlaidLinkTokenAPI.mockResolvedValue({ linkToken: 'link-test' });
    api.syncPlaidAPI.mockResolvedValue({ results: [{ itemId: item.itemId, ok: true }] });
    window.Plaid = { create: vi.fn((options) => {
        linkOptions = options;
        return { open: vi.fn(), destroy: vi.fn() };
    }) };
});

afterEach(() => { cleanup(); delete window.Plaid; });

test('reconnect repairs the existing connection without exchanging a public token', async () => {
    render(<Account />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(window.Plaid.create).toHaveBeenCalled());
    await act(async () => { await linkOptions.onSuccess(null, {}); });
    expect(api.createPlaidLinkTokenAPI).toHaveBeenCalledWith(item.itemId);
    expect(api.exchangePlaidPublicTokenAPI).not.toHaveBeenCalled();
    expect(api.syncPlaidAPI).toHaveBeenCalledOnce();
    expect(await screen.findByText('Bank reconnected. Missing transactions are now covered by Plaid.')).toBeInTheDocument();
});

test('a failed sync after verification is reported instead of successful reconnection', async () => {
    api.syncPlaidAPI.mockResolvedValue({ results: [{ itemId: item.itemId, ok: false, error: 'Institution unavailable' }] });
    render(<Account />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(window.Plaid.create).toHaveBeenCalled());
    await act(async () => { await linkOptions.onSuccess(null, {}); });
    expect(await screen.findByText(/Bank verification completed, but sync failed: Institution unavailable/)).toBeInTheDocument();
    expect(api.exchangePlaidPublicTokenAPI).not.toHaveBeenCalled();
});

test('temporary sync failures offer retry instead of reconnect and report retry failures', async () => {
    api.getPlaidStatusAPI.mockResolvedValue({ configured: true, items: [{ ...item, status: 'sync_error', lastError: 'Timeout' }] });
    api.syncPlaidAPI.mockResolvedValue({ results: [{ itemId: item.itemId, ok: false, error: 'Institution unavailable' }] });
    render(<Account />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry sync' }));
    expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
    expect(await screen.findByText('Sync incomplete: Institution unavailable')).toBeInTheDocument();
    expect(window.Plaid.create).not.toHaveBeenCalled();
});

test('connecting a new bank still exchanges its public token', async () => {
    api.exchangePlaidPublicTokenAPI.mockResolvedValue({ sync: { results: [{ ok: true }] } });
    render(<Account />);
    fireEvent.click(await screen.findByText('Connect a bank with Plaid'));
    await waitFor(() => expect(window.Plaid.create).toHaveBeenCalled());
    await act(async () => { await linkOptions.onSuccess('public-new', { institution: { name: 'CIBC' } }); });
    expect(api.createPlaidLinkTokenAPI).toHaveBeenCalledWith(undefined);
    expect(api.exchangePlaidPublicTokenAPI).toHaveBeenCalledWith('public-new', { institution: { name: 'CIBC' } });
    expect(api.syncPlaidAPI).not.toHaveBeenCalled();
    expect(await screen.findByText('Bank connected. Missing transactions are now covered by Plaid.')).toBeInTheDocument();
});

test('export reports fetch failures instead of claiming the account has no transactions', async () => {
    api.GetDataFromDB.mockRejectedValueOnce(new Error('Network unavailable'));
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    try {
        render(<Account />);
        fireEvent.click(await screen.findByText('Export CSV'));
        await waitFor(() => expect(alert).toHaveBeenCalledWith('Could not export transactions. Please try again.'));
        expect(api.GetDataFromDB).toHaveBeenCalledWith({ throwOnError: true });
        expect(alert).not.toHaveBeenCalledWith('There are no transactions to export yet.');
    } finally { alert.mockRestore(); }
});
