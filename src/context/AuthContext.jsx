import React, { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext(null);
const getStorage = () => typeof window !== "undefined" ? window.localStorage : null;

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const storage = getStorage();
        const token = storage?.getItem("token");
        const username = storage?.getItem("username");
        const userId = storage?.getItem("userId");
        const profilePhotoUrl = storage?.getItem("profilePhotoUrl");
        if (token && username) setUser({ username, userId, profilePhotoUrl, token });
        setLoading(false);
    }, []);

    const login = (userData, token) => {
        const storage = getStorage();
        storage?.setItem("token", token);
        storage?.setItem("username", userData.username);
        if (userData.id) storage?.setItem("userId", userData.id);
        if (userData.profilePhotoUrl) {
            storage?.setItem("profilePhotoUrl", userData.profilePhotoUrl);
        } else {
            storage?.removeItem("profilePhotoUrl");
        }
        setUser({
            username: userData.username,
            userId: userData.id,
            profilePhotoUrl: userData.profilePhotoUrl || null,
            token,
        });
    };

    const logout = () => {
        const storage = getStorage();
        storage?.removeItem("token");
        storage?.removeItem("username");
        storage?.removeItem("userId");
        storage?.removeItem("profilePhotoUrl");
        setUser(null);
    };

    return <AuthContext.Provider value={{ user, login, logout, loading }}>{!loading && children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
