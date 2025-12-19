import React, { useMemo } from "react";
import { useTransactions } from "../../context/TransactionContext";

const Insight = () => {
    // Access global transaction data from context
    const { transactionsData: transactions, whichMonth } = useTransactions();

    const { dailyIncome, dailyExpense, dailyInvest, daysInMonth, paddingDays } = useMemo(() => {
        // Determine the Target Month/Year
        // Strategy: 
        // 1. If we have transactions, use the date from the first transaction as the "Anchor".
        //    (This handles cases where "Month 0" might be Nov even if today is Dec, depending on backend sorting).
        // 2. If no transactions, fallback to 'Today - whichMonth'.

        let year, month;

        if (transactions && transactions.length > 0) {
            const firstTxDate = new Date(transactions[0].Timestamp);
            year = firstTxDate.getFullYear();
            month = firstTxDate.getMonth();
        } else {
            // Fallback: Assume 'whichMonth' means 'Months Ago' from Today
            // e.g. 0 = This Month, 1 = Last Month
            const today = new Date();
            // Subtract whichMonth to go back in time
            const targetDate = new Date(today.getFullYear(), today.getMonth() - whichMonth, 1);
            year = targetDate.getFullYear();
            month = targetDate.getMonth();
        }

        // Days in Month
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // First Day of Week for alignment (Monday Start)
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

        // 0-indexed arrays for days 1..daysInMonth
        const incomeArr = Array(daysInMonth).fill(0);
        const expenseArr = Array(daysInMonth).fill(0);
        const investArr = Array(daysInMonth).fill(0);

        transactions.forEach(t => {
            const date = new Date(t.Timestamp);
            const tYear = date.getFullYear();
            const tMonth = date.getMonth();
            const day = date.getDate();
            const amount = Number(t.Amount);

            // Filter for matching month/year (Safe check)
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

    // Calculate Totals
    const totalIncome = useMemo(() => dailyIncome.reduce((a, b) => a + (b || 0), 0), [dailyIncome]);
    const totalExpense = useMemo(() => dailyExpense.reduce((a, b) => a + (b || 0), 0), [dailyExpense]);
    const totalInvest = useMemo(() => dailyInvest.reduce((a, b) => a + (b || 0), 0), [dailyInvest]);

    // Format Full Currency
    const formatCurrency = (val) => {
        return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    // Reusable Grid Component 
    const renderGrid = (title, color, data, maxVal, totalVal) => (
        <div style={{
            display: "grid",
            gridTemplateColumns: "min-content min-content",
            gridTemplateRows: "auto auto",
            gap: "0px 5px",
            alignItems: "end"
        }}>

            {/* Title */}
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

            {/* Dots Grid */}
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

                    let opacity = 0.1;
                    if (amount > 0) opacity = 0.3 + (0.7 * (amount / maxVal));

                    return (
                        <div key={index} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "12px", height: "12px" }} title={`Day ${index - paddingDays + 1}: $${amount}`}>
                            <div
                                style={{
                                    width: "4px",
                                    height: "4px",
                                    borderRadius: "50%",
                                    backgroundColor: color,
                                    opacity: opacity,
                                }}
                            />
                        </div>
                    );
                })}
            </div>

            {/* Total Value */}
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
