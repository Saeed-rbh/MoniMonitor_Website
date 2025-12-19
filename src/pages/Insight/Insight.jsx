import React, { useMemo } from "react";
import { useTransactions } from "../../context/TransactionContext";
import "./Insight.css"; // Import animation styles
import InsightTrendChart from "./InsightTrendChart";
import { animated, useSpring, easings } from "react-spring";
import { ScalableElement } from "../../utils/tools";
import InsightCategoryBreakdown from "./InsightCategoryBreakdown";
import InsightFacts from './InsightFacts';

const Insight = () => {
    // Access global transaction data from context
    const { transactionsData: transactions, allTransactions, whichMonth, isDateClicked, isMoreClicked } = useTransactions();
    const [viewMode, setViewMode] = React.useState('monthly'); // 'monthly' or 'yearly'

    const scaleStyle = useSpring({
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        scale: isDateClicked || isMoreClicked ? 0.9 : 1,
        opacity: isDateClicked || isMoreClicked ? 0.5 : 1,
        filter: isDateClicked || isMoreClicked ? "blur(10px)" : "blur(0px)",
        config: {
            duration: isDateClicked || isMoreClicked ? 500 : 300,
            easing: easings.easeInOutQuad,
        },
    });

    const { dailyIncome, dailyExpense, dailyInvest, daysInMonth, paddingDays, year } = useMemo(() => {
        // Determine the Target Month/Year
        let targetYear, targetMonth;

        if (transactions && transactions.length > 0) {
            const firstTxDate = new Date(transactions[0].Timestamp);
            targetYear = firstTxDate.getFullYear();
            targetMonth = firstTxDate.getMonth();
        } else {
            const today = new Date();
            const targetDate = new Date(today.getFullYear(), today.getMonth() - whichMonth, 1);
            targetYear = targetDate.getFullYear();
            targetMonth = targetDate.getMonth();
        }

        if (viewMode === 'yearly') {
            // YEARLY LOGIC
            const monthsInYear = 12;
            const incomeArr = Array(monthsInYear).fill(0);
            const expenseArr = Array(monthsInYear).fill(0);
            const investArr = Array(monthsInYear).fill(0);

            if (allTransactions) {
                Object.entries(allTransactions).forEach(([key, val]) => {
                    const [tYear, tMonth] = key.split('-').map(Number);

                    if (tYear === targetYear) {
                        const m = tMonth - 1; // 0-11

                        incomeArr[m] = val.totalIncome || 0;
                        expenseArr[m] = val.totalExpense || 0;
                        investArr[m] = val.totalSaving || 0;
                    }
                });
            }

            return {
                dailyIncome: incomeArr,
                dailyExpense: expenseArr,
                dailyInvest: investArr,
                daysInMonth: 12,
                paddingDays: 0,
                year: targetYear
            };
        }

        // MONTHLY LOGIC (Existing)
        const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
        const firstDayParams = new Date(targetYear, targetMonth, 1).getDay();
        const paddingDays = (firstDayParams + 6) % 7;

        if (!transactions) {
            return {
                dailyIncome: Array(paddingDays).fill(null).concat(Array(daysInMonth).fill(0)),
                dailyExpense: Array(paddingDays).fill(null).concat(Array(daysInMonth).fill(0)),
                dailyInvest: Array(paddingDays).fill(null).concat(Array(daysInMonth).fill(0)),
                daysInMonth,
                paddingDays,
                year: targetYear
            };
        }

        const incomeArr = Array(daysInMonth).fill(0);
        const expenseArr = Array(daysInMonth).fill(0);
        const investArr = Array(daysInMonth).fill(0);

        transactions.forEach(t => {
            const date = new Date(t.Timestamp);
            const tYear = date.getFullYear();
            const tMonth = date.getMonth();
            const day = date.getDate();
            const amount = Number(t.Amount);

            if (tYear === targetYear && tMonth === targetMonth && day >= 1 && day <= daysInMonth) {
                const isIncome = t.Category === "Income" || t.Type === "Income" || t.Type === "Credit";
                const isExpense = t.Category === "Expense" || t.Type === "Expense" || t.Type === "Debit";
                const isInvest = t.Category === "Save&Invest" || t.Type === "Transfer" || t.Type === "Invest";

                if (isIncome) incomeArr[day - 1] += amount;
                else if (isExpense) expenseArr[day - 1] += amount;
                else if (isInvest) investArr[day - 1] += amount;
            }
        });

        const padding = Array(paddingDays).fill(null);

        return {
            dailyIncome: [...padding, ...incomeArr],
            dailyExpense: [...padding, ...expenseArr],
            dailyInvest: [...padding, ...investArr],
            daysInMonth,
            paddingDays,
            year: targetYear
        };
    }, [transactions, allTransactions, whichMonth, viewMode]);

    const maxIncome = useMemo(() => Math.max(...dailyIncome.filter(v => v !== null), 1), [dailyIncome]);
    const maxExpense = useMemo(() => Math.max(...dailyExpense.filter(v => v !== null), 1), [dailyExpense]);
    const maxInvest = useMemo(() => Math.max(...dailyInvest.filter(v => v !== null), 1), [dailyInvest]);

    const totalIncome = useMemo(() => dailyIncome.reduce((a, b) => a + (b || 0), 0), [dailyIncome]);
    const totalExpense = useMemo(() => dailyExpense.reduce((a, b) => a + (b || 0), 0), [dailyExpense]);
    const totalInvest = useMemo(() => dailyInvest.reduce((a, b) => a + (b || 0), 0), [dailyInvest]);

    const totalBalance = totalIncome - totalExpense;

    // --- Balance Comparison Logic ---
    const percentageChange = useMemo(() => {
        if (!allTransactions || viewMode === 'yearly') return null;

        // 1. Identify Target Comparison Date (Max Day in current view)
        // If current transactions exist, use the latest transaction day. Else use Today's day?
        // Safe bet: Use today's day if standard view, or the last day of month if scrolling back?
        // Requirement: "compare this month value with same day in last month"
        // Let's use the maximum day found in current monthly view transactions.
        let maxDay = 0;
        if (transactions && transactions.length > 0) {
            maxDay = Math.max(...transactions.map(t => new Date(t.Timestamp).getDate()));
        } else {
            // Fallback if no transactions shown (empty month): maybe 0?
            maxDay = new Date().getDate(); // Default to today's day
        }

        // 2. Identify Previous Month Key
        // 'transactions' context doesn't give us the year/month easily stringified, but our useMemo above calculated 'year' and deduced 'targetMonth'.
        // We'll re-derive or capture targetYear/targetMonth. 
        // Re-deriving for safety to match the 'dailyIncome' logic scope:
        let tYear, tMonth;
        if (transactions && transactions.length > 0) {
            const d = new Date(transactions[0].Timestamp);
            tYear = d.getFullYear();
            tMonth = d.getMonth();
        } else {
            const d = new Date();
            const targetDate = new Date(d.getFullYear(), d.getMonth() - whichMonth, 1);
            tYear = targetDate.getFullYear();
            tMonth = targetDate.getMonth();
        }

        // Previous Month
        const prevDate = new Date(tYear, tMonth - 1, 1); // automatically handles year wrap
        const prevYear = prevDate.getFullYear();
        const prevMonthStr = String(prevDate.getMonth() + 1).padStart(2, '0');
        const prevKey = `${prevYear}-${prevMonthStr}`;

        const prevMonthData = allTransactions[prevKey];
        if (!prevMonthData || !prevMonthData.transactions) return null;

        // 3. Calculate Previous Balance up to maxDay
        let prevIncome = 0;
        let prevExpense = 0;

        prevMonthData.transactions.forEach(t => {
            const d = new Date(t.Timestamp).getDate();
            if (d <= maxDay) {
                const amt = Number(t.Amount);
                if (t.Category === "Income" || t.Type === "Income" || t.Type === "Credit") prevIncome += amt;
                else if (t.Category === "Expense" || t.Type === "Expense" || t.Type === "Debit") prevExpense += amt;
            }
        });

        const prevBalance = prevIncome - prevExpense;

        if (prevBalance === 0) return null; // Avoid division by zero

        const diff = totalBalance - prevBalance;
        return ((diff / Math.abs(prevBalance)) * 100).toFixed(0);

    }, [allTransactions, transactions, totalBalance, viewMode, whichMonth]);

    // --- Expense Anomaly Detection Logic ---
    const anomalies = useMemo(() => {
        if (!allTransactions || !transactions || viewMode === 'yearly') return [];

        // 1. Collect Historical Expense Data (Previous 3 Months)
        let historicalExpenses = [];

        let tYear, tMonth;
        if (transactions.length > 0) {
            const d = new Date(transactions[0].Timestamp);
            tYear = d.getFullYear();
            tMonth = d.getMonth();
        } else {
            const d = new Date();
            const targetDate = new Date(d.getFullYear(), d.getMonth() - whichMonth, 1);
            tYear = targetDate.getFullYear();
            tMonth = targetDate.getMonth();
        }

        for (let i = 1; i <= 3; i++) {
            const prevDate = new Date(tYear, tMonth - i, 1);
            const pKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
            const pData = allTransactions[pKey];
            if (pData && pData.transactions) {
                pData.transactions.forEach(t => {
                    const isExpense = t.Category === "Expense" || t.Type === "Expense" || t.Type === "Debit";
                    if (isExpense) historicalExpenses.push(Number(t.Amount));
                });
            }
        }

        // If not enough data, use current month as baseline (weak fallback) or skip
        if (historicalExpenses.length < 5) return [];

        // 2. Calculate Mean and StdDev
        const mean = historicalExpenses.reduce((a, b) => a + b, 0) / historicalExpenses.length;
        const variance = historicalExpenses.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / historicalExpenses.length;
        const stdDev = Math.sqrt(variance);

        // 3. Define Threshold (Mean + 2 * StdDev)
        // Adjust multiplier as needed. 2 is standard for "unusual".
        const threshold = mean + (2 * stdDev);

        // 4. Find Anomalies in Current Month
        const potentialAnomalies = transactions.filter(t => {
            const isExpense = t.Category === "Expense" || t.Type === "Expense" || t.Type === "Debit";
            return isExpense && Number(t.Amount) > threshold;
        });

        // 5. Exclude Recurring Expenses (User Request: "if repeated every month it is fine")
        // Check if a similar amount (within 5% margin) exists in historical data.
        return potentialAnomalies.filter(t => {
            const amt = Number(t.Amount);
            // Check if this amount appears in history (likely a recurring bill like Rent)
            const isRecurring = historicalExpenses.some(hVal => {
                const margin = hVal * 0.05; // 5% margin
                return Math.abs(hVal - amt) <= margin;
            });
            return !isRecurring;
        });

    }, [allTransactions, transactions, viewMode]);

    const formatCurrency = (val) => {
        return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const renderGrid = (title, color, data, maxVal, totalVal) => (
        <div style={{
            display: "grid",
            gridTemplateColumns: "min-content min-content",
            gridTemplateRows: "auto auto",
            gap: "0px 5px",
            alignItems: "end"
        }}>

            <div style={{
                gridColumn: "1",
                gridRow: "1",
                color: color,
                fontSize: "0.75rem",
                fontWeight: "bold",
                opacity: 0.5,
                marginBottom: "0",
                writingMode: "vertical-rl",
                textOrientation: "mixed",
                transform: "rotate(180deg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
            }}>
                {title}
            </div>

            <div style={{
                gridColumn: "2",
                gridRow: "1",
                display: "grid",
                gridTemplateColumns: viewMode === 'yearly' ? "repeat(4, 12px)" : "repeat(7, 12px)", // Adjust grid for 12 months (4x3) if yearly
                gap: "2px",
            }}>
                {data.map((amount, index) => {
                    if (amount === null) {
                        return (
                            <div key={index} style={{ width: "12px", height: "12px", visibility: "hidden" }} />
                        );
                    }

                    // Calculate Final "True" Opacity
                    // Base opacity 0.3 + 0.7 * ratio
                    let finalOpacity = 0.3;
                    if (amount > 0) finalOpacity = 0.3 + (0.7 * (amount / maxVal));
                    else finalOpacity = 0.1; // "Off" dots stay dim

                    // Random Delay 0s - 1.2s
                    // Using deterministic random for stability
                    const delay = ((index * 137.5) % 1.2).toFixed(2);

                    const titleText = viewMode === 'yearly'
                        ? `${new Date(0, index).toLocaleString('default', { month: 'short' })}: $${amount}`
                        : `Day ${index - paddingDays + 1}: $${amount}`;

                    return (
                        <div key={index} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "12px", height: "12px" }} title={titleText}>
                            <div
                                className="reveal-dot"
                                style={{
                                    width: "4px",
                                    height: "4px",
                                    borderRadius: "50%",
                                    backgroundColor: color,
                                    "--to-opacity": finalOpacity, // Pass to CSS
                                    animationDelay: `${delay}s`,
                                }}
                            />
                        </div>
                    );
                })}
            </div>

            <div style={{
                gridColumn: "2",
                gridRow: "2",
                justifySelf: "start",
                marginTop: "5px",
                color: color,
                fontSize: "0.9rem",
                fontWeight: "300",
                opacity: 0.9
            }}>
                ${formatCurrency(totalVal)}
            </div>

        </div>
    );

    const chartData = useMemo(() => {
        if (!dailyIncome || !dailyExpense || !dailyInvest) return [];
        const income = dailyIncome.slice(paddingDays);
        const expense = dailyExpense.slice(paddingDays);
        const invest = dailyInvest.slice(paddingDays);
        let accIncome = 0;
        let accExpense = 0;
        let accInvest = 0;

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        return income.map((_, i) => {
            accIncome += (income[i] || 0);
            accExpense += (expense[i] || 0);
            accInvest += (invest[i] || 0);

            return {
                day: viewMode === 'yearly' ? monthNames[i] : i + 1,
                income: accIncome,
                expense: accExpense,
                invest: accInvest
            };
        });
    }, [dailyIncome, dailyExpense, dailyInvest, paddingDays, viewMode]);

    // --- Prepare Data for Category Breakdown ---
    const currentViewTransactions = useMemo(() => {
        if (viewMode === 'monthly') {
            return transactions || [];
        } else {
            // YEARLY: Aggregate all transactions for the target year
            if (!allTransactions) return [];
            let yearlyTx = [];
            Object.entries(allTransactions).forEach(([key, val]) => {
                const [tYear, _] = key.split('-').map(Number);
                if (tYear === year && val.transactions) {
                    yearlyTx = [...yearlyTx, ...val.transactions];
                }
            });
            return yearlyTx;
        }
    }, [viewMode, transactions, allTransactions, year]);

    return (
        <animated.div
            // Key forces remount on month change = Restart Animations
            key={`${whichMonth}-${viewMode}`}
            className="Insight_Container"
            style={{
                ...scaleStyle,
                padding: "10px",
                paddingTop: "10px", // Reduced top padding
                paddingBottom: "25px",
                boxSizing: "border-box",
                maxWidth: "var(--app-max-width)",
                margin: "0 auto",
                gap: "10px",
                overflowY: "auto",
                overflowX: "hidden",
                height: "100%"
            }}
        >
            {/* View Mode Toggle */}
            <div style={{
                display: 'flex',
                gap: '10px',
                margin: '10px 0 5px 0',
                justifyContent: 'center',
                padding: '4px',
            }}>
                <ScalableElement
                    as="button"
                    onClick={() => setViewMode('monthly')}
                    style={{
                        background: 'radial-gradient(circle at 30% -20%, var(--Bc-3) -100%, var(--Ec-4) 65%)',
                        color: viewMode === 'monthly' ? 'var(--Bc-1)' : 'var(--Ac-1)',
                        outline: '1px solid var(--Bc-3)',
                        border: 'none',
                        borderRadius: '30px',
                        padding: '10px 25px',
                        fontSize: '0.8rem',
                        fontWeight: viewMode === 'monthly' ? '600' : '200',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease'
                    }}
                >
                    Monthly
                </ScalableElement>
                <ScalableElement
                    as="button"
                    onClick={() => setViewMode('yearly')}
                    style={{
                        background: 'radial-gradient(circle at 30% -20%, var(--Bc-3) -100%, var(--Ec-4) 65%)',
                        color: viewMode === 'yearly' ? 'var(--Bc-1)' : 'var(--Ac-1)',
                        outline: '1px solid var(--Bc-3)',
                        border: 'none',
                        borderRadius: '30px',
                        padding: '10px 25px',
                        fontSize: '0.8rem',
                        fontWeight: viewMode === 'yearly' ? '600' : '200',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease'
                    }}
                >
                    Yearly
                </ScalableElement>
            </div>

            <div style={{
                width: "100%",
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-evenly",
                alignItems: "center",
                gap: "5px"
            }}>
                {/* Balance Display */}
                <div style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "5px",
                    border: "1px solid var(--Bc-2)",
                    borderRadius: "50px",
                    padding: "10px 20px",
                    gap: "10px",
                    width: "100%",
                    boxSizing: "border-box"
                }}>
                    <span style={{ fontSize: "0.9rem", color: "var(--Bc-2)", fontWeight: "bold" }}>Balance:</span>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {percentageChange !== null && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: Number(percentageChange) >= 0 ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)',
                                padding: '2px 12px',
                                borderRadius: '12px',
                                gap: '2px',
                                opacity: 0.8
                            }}>
                                <span style={{
                                    fontSize: '0.75rem',
                                    fontWeight: '600',
                                    color: Number(percentageChange) >= 0 ? 'var(--Fc-1)' : 'var(--Gc-1)'
                                }}>
                                    {Number(percentageChange) >= 0 ? '▲' : '▼'} {Math.abs(percentageChange)}%
                                </span>
                            </div>
                        )}
                        <span style={{
                            fontSize: "0.9rem",
                            fontWeight: "300",
                            color: totalBalance >= 0 ? "var(--Fc-1)" : "var(--Gc-1)"
                        }}>
                            ${formatCurrency(totalBalance)}
                        </span>
                    </div>
                </div>
            </div>

            <div style={{
                width: "100%",
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-evenly",
                alignItems: "center",
                gap: "5px"
            }}>
                {/* Income Grid */}
                {renderGrid("Income", "var(--Fc-1)", dailyIncome, maxIncome, totalIncome)}

                {/* Expense Grid */}
                {renderGrid("Expense", "var(--Gc-1)", dailyExpense, maxExpense, totalExpense)}

                {/* Invest Grid */}
                {renderGrid("Invest", "#fff", dailyInvest, maxInvest, totalInvest)}
            </div>

            <div style={{ width: "100%", flexShrink: 0 }}>
                <div style={{
                    width: "100%",
                    paddingLeft: "10px",
                    fontSize: "0.8rem",
                    fontWeight: "bold",
                    color: "var(--Ac-3)",
                    marginBottom: "5px"
                }}>
                    {viewMode === 'yearly' ? `${year} Annual Trend` : 'Monthly Trend'}
                </div>
                <InsightTrendChart data={chartData} />
            </div>

            {/* Expense Warning */}
            {anomalies.length > 0 && (
                <div style={{
                    width: "100%",
                    marginTop: "5px",
                    marginBottom: "10px",
                    padding: "10px",
                    borderRadius: "15px",
                    background: "rgba(255, 59, 48, 0.1)",
                    border: "1px solid var(--Gc-1)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "5px",
                    boxSizing: "border-box"
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--Gc-1)" }}>
                        <span style={{ fontSize: "1.2rem" }}>⚠️</span>
                        <span style={{ fontSize: "0.85rem", fontWeight: "bold" }}>Unusual Spending Detected</span>
                    </div>
                    {anomalies.map((t, idx) => (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--Ac-3)", paddingLeft: "28px" }}>
                            <span>{t.Label || "Expense"}</span>
                            <span style={{ fontWeight: "600", color: "var(--Gc-1)" }}>${Number(t.Amount).toLocaleString()}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Insight Facts */}
            <InsightFacts
                transactions={currentViewTransactions}
                allTransactions={allTransactions}
                viewMode={viewMode}
                currentDate={new Date(transactions && transactions.length > 0 ? transactions[0].Timestamp : new Date())} // Pass current date context
            />

            {/* Category Breakdown */}
            <InsightCategoryBreakdown transactions={currentViewTransactions} />
        </animated.div>
    );
};

export default Insight;
