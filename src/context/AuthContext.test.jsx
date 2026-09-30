import React from "react";
import { render, screen, waitFor, fireEvent, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const CurrentProfile = () => {
    const { user, logout, sessionError } = useAuth();
    const [error, setError] = React.useState('');
    return <><span>{user?.profilePhotoUrl || "no-photo"}</span><span>{user ? 'signed-in' : 'signed-out'}</span>
        <button onClick={() => logout().catch((e) => setError(e.message))}>Logout</button>
        <span>{error || sessionError}</span></>;
};
const token = (seconds = 3600) => `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }))}.signature`;

beforeEach(() => {
    const values = new Map();
    Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
            clear: () => values.clear(),
            getItem: (key) => values.has(key) ? values.get(key) : null,
            removeItem: (key) => values.delete(key),
            setItem: (key, value) => values.set(key, String(value)),
        },
    });
    window.localStorage.clear();
    window.localStorage.setItem("token", token());
    window.localStorage.setItem("username", "saeed");
    window.localStorage.setItem("userId", "app-user-id");
    window.Telegram = {
        WebApp: {
            initData: "signed-telegram-data",
            ready: vi.fn(),
            expand: vi.fn(),
        },
    };
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete window.Telegram;
    window.localStorage.clear();
});

test("refreshes and persists the Telegram profile photo for an existing session", async () => {
    const refreshedToken = token(7200);
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
            accessToken: refreshedToken, expiresAt: Date.now() + 7200000,
            user: {
                id: "app-user-id",
                username: "saeed",
                profilePhotoUrl: "https://t.me/i/userpic/320/profile.jpg",
                joinedAt: "2026-08-12T12:00:00.000Z",
            },
        }),
    });

    render(
        <AuthProvider>
            <CurrentProfile />
        </AuthProvider>
    );

    expect(await screen.findByText("no-photo")).toBeInTheDocument();
    await waitFor(() => {
        expect(screen.getByText("https://t.me/i/userpic/320/profile.jpg")).toBeInTheDocument();
    });
    expect(window.localStorage.getItem("profilePhotoUrl")).toBe("https://t.me/i/userpic/320/profile.jpg");
    expect(window.localStorage.getItem("joinedAt")).toBe("2026-08-12T12:00:00.000Z");
    expect(window.localStorage.getItem("token")).toBeNull();
    expect(window.sessionStorage.getItem("token")).toBeNull();
});

const validSession = () => ({ ok: true, status: 200, json: async () => ({
    user: { id: 'app-user-id', username: 'saeed' }, expiresAt: Date.now() + 3600000,
}) });

test('validates stored access before displaying it and revokes access on logout', async () => {
    delete window.Telegram;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(validSession())
        .mockResolvedValueOnce({ ok: true, status: 204 });
    render(<AuthProvider><CurrentProfile /></AuthProvider>);
    expect(screen.getByText('signed-out')).toBeInTheDocument();
    await screen.findByText('signed-in');
    fireEvent.click(screen.getByText('Logout'));
    await screen.findByText('signed-out');
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/logout$/);
    expect(fetchMock.mock.calls[1][1].method).toBe('POST');
    expect(window.localStorage.getItem('token')).toBeNull();
    expect(window.localStorage.getItem('telegramLogout')).toBe('true');
});

test('failed server revocation keeps access and reports the failure for retry', async () => {
    delete window.Telegram;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(validSession()).mockResolvedValueOnce({ ok: false, status: 503 });
    render(<AuthProvider><CurrentProfile /></AuthProvider>);
    await screen.findByText('signed-in');
    fireEvent.click(screen.getByText('Logout'));
    await screen.findByText(/Logout could not be confirmed/);
    expect(screen.getByText('signed-in')).toBeInTheDocument();
    expect(window.localStorage.getItem('token')).toBeNull();
});

test('discards legacy stored tokens and verifies the cookie instead', async () => {
    delete window.Telegram;
    window.localStorage.setItem('token', token(-1));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 });
    render(<AuthProvider><CurrentProfile /></AuthProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(window.localStorage.getItem('token')).toBeNull();
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
    expect(fetchMock.mock.calls[0][1].headers.has('Authorization')).toBe(false);
});

test('an explicit Telegram logout suppresses automatic sign-in on remount', async () => {
    window.localStorage.clear(); window.localStorage.setItem('telegramLogout', 'true');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 });
    render(<AuthProvider><CurrentProfile /></AuthProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/session$/);
    expect(screen.getByText('signed-out')).toBeInTheDocument();
});

test('clears access at expiry and handles logout from another tab', async () => {
    delete window.Telegram;
    window.localStorage.setItem('token', token(1));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ user: { id: 'app-user-id', username: 'saeed' }, expiresAt: Date.now() + 1000 }) }));
    vi.useFakeTimers();
    await act(async () => { render(<AuthProvider><CurrentProfile /></AuthProvider>); });
    expect(screen.getByText('signed-in')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(screen.getByText('signed-out')).toBeInTheDocument();
    expect(window.localStorage.getItem('token')).toBeNull();
    vi.useRealTimers();
    cleanup();
    window.localStorage.setItem('token', token());
    window.localStorage.setItem('username', 'saeed');
    render(<AuthProvider><CurrentProfile /></AuthProvider>);
    await screen.findByText('signed-in');
    act(() => { window.localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: 'sessionRevokedAt' })); });
    expect(screen.getByText('signed-out')).toBeInTheDocument();
});
