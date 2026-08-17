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

        if (token && username) {
            setUser({ username, userId, profilePhotoUrl, joinedAt, token });
        }

        const webApp = window.Telegram?.WebApp;
        const initData = webApp?.initData;

        // When running inside Telegram WebApp with initData, perform auto-login / refresh
        if (initData) {
            let cancelled = false;
            try {
                webApp.ready();
                webApp.expand();
            } catch (e) {
                console.warn(e);
            }

            fetch(apiUrl("/telegram-auth"), {
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
                    if (!cancelled && data?.user && data?.accessToken) {
                        setUser(persistSession(data.user, data.accessToken));
                    }
                })
                .catch((err) => {
                    console.error("Telegram auth error:", err);
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });

            return () => { cancelled = true; };
        }

        setLoading(false);
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
