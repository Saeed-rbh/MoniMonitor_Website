import React, { createContext, useContext, useState, useEffect } from "react";
import { apiUrl } from "../config/api";

const AuthContext = createContext(null);
const getStorage = () => typeof window !== "undefined" ? window.localStorage : null;

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
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const storage = getStorage();
        const token = storage?.getItem("token");
        const username = storage?.getItem("username");
        const userId = storage?.getItem("userId");
        const profilePhotoUrl = storage?.getItem("profilePhotoUrl");
        const joinedAt = storage?.getItem("joinedAt");
        if (token && username) setUser({ username, userId, profilePhotoUrl, joinedAt, token });
        setLoading(false);

        const webApp = window.Telegram?.WebApp;
        if (!token || !username || !webApp?.initData) return;

        let cancelled = false;
        webApp.ready();
        webApp.expand();

        fetch(apiUrl("/telegram-auth"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData: webApp.initData }),
        })
            .then(async (response) => {
                if (!response.ok) throw new Error("Unable to refresh Telegram profile");
                return response.json();
            })
            .then((data) => {
                if (!cancelled) setUser(persistSession(data.user, data.accessToken));
            })
            .catch(() => {
                // Keep the existing website session; normal API authentication will
                // redirect to login if its token has also expired.
            });

        return () => { cancelled = true; };
    }, []);

    const login = (userData, token) => {
        setUser(persistSession(userData, token));
    };

    const logout = () => {
        const storage = getStorage();
        storage?.removeItem("token");
        storage?.removeItem("username");
        storage?.removeItem("userId");
        storage?.removeItem("profilePhotoUrl");
        storage?.removeItem("joinedAt");
        setUser(null);
    };

    return <AuthContext.Provider value={{ user, login, logout, loading }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
