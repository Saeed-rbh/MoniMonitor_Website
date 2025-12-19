import React, { useMemo } from "react";
import { useTransactions } from "../../context/TransactionContext";
import "./Insight.css"; // Import animation styles

const Insight = () => {
    // Access global transaction data from context
    const { transactionsData: transactions, whichMonth } = useTransactions();

    const { dailyIncome, dailyExpense, dailyInvest, daysInMonth, paddingDays } = useMemo(() => {
        // Determine the Target Month/Year
        let year, month;

        if (transactions && transactions.length > 0) {
            const firstTxDate = new Date(transactions[0].Timestamp);
            year = firstTxDate.getFullYear();
            month = firstTxDate.getMonth();
        } else {
            const today = new Date();
            const targetDate = new Date(today.getFullYear(), today.getMonth() - whichMonth, 1);
            year = targetDate.getFullYear();
            month = targetDate.getMonth();
        }

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayParams = new Date(year, month, 1).getDay();
        const paddingDays = (firstDayParams + 6) % 7;

        if (!transactions) {
            return {
                dailyIncome: Array(paddingDays).fill(null).concat(Array(daysInMonth).fill(0)),
                dailyExpense: Array(paddingDays).fill(null).concat(Array(daysInMonth).fill(0)),
                dailyInvest: Array(paddingDays).fill(null).concat(Array(daysInMonth).fill(0)),
                daysInMonth,
                paddingDays
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

            if (tYear === year && tMonth === month && day >= 1 && day <= daysInMonth) {
                const isIncome = t.Category === "Income" || t.Type === "Income" || t.Type === "Credit";
                const isExpense = t.Category === "Expense" || t.Type === "Expense" || t.Type === "Debit";
                const isInvest = t.Category === "Save&Invest" || t.Type === "Transfer" || t.Type === "Invest";

                if (isIncome) {
                    incomeArr[day - 1] += amount;
                } else if (isExpense) {
                    expenseArr[day - 1] += amount;
                } else if (isInvest) {
                    investArr[day - 1] += amount;
                }
            }
        });

        const padding = Array(paddingDays).fill(null);

        return {
            dailyIncome: [...padding, ...incomeArr],
            dailyExpense: [...padding, ...expenseArr],
            dailyInvest: [...padding, ...investArr],
            daysInMonth,
            paddingDays
        };
    }, [transactions, whichMonth]);

    const maxIncome = useMemo(() => Math.max(...dailyIncome.filter(v => v !== null), 1), [dailyIncome]);
    const maxExpense = useMemo(() => Math.max(...dailyExpense.filter(v => v !== null), 1), [dailyExpense]);
    const maxInvest = useMemo(() => Math.max(...dailyInvest.filter(v => v !== null), 1), [dailyInvest]);

    const totalIncome = useMemo(() => dailyIncome.reduce((a, b) => a + (b || 0), 0), [dailyIncome]);
    const totalExpense = useMemo(() => dailyExpense.reduce((a, b) => a + (b || 0), 0), [dailyExpense]);
    const totalInvest = useMemo(() => dailyInvest.reduce((a, b) => a + (b || 0), 0), [dailyInvest]);

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
                gridTemplateColumns: "repeat(7, 12px)",
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

                    return (
                        <div key={index} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "12px", height: "12px" }} title={`Day ${index - paddingDays + 1}: $${amount}`}>
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

    return (
        <div
            // Key forces remount on month change = Restart Animations
            key={whichMonth}
            style={{
                width: "100%",
                flex: 1,
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-evenly",
                padding: "10px",
                paddingTop: "20px",
                paddingBottom: "80px",
                boxSizing: "border-box",
                maxWidth: "var(--app-max-width)",
                margin: "0 auto",
                gap: "5px"
            }}
        >
            {/* Income Grid */}
            {renderGrid("Income", "var(--Fc-1)", dailyIncome, maxIncome, totalIncome)}

            {/* Expense Grid */}
            {renderGrid("Expense", "var(--Gc-1)", dailyExpense, maxExpense, totalExpense)}

            {/* Invest Grid */}
            {renderGrid("Invest", "#fff", dailyInvest, maxInvest, totalInvest)}
        </div>
    );
};

export default Insight;
