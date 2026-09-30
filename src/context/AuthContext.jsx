import React, { createContext, useContext, useState, useEffect } from "react";
import { apiUrl } from "../config/api";
import { apiFetch, setMemoryToken } from '../services/requestClient';
import { sessionMetadata, clearLegacyTokens } from '../services/sessionMetadata';

/** @typedef {{ username: string, userId: string | null, profilePhotoUrl: string | null, joinedAt: string | null, expiresAt: number }} SessionUser */
/** @typedef {{ id: string, username: string, profilePhotoUrl?: string | null, joinedAt?: string | null }} LoginUser */
/** @type {import('react').Context<{ user: SessionUser | null, loading: boolean, sessionError: string | null, login: (user: LoginUser, expiresAt: number, memoryToken?: string) => void, logout: () => Promise<void> } | null>} */
const AuthContext = createContext(null);
export const telegramAutoLoginEnabled = () => sessionMetadata.getItem('telegramLogout') !== 'true';
const clearLegacy = clearLegacyTokens;
const clearSession = () => { clearLegacy(); setMemoryToken(null); };
function normalize(user, expiresAt, memoryToken) {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error('Invalid or expired session');
    clearLegacy(); setMemoryToken(memoryToken || null);
    const result = { username: user.username, userId: user.id, profilePhotoUrl: user.profilePhotoUrl || null,
        joinedAt: user.joinedAt || null, expiresAt };
    for (const key of ['username', 'userId', 'profilePhotoUrl', 'joinedAt']) {
        if (result[key]) sessionMetadata.setItem(key, result[key]); else sessionMetadata.removeItem(key);
    }
    return result;
}
export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(/** @type {SessionUser | null} */ (null));
    const [loading, setLoading] = useState(true);
    const [sessionError, setSessionError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        let active = true;
        clearSession();
        const controller = new AbortController();
        const webApp = window.Telegram?.WebApp;
        const telegram = webApp?.initData && telegramAutoLoginEnabled();
        if (telegram) { webApp.ready(); webApp.expand(); }
        const path = telegram ? '/telegram-auth' : '/session';
        apiFetch(apiUrl(path), { signal: controller.signal, ...(telegram ? { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: webApp.initData }) } : {}) })
            .then(async response => {
                if (response.status === 401) return;
                if (!response.ok) throw new Error('Session verification unavailable');
                const data = await response.json();
                if (active) setUser(normalize(data.user, data.expiresAt, data.accessToken));
            }).catch(error => {
                if (active && error.code !== 'cancelled') setSessionError('Unable to verify your session. Check your connection and reload.');
            }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; controller.abort(); };
    }, []);
    useEffect(() => {
        if (!user) return;
        const expired = () => { clearSession(); setUser(null); };
        const check = () => { if (user.expiresAt <= Date.now()) expired(); };
        const storage = event => { if (event.key === 'sessionRevokedAt' || event.key === null) expired(); };
        const timer = setTimeout(expired, Math.min(2147483647, Math.max(0, user.expiresAt - Date.now())));
        window.addEventListener('focus', check);
        window.addEventListener('storage', storage);
        window.addEventListener('monimonitor-session-expired', expired);
        return () => { clearTimeout(timer); window.removeEventListener('focus', check);
            window.removeEventListener('storage', storage); window.removeEventListener('monimonitor-session-expired', expired); };
    }, [user]);
    const login = (data, expiresAt, memoryToken) => {
        sessionMetadata.removeItem('telegramLogout'); setSessionError(null);
        setUser(normalize(data, expiresAt, memoryToken));
    };
    const logout = async () => {
        const response = await apiFetch(apiUrl('/logout'), { method: 'POST' });
        if (!response.ok && response.status !== 401) throw new Error('Logout could not be confirmed. Check your connection and try again.');
        clearSession(); sessionMetadata.setItem('telegramLogout', 'true');
        sessionMetadata.setItem('sessionRevokedAt', String(Date.now())); setUser(null);
    };
    return <AuthContext.Provider value={{ user, login, logout, loading, sessionError }}>{children}</AuthContext.Provider>;
};
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
};
