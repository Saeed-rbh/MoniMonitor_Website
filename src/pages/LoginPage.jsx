import { apiFetch as fetch } from '../services/requestClient';
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, telegramAutoLoginEnabled } from "../context/AuthContext";
import { apiUrl } from "../config/api";
import "./Auth.css";

const LoginPage = () => {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [telegramLogin, setTelegramLogin] = useState(() =>
        Boolean(window.Telegram?.WebApp?.initData) && telegramAutoLoginEnabled()
    );
    const { login, sessionError } = useAuth();
    const navigate = useNavigate();
    useEffect(() => {
        const webApp = window.Telegram?.WebApp;
        const initData = webApp?.initData;
        if (!initData || !telegramLogin) return;

        let cancelled = false;
        webApp.ready();
        webApp.expand();

        const authenticate = async () => {
            try {
                const response = await fetch(apiUrl("/telegram-auth"), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ initData }),
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || "Telegram login failed");
                if (!cancelled) {
                    login(data.user, data.expiresAt, data.accessToken);
                    navigate("/", { replace: true });
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err.message || "Telegram login failed");
                    setTelegramLogin(false);
                }
            }
        };

        authenticate();
        return () => { cancelled = true; };
    }, [telegramLogin]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        try {
            const response = await fetch(apiUrl("/login"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json();

            if (response.ok) {
                // Pass the whole user object (which includes id) and token
                login(data.user || { username }, data.expiresAt, data.accessToken);
                navigate("/");
            } else {
                setError(data.error || "Login failed");
            }
        } catch (err) {
            setError("Server error. Please try again.");
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-box">
                <div className="auth-logo">
                    <img src="/monimonitor-logo.png" alt="MoniMonitor logo" />
                </div>
                <h2>{telegramLogin ? "Signing in with Telegram" : "Login to MoniMonitor"}</h2>
                {(error || sessionError) && <p className="error-message" role="alert">{error || sessionError}</p>}
                {window.Telegram?.WebApp?.initData && !telegramLogin &&
                    <button type="button" onClick={() => { setError(''); setTelegramLogin(true); }}>Sign in with Telegram</button>}
                {telegramLogin ? (
                    <p className="auth-footer">Verifying your Telegram account…</p>
                ) : <form onSubmit={handleSubmit} style={{ width: '100%' }}>
                    <div className="form-group">
                        <label>Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label>Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button type="submit" className="auth-button">Login</button>
                </form>}
                {!telegramLogin && <p className="auth-footer">
                    Don't have an account? <Link to="/register">Register here</Link>
                </p>}
            </div>
        </div>
    );
};

export default LoginPage;
