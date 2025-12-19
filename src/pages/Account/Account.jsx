import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext";
import { useNavigate } from "react-router-dom";
import "../../pages/Auth.css"; // Reuse Auth styles
import BlurFade from "../../components/ui/blur-fade"; // Use relative path

const Account = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    // Settings State
    const [currency, setCurrency] = useState("USD");
    const [theme, setTheme] = useState("Dark");
    const [notifications, setNotifications] = useState(true);

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

    const handleExport = () => {
        alert("Exporting transactions to CSV... (Simulated)");
    };

    const handleBackup = () => {
        alert("Backing up data to cloud... (Simulated)");
    };

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
                            <div className="labeled-toggle-container" onClick={() => setNotifications(!notifications)}>
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
                        <div className="settings-item" style={itemStyle} onClick={handleExport}>
                            <span>Export CSV</span>
                            <span style={{ fontSize: "1rem", cursor: "pointer" }}>⬇️</span>
                        </div>
                        <div className="settings-item" style={itemStyle} onClick={handleBackup}>
                            <span>Backup</span>
                            <span style={{ fontSize: "1rem", cursor: "pointer" }}>☁️</span>
                        </div>
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
