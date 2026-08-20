import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext";
import { useNavigate } from "react-router-dom";
import "../../pages/Auth.css"; // Reuse Auth styles
import BlurFade from "../../components/ui/blur-fade"; // Use relative path
import {
    createBackupAPI,
    createPlaidLinkTokenAPI,
    disconnectPlaidItemAPI,
    downloadBackupAPI,
    exchangePlaidPublicTokenAPI,
    GetDataFromDB,
    getBackupStatusAPI,
    getPlaidStatusAPI,
    getSettingsAPI,
    restoreBackupAPI,
    saveSettingsAPI,
    syncPlaidAPI,
} from "../../services/apiService";

const Account = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    // Settings State
    const [currency, setCurrency] = useState("CAD");
    const [theme, setTheme] = useState("Dark");
    const [notifications, setNotifications] = useState(true);
    const [backupStatus, setBackupStatus] = useState(null);
    const [backupBusy, setBackupBusy] = useState(false);
    const [backupMessage, setBackupMessage] = useState("");
    const [plaidStatus, setPlaidStatus] = useState(null);
    const [plaidBusy, setPlaidBusy] = useState(false);
    const [plaidMessage, setPlaidMessage] = useState("");

    // UI State
    const [activeDropdown, setActiveDropdown] = useState(null);

    // Modals State
    const [showHelp, setShowHelp] = useState(false);
    const [closingHelp, setClosingHelp] = useState(false);
    const [showAbout, setShowAbout] = useState(false);
    const [closingAbout, setClosingAbout] = useState(false);
    const [showCurrency, setShowCurrency] = useState(false);
    const [closingCurrency, setClosingCurrency] = useState(false);

    const dropdownRef = useRef(null);

    useEffect(() => {
        let active = true;
        Promise.all([getSettingsAPI(), getBackupStatusAPI(), getPlaidStatusAPI().catch(() => null)]).then(([settings, backups, plaid]) => {
            if (!active) return;
            if (settings) {
                setCurrency(settings.currency || "CAD");
                setNotifications(Boolean(settings.notificationsEnabled));
            }
            if (backups) setBackupStatus(backups);
            if (plaid) setPlaidStatus(plaid);
        });
        return () => { active = false; };
    }, []);

    const persistSettings = (nextCurrency = currency, nextNotifications = notifications) => {
        saveSettingsAPI({
            currency: nextCurrency,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
            notificationsEnabled: nextNotifications,
        });
    };

    // Close dropdowns
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setActiveDropdown(null);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

    const handleExport = async () => {
        const transactions = await GetDataFromDB();
        if (!transactions.length) return alert("There are no transactions to export yet.");
        const columns = ["id", "Amount", "Category", "Label", "Reason", "Timestamp", "Type", "Account", "BankName", "ReferenceNumber", "Frequency"];
        const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const csv = [columns.join(","), ...transactions.map((transaction) => columns.map((column) => quote(transaction[column])).join(","))].join("\r\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `monimonitor-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const refreshBackupStatus = async () => {
        const status = await getBackupStatusAPI();
        if (status) setBackupStatus(status);
        return status;
    };

    const handleBackup = async () => {
        setBackupBusy(true);
        setBackupMessage("Creating verified backup…");
        const backup = await createBackupAPI();
        if (backup) {
            await refreshBackupStatus();
            setBackupMessage("Backup created and verified.");
        } else {
            setBackupMessage("Backup could not be created.");
        }
        setBackupBusy(false);
    };

    const handleBackupDownload = async () => {
        const latest = backupStatus?.lastBackup;
        if (!latest) return setBackupMessage("Create a backup first.");
        setBackupBusy(true);
        const downloaded = await downloadBackupAPI(latest.fileName);
        setBackupMessage(downloaded ? "Backup downloaded." : "Backup download failed.");
        setBackupBusy(false);
    };

    const handleBackupRestore = async () => {
        const latest = backupStatus?.lastBackup;
        if (!latest) return setBackupMessage("No backup is available to restore.");
        const createdAt = new Date(latest.createdAt).toLocaleString();
        if (!window.confirm(`Restore the backup from ${createdAt}? A safety backup will be created first.`)) return;
        setBackupBusy(true);
        setBackupMessage("Verifying and restoring backup…");
        const restored = await restoreBackupAPI(latest.fileName);
        if (!restored) {
            setBackupMessage("Restore failed. Your current data was not replaced.");
            setBackupBusy(false);
            return;
        }
        setBackupMessage("Backup restored. Reloading your financial data…");
        window.setTimeout(() => window.location.reload(), 800);
    };

    const refreshPlaidStatus = async () => {
        const status = await getPlaidStatusAPI();
        setPlaidStatus(status);
        return status;
    };

    const handleConnectPlaid = async () => {
        setPlaidBusy(true);
        setPlaidMessage("Preparing secure bank connection…");
        try {
            const { linkToken } = await createPlaidLinkTokenAPI();
            if (!window.Plaid?.create) throw new Error("Plaid Link could not be loaded");
            const handler = window.Plaid.create({
                token: linkToken,
                onSuccess: async (publicToken, metadata) => {
                    try {
                        setPlaidMessage("Connecting and checking for missing transactions…");
                        await exchangePlaidPublicTokenAPI(publicToken, { institution: metadata.institution });
                        await refreshPlaidStatus();
                        setPlaidMessage("Bank connected. Missing transactions are now covered by Plaid.");
                    } catch (error) {
                        setPlaidMessage(error.message);
                    } finally {
                        setPlaidBusy(false);
                        handler.destroy();
                    }
                },
                onExit: (error) => {
                    if (error) setPlaidMessage(error.display_message || error.error_message || "Bank connection was not completed.");
                    else setPlaidMessage("Bank connection cancelled.");
                    setPlaidBusy(false);
                    handler.destroy();
                },
            });
            handler.open();
        } catch (error) {
            setPlaidMessage(error.message);
            setPlaidBusy(false);
        }
    };

    const handleEnablePlaidHoldings = async (item) => {
        setPlaidBusy(true);
        setPlaidMessage("Preparing secure investment authorization…");
        try {
            const { linkToken } = await createPlaidLinkTokenAPI(item.itemId);
            if (!window.Plaid?.create) throw new Error("Plaid Link could not be loaded");
            const handler = window.Plaid.create({
                token: linkToken,
                onSuccess: async () => {
                    try {
                        setPlaidMessage("Loading current TFSA cash and holdings…");
                        await syncPlaidAPI();
                        await refreshPlaidStatus();
                        setPlaidMessage("Investment holdings updated from Wealthsimple. Reloading…");
                        window.setTimeout(() => window.location.reload(), 700);
                    } catch (error) {
                        setPlaidMessage(error.message);
                    } finally {
                        setPlaidBusy(false);
                        handler.destroy();
                    }
                },
                onExit: (error) => {
                    if (error) setPlaidMessage(error.display_message || error.error_message || "Investment authorization was not completed.");
                    else setPlaidMessage("Investment authorization cancelled.");
                    setPlaidBusy(false);
                    handler.destroy();
                },
            });
            handler.open();
        } catch (error) {
            setPlaidMessage(error.message);
            setPlaidBusy(false);
        }
    };

    const handlePlaidSync = async () => {
        setPlaidBusy(true);
        setPlaidMessage("Checking Plaid for missing transactions…");
        try {
            const result = await syncPlaidAPI();
            await refreshPlaidStatus();
            const imported = result.results?.reduce((sum, item) => sum + (item.imported || 0), 0) || 0;
            const matched = result.results?.reduce((sum, item) => sum + (item.matched || 0), 0) || 0;
            const investmentImported = result.results?.reduce((sum, item) => sum + (item.investmentTransactionsImported || 0), 0) || 0;
            const investmentMatched = result.results?.reduce((sum, item) => sum + (item.investmentTransactionsMatched || 0), 0) || 0;
            const historyPending = result.results?.some((item) => item.investmentTransactionsStatus === 'pending');
            setPlaidMessage(`Sync complete: ${imported + investmentImported} imported, ${matched + investmentMatched} matched to existing email records.${historyPending ? ' Investment history is preparing and will be loaded automatically.' : ''}`);
        } catch (error) {
            setPlaidMessage(error.message);
        } finally {
            setPlaidBusy(false);
        }
    };

    const handlePlaidDisconnect = async (item) => {
        const label = item.institutionName || "this bank";
        if (!window.confirm(`Disconnect ${label}? Imported transaction history will be kept.`)) return;
        setPlaidBusy(true);
        try {
            await disconnectPlaidItemAPI(item.itemId);
            await refreshPlaidStatus();
            setPlaidMessage(`${label} disconnected. Existing transactions were kept.`);
        } catch (error) {
            setPlaidMessage(error.message);
        } finally {
            setPlaidBusy(false);
        }
    };

    const lastBackupLabel = backupStatus?.lastBackup
        ? new Date(backupStatus.lastBackup.createdAt).toLocaleString()
        : "Never";

    const openCurrencyModal = () => setShowCurrency(true);

    const selectCurrency = (val) => {
        setCurrency(val);
        setClosingCurrency(true);
        setTimeout(() => {
            setShowCurrency(false);
            setClosingCurrency(false);
        }, 400);
    };

    const closeCurrency = () => {
        setClosingCurrency(true);
        setTimeout(() => {
            setShowCurrency(false);
            setClosingCurrency(false);
        }, 400);
    };

    const closeHelp = () => {
        setClosingHelp(true);
        setTimeout(() => {
            setShowHelp(false);
            setClosingHelp(false);
        }, 400);
    };

    const closeAbout = () => {
        setClosingAbout(true);
        setTimeout(() => {
            setShowAbout(false);
            setClosingAbout(false);
        }, 400);
    };

    // Reduced font sizes and padding for compact UI
    const itemStyle = {
        padding: "0.8rem 1rem", // Reduced padding
        backgroundColor: "var(--Ac-4)",
        borderRadius: "12px", // Slightly smaller radius
        color: "var(--Ac-1)",
        marginBottom: "0.4rem", // Tighter spacing
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        border: "1px solid transparent",
        cursor: "pointer",
        transition: "all 0.2s",
        fontSize: "0.85rem" // Smaller font
    };

    const closeButtonStyle = {
        position: 'absolute',
        top: '10px',
        right: '15px',
        background: 'none',
        border: 'none',
        color: 'var(--Ac-2)',
        fontSize: '1.5rem',
        cursor: 'pointer'
    };

    const currencyOptions = [
        { label: "USD", value: "USD", icon: "$" },
        { label: "CAD", value: "CAD", icon: "C$" },
        { label: "EUR", value: "EUR", icon: "€" }
    ];

    return (
        <div className="auth-container" style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            width: "100%",
            height: "100%", // Override 100vh from CSS class
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            background: "transparent",
            paddingTop: "10px",
            paddingBottom: "10px"
        }} ref={dropdownRef}>
            <BlurFade delay={0.2} duration={0.3} style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center'
            }}>
                <div className="auth-box" style={{
                    marginTop: "0px",
                    maxWidth: "420px",
                    width: "95%",
                    flex: 1,              // Fill remaining height
                    overflowY: "auto",
                    padding: "1.5rem",
                    paddingTop: "0.5rem",
                    boxSizing: "border-box",
                    scrollbarWidth: "none",
                    msOverflowStyle: "none",
                    alignItems: "flex-start",
                    textAlign: "left"
                }}>

                    {/* General Settings */}
                    <div className="settings-section" style={{ width: '100%', marginBottom: '0.4rem', marginTop: '0.5rem' }}>
                        <h4 style={{ color: "var(--Ac-2)", marginBottom: "0.2rem", marginLeft: "5px", fontSize: "0.7rem", fontWeight: "bold", textTransform: 'uppercase' }}>General</h4>

                        <div className="settings-item" style={itemStyle} onClick={openCurrencyModal}>
                            <span>Currency</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ color: 'var(--Bc-2)', fontWeight: 'bold', fontSize: '0.85rem' }}>
                                    {currency} {currencyOptions.find(opt => opt.value === currency)?.icon}
                                </span>
                            </div>
                        </div>

                        <div className="settings-item" style={itemStyle}>
                            <span>Theme</span>
                            <div className="labeled-toggle-container" onClick={() => setTheme(theme === 'Dark' ? 'Light' : 'Dark')}>
                                <span className={`toggle-label ${theme === 'Dark' ? 'active' : ''}`} style={{ fontSize: '0.75rem' }}>Dark</span>
                                <div className={`toggle-switch ${theme === 'Light' ? 'active' : ''}`} style={{ width: '40px', height: '22px' }}>
                                    <div className="toggle-slider" style={{ width: '18px', height: '18px', top: '2px', left: '2px' }}></div>
                                </div>
                                <span className={`toggle-label ${theme === 'Light' ? 'active' : ''}`} style={{ fontSize: '0.75rem' }}>Light</span>
                            </div>
                        </div>

                        <div className="settings-item" style={itemStyle}>
                            <span>Notifications</span>
                            <div className="labeled-toggle-container" onClick={() => { const next = !notifications; setNotifications(next); persistSettings(currency, next); }}>
                                <span className={`toggle-label ${!notifications ? 'active' : ''}`} style={{ fontSize: '0.75rem' }}>Off</span>
                                <div className={`toggle-switch ${notifications ? 'active' : ''}`} style={{ width: '40px', height: '22px' }}>
                                    <div className="toggle-slider" style={{ width: '18px', height: '18px', top: '2px', left: '2px' }}></div>
                                </div>
                                <span className={`toggle-label ${notifications ? 'active' : ''}`} style={{ fontSize: '0.75rem' }}>On</span>
                            </div>
                        </div>
                    </div>

                    {/* Data Management */}
                    <div className="settings-section" style={{ width: '100%', marginBottom: '0.4rem' }}>
                        <h4 style={{ color: "var(--Ac-2)", marginBottom: "0.2rem", marginLeft: "5px", fontSize: "0.7rem", fontWeight: "bold", textTransform: 'uppercase' }}>Data</h4>
                        <div className="settings-item" style={itemStyle} onClick={() => navigate("/Finance")}>
                            <span>Budgets & Goals</span>
                            <span style={{ fontSize: "1rem" }}>🎯</span>
                        </div>

                        <div className="settings-item" style={itemStyle} onClick={handleExport}>
                            <span>Export CSV</span>
                            <span style={{ fontSize: "1rem", cursor: "pointer" }}>⬇️</span>
                        </div>
                        <div className="settings-item" style={{ ...itemStyle, cursor: "default" }}>
                            <span>Last backup</span>
                            <span style={{ color: "var(--Bc-2)", fontSize: "0.72rem", textAlign: "right" }}>{lastBackupLabel}</span>
                        </div>
                        <div className="settings-item" style={itemStyle} onClick={backupBusy ? undefined : handleBackup}>
                            <span>{backupBusy ? "Backup in progress…" : "Backup now"}</span>
                            <span style={{ fontSize: "1rem", cursor: "pointer" }}>☁️</span>
                        </div>
                        <div className="settings-item" style={itemStyle} onClick={backupBusy ? undefined : handleBackupDownload}>
                            <span>Download latest backup</span>
                            <span style={{ fontSize: "1rem", cursor: "pointer" }}>⬇️</span>
                        </div>
                        <div className="settings-item" style={{ ...itemStyle, color: "var(--Gc-2)" }} onClick={backupBusy ? undefined : handleBackupRestore}>
                            <span>Restore latest backup</span>
                            <span style={{ fontSize: "1rem", cursor: "pointer" }}>↺</span>
                        </div>
                        {backupMessage && <p role="status" style={{ color: "var(--Ac-2)", fontSize: "0.72rem", margin: "2px 6px 8px" }}>{backupMessage}</p>}
                    </div>

                    {/* Bank transaction fallback */}
                    <div className="settings-section" style={{ width: '100%', marginBottom: '0.4rem' }}>
                        <h4 style={{ color: "var(--Ac-2)", marginBottom: "0.2rem", marginLeft: "5px", fontSize: "0.7rem", fontWeight: "bold", textTransform: 'uppercase' }}>Bank fallback</h4>
                        {plaidStatus?.items?.map((item) => (
                            <div className="settings-item" style={{ ...itemStyle, cursor: "default" }} key={item.itemId}>
                                <div style={{ minWidth: 0 }}>
                                    <div>{item.institutionName || "Connected bank"}</div>
                                    <div style={{ color: item.status === 'active' ? "var(--Ac-3)" : "var(--Gc-2)", fontSize: "0.68rem", marginTop: "2px" }}>
                                        {item.status === 'active' ? `${item.accountCount} account${item.accountCount === 1 ? '' : 's'} · Last sync ${item.lastSyncedAt ? new Date(item.lastSyncedAt).toLocaleString() : 'pending'}${Number(item.investmentAccountCount) > 0 && item.holdingsStatus !== 'active' ? ' · Holdings authorization needed' : ''}` : item.lastError || 'Connection needs attention'}
                                    </div>
                                </div>
                                <button type="button" disabled={plaidBusy} onClick={() => handlePlaidDisconnect(item)} style={{ background: "none", border: 0, color: "var(--Gc-2)", cursor: "pointer", fontSize: "0.72rem" }}>Disconnect</button>
                            </div>
                        ))}
                        {plaidStatus?.items?.filter((item) => Number(item.investmentAccountCount) > 0 && ['unknown', 'consent_required'].includes(item.holdingsStatus)).map((item) => (
                            <div className="settings-item" style={itemStyle} onClick={plaidBusy ? undefined : () => handleEnablePlaidHoldings(item)} key={`holdings-${item.itemId}`}>
                                <span>Enable accurate investment holdings</span>
                                <span style={{ fontSize: "1rem" }}>📈</span>
                            </div>
                        ))}
                        <div className="settings-item" style={itemStyle} onClick={plaidBusy || plaidStatus?.configured === false ? undefined : handleConnectPlaid}>
                            <span>{plaidBusy ? "Plaid is working…" : "Connect a bank with Plaid"}</span>
                            <span style={{ fontSize: "1rem" }}>🏦</span>
                        </div>
                        {plaidStatus?.items?.length > 0 && (
                            <div className="settings-item" style={itemStyle} onClick={plaidBusy ? undefined : handlePlaidSync}>
                                <span>Check for missing transactions</span>
                                <span style={{ fontSize: "1rem" }}>↻</span>
                            </div>
                        )}
                        {plaidStatus?.configured === false && <p role="status" style={{ color: "var(--Gc-2)", fontSize: "0.72rem", margin: "2px 6px 8px" }}>Plaid credentials have not been configured on the server.</p>}
                        {plaidMessage && <p role="status" style={{ color: "var(--Ac-2)", fontSize: "0.72rem", margin: "2px 6px 8px" }}>{plaidMessage}</p>}
                    </div>

                    {/* Support */}
                    <div className="settings-section" style={{ width: '100%', marginBottom: '0.2rem' }}>
                        <h4 style={{ color: "var(--Ac-2)", marginBottom: "0.2rem", marginLeft: "5px", fontSize: "0.7rem", fontWeight: "bold", textTransform: 'uppercase' }}>Support</h4>
                        <div className="settings-item" style={itemStyle} onClick={() => setShowHelp(true)}>
                            <span>Help Center</span>
                            <span style={{ fontSize: "1rem", cursor: "pointer" }}>❓</span>
                        </div>
                        <div className="settings-item" style={{ ...itemStyle, borderBottom: 'none' }} onClick={() => setShowAbout(true)}>
                            <span>About</span>
                            <span style={{ color: "var(--Ac-3)", fontSize: "0.75rem" }}>v1.0.0</span>
                        </div>
                    </div>

                    <button
                        onClick={handleLogout}
                        className="auth-button"
                        style={{
                            backgroundColor: "var(--Ec-4)", // Base dark/transparent bg
                            backgroundImage: "linear-gradient(165deg, var(--Ec-4) 30%, var(--Gc-4) 100%)", // Gradient from MoneyEntryAmount
                            color: "var(--Gc-2)", // Expense text color
                            marginTop: "5px",
                            padding: "0.8rem",
                            fontSize: "0.9rem",
                            border: "2px solid color-mix(in srgb, var(--Gc-3), transparent 50%)" // Expense border style
                        }}
                    >
                        Log Out
                    </button>
                </div>
            </BlurFade>

            {/* Currency Modal (Styles kept same or adjusted slightly) */}
            {showCurrency && (
                <div className={`modal-overlay ${closingCurrency ? 'closing' : ''}`} onClick={closeCurrency}>
                    <div className={`modal-content-ios ${closingCurrency ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
                        <button style={closeButtonStyle} onClick={closeCurrency}>×</button>
                        <h2 style={{ marginTop: 0, color: 'var(--Bc-1)', textAlign: 'center', marginBottom: '1rem', fontSize: '1.2rem' }}>Select Currency</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {currencyOptions.map((opt) => (
                                <div
                                    key={opt.value}
                                    style={{
                                        ...itemStyle,
                                        backgroundColor: currency === opt.value ? 'rgba(212, 157, 129, 0.15)' : 'var(--Ac-4)',
                                        border: currency === opt.value ? '1px solid var(--Bc-2)' : '1px solid transparent',
                                        marginBottom: 0,
                                        padding: '0.8rem 1rem'
                                    }}
                                    onClick={() => selectCurrency(opt.value)}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                        <span style={{ fontSize: '1.2rem', width: '30px', textAlign: 'center' }}>{opt.icon}</span>
                                        <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>{opt.label}</span>
                                    </div>
                                    {currency === opt.value && <span style={{ color: 'var(--Bc-2)', fontSize: '1rem' }}>✓</span>}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Help Modal */}
            {showHelp && (
                <div className={`modal-overlay ${closingHelp ? 'closing' : ''}`} onClick={closeHelp}>
                    <div className={`modal-content-ios ${closingHelp ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
                        <button style={closeButtonStyle} onClick={closeHelp}>×</button>
                        <h2 style={{ marginTop: 0, color: 'var(--Bc-1)', fontSize: '1.2rem' }}>Help Center</h2>
                        <div style={{ marginBottom: '1rem' }}>
                            <h4 style={{ marginBottom: '0.5rem', color: 'var(--Ac-2)', fontSize: '0.9rem' }}>Common Questions</h4>
                            <p style={{ fontSize: '0.8rem' }}><strong>Q: How do I export data?</strong><br />A: Go to Data Management and click the download icon.</p>
                        </div>
                        <div>
                            <h4 style={{ marginBottom: '0.5rem', color: 'var(--Ac-2)', fontSize: '0.9rem' }}>Contact Us</h4>
                            <a href="mailto:support@monimonitor.com" style={{ color: 'var(--Bc-2)', textDecoration: 'none', fontWeight: 'bold', fontSize: '0.8rem' }}>support@monimonitor.com</a>
                        </div>
                    </div>
                </div>
            )}

            {/* About Modal */}
            {showAbout && (
                <div className={`modal-overlay ${closingAbout ? 'closing' : ''}`} onClick={closeAbout}>
                    <div className={`modal-content-ios ${closingAbout ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
                        <button style={closeButtonStyle} onClick={closeAbout}>×</button>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '1rem' }}>
                            <img src="/MoneyMonitor.jpg" alt="Logo" style={{ width: '60px', height: '60px', borderRadius: '15px', marginBottom: '0.5rem' }} />
                            <h2 style={{ margin: 0, color: 'var(--Bc-1)', fontSize: '1.2rem' }}>MoniMonitor</h2>
                            <span style={{ color: 'var(--Ac-3)', fontSize: '0.8rem' }}>v1.0.0</span>
                        </div>
                        <p style={{ textAlign: 'center', fontSize: '0.8rem', lineHeight: '1.5' }}>
                            Your privacy-first finance companion.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Account;
