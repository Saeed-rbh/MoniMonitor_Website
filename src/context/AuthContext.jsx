import React, { createContext, useContext, useState, useEffect } from "react";
import { apiUrl } from "../config/api";

/** @typedef {{ username: string, userId: string | null, profilePhotoUrl: string | null, joinedAt: string | null, token: string }} SessionUser */
/** @typedef {{ id: string, username: string, profilePhotoUrl?: string | null, joinedAt?: string | null }} LoginUser */
/** @type {import('react').Context<{ user: SessionUser | null, loading: boolean, sessionError: string | null, login: (user: LoginUser, token: string) => void, logout: () => Promise<void> } | null>} */
const AuthContext = createContext(null);
const getStorage = () => typeof window !== "undefined" ? window.localStorage : null;
export const telegramAutoLoginEnabled = () => getStorage()?.getItem('telegramLogout') !== 'true';
const storageKeys = ['token', 'username', 'userId', 'profilePhotoUrl', 'joinedAt'];
const clearSession = () => storageKeys.forEach((key) => getStorage()?.removeItem(key));
// Decoding is only for browser expiry UX. The API verifies signatures and
// registered sessions before granting access.
const expiresAt = (token) => {
    try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return Number.isSafeInteger(payload.exp) ? payload.exp * 1000 : 0;
    } catch { return 0; }
};
const authRequest = (path, options) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    return fetch(apiUrl(path), { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
};
const sessionRequest = (path, token, method = 'GET') => authRequest(path, {
    method, headers: { Authorization: `Bearer ${token}` },
});

const persistSession = (userData, token) => {
    const storage = getStorage();
    const normalizedUser = {
        username: userData.username,
        userId: userData.id,
        profilePhotoUrl: userData.profilePhotoUrl || null,
        joinedAt: userData.joinedAt || null,
        token,
    };

    storage?.setItem("token", token);
    storage?.setItem("username", normalizedUser.username);
    if (normalizedUser.userId) storage?.setItem("userId", normalizedUser.userId);
    if (normalizedUser.profilePhotoUrl) {
        storage?.setItem("profilePhotoUrl", normalizedUser.profilePhotoUrl);
    } else {
        storage?.removeItem("profilePhotoUrl");
    }
    if (normalizedUser.joinedAt) {
        storage?.setItem("joinedAt", normalizedUser.joinedAt);
    } else {
        storage?.removeItem("joinedAt");
    }

    return normalizedUser;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(/** @type {SessionUser | null} */ (null));
    const [loading, setLoading] = useState(true);
    const [sessionError, setSessionError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        const storage = getStorage();
        const token = storage?.getItem("token");
        const username = storage?.getItem("username");

        let cancelled = false;
        if (token && expiresAt(token) <= Date.now()) clearSession();

        const webApp = window.Telegram?.WebApp;
        const initData = webApp?.initData;

        // When running inside Telegram WebApp with initData, perform auto-login / refresh
        if (initData && telegramAutoLoginEnabled()) {
            try {
                webApp.ready();
                webApp.expand();
            } catch (e) {
                console.warn(e);
            }

            authRequest("/telegram-auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ initData }),
            })
                .then(async (response) => {
                    if (!response.ok) {
                        const err = await response.json().catch(() => ({}));
                        throw new Error(err.error || "Unable to refresh Telegram profile");
                    }
                    return response.json();
                })
                .then((data) => {
                    if (!cancelled && data?.user && expiresAt(data?.accessToken) > Date.now()) {
                        setUser(persistSession(data.user, data.accessToken));
                    }
                })
                .catch(() => {
                    if (!cancelled) setSessionError('Unable to verify your Telegram session. Please sign in again.');
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });

            return () => { cancelled = true; };
        }

        if (token && username && expiresAt(token) > Date.now()) {
            sessionRequest('/session', token).then(async (response) => {
                if (response.status === 401 || response.status === 403) { clearSession(); return; }
                if (!response.ok) throw new Error('Session verification unavailable');
                const data = await response.json();
                if (!cancelled && getStorage()?.getItem('token') === token) setUser(persistSession(data.user, token));
            }).catch(() => {
                if (!cancelled) setSessionError('Unable to verify your session. Check your connection and reload.');
            }).finally(() => { if (!cancelled) setLoading(false); });
        } else setLoading(false);
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!user) return;
        const check = () => {
            if (expiresAt(user.token) <= Date.now() || getStorage()?.getItem('token') !== user.token) {
                if (getStorage()?.getItem('token') === user.token) clearSession();
                setUser(null);
            }
        };
        let timer;
        const schedule = () => {
            timer = setTimeout(() => {
                check();
                if (expiresAt(user.token) > Date.now()) schedule();
            }, Math.min(2147483647, Math.max(0, expiresAt(user.token) - Date.now())));
        };
        schedule();
        window.addEventListener('focus', check);
        window.addEventListener('storage', check);
        window.addEventListener('monimonitor-session-expired', check);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('focus', check);
            window.removeEventListener('storage', check);
            window.removeEventListener('monimonitor-session-expired', check);
        };
    }, [user]);

    const login = (userData, token) => {
        if (expiresAt(token) <= Date.now()) throw new Error('Invalid or expired session');
        getStorage()?.removeItem('telegramLogout');
        setSessionError(null);
        setUser(persistSession(userData, token));
    };

    const logout = async () => {
        const token = user?.token || getStorage()?.getItem('token');
        if (token) {
            const response = await sessionRequest('/logout', token, 'POST');
            if (!response.ok && response.status !== 401) throw new Error('Logout could not be confirmed. Check your connection and try again.');
        }
        clearSession();
        getStorage()?.setItem('telegramLogout', 'true');
        setUser(null);
    };

    return <AuthContext.Provider value={{ user, login, logout, loading, sessionError }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
};
