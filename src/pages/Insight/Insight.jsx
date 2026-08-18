import React, { useMemo } from "react";
import { useTransactions } from "../../context/TransactionContext";
import "./Insight.css"; // Import animation styles
import InsightTrendChart from "./InsightTrendChart";
import { animated, useSpring, easings } from "@react-spring/web";
import { ScalableElement } from "../../utils/tools";
import InsightCategoryBreakdown from "./InsightCategoryBreakdown";
import { getPortfolioAPI } from "../../services/apiService";
import { getTransactionDisplayReason } from "../../utils/transactionDisplay";
import MonthlyAiBrief from "./MonthlyAiBrief";
import { Utensils, ShoppingBag } from "lucide-react";
import {
    buildAllTimeInsightData,
    buildInvestmentValueTimeline,
    getRebasedInvestmentPeriodValues,
    getVisibleInsightPeriodCount,
} from "./insightPeriodData";

const Insight = () => {
    // Access global transaction data from context
    const { transactionsData: transactions, allTransactions, whichMonth, isDateClicked, isMoreClicked } = useTransactions();
    const [viewMode, setViewMode] = React.useState('monthly');
    const [portfolio, setPortfolio] = React.useState(null);

    React.useEffect(() => {
        let active = true;
        getPortfolioAPI().then((data) => {
            if (active) setPortfolio(data);
        });
        return () => {
            active = false;
        };
    }, [allTransactions]);

    const investmentTimeline = useMemo(
        () => buildInvestmentValueTimeline(allTransactions, portfolio || {}),
        [allTransactions, portfolio]
    );

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

    const { dailyIncome, dailyExpense, dailyInvest, daysInMonth, paddingDays, year, month, periodLabels, accountBalance } = useMemo(() => {
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

        if (viewMode === 'alltime') {
            const allTimeData = buildAllTimeInsightData(allTransactions);
            const firstYear = Number(allTimeData.labels[0]);
            const investValues = getRebasedInvestmentPeriodValues(
                investmentTimeline,
                new Date(firstYear, 0, 1),
                allTimeData.labels.map((label) => new Date(Number(label) + 1, 0, 1).getTime() - 1)
            );

            return {
                dailyIncome: allTimeData.income,
                dailyExpense: allTimeData.expense,
                dailyInvest: investValues,
                daysInMonth: allTimeData.labels.length,
                paddingDays: 0,
                year: targetYear,
                month: targetMonth,
                periodLabels: allTimeData.labels,
                accountBalance: allTimeData.accountBalance,
            };
        }

        if (viewMode === 'yearly') {
            // YEARLY LOGIC
            const monthsInYear = 12;
            const incomeArr = Array(monthsInYear).fill(0);
            const expenseArr = Array(monthsInYear).fill(0);
            const investArr = getRebasedInvestmentPeriodValues(
                investmentTimeline,
                new Date(targetYear, 0, 1),
                Array.from({ length: monthsInYear }, (_, index) =>
                    new Date(targetYear, index + 1, 1).getTime() - 1
                )
            );

            if (allTransactions) {
                Object.entries(allTransactions).forEach(([key, val]) => {
                    const [tYear, tMonth] = key.split('-').map(Number);

                    if (tYear === targetYear) {
                        const m = tMonth - 1; // 0-11

                        incomeArr[m] = val.totalIncome || 0;
                        expenseArr[m] = val.totalExpense || 0;
                    }
                });
            }

            return {
                dailyIncome: incomeArr,
                dailyExpense: expenseArr,
                dailyInvest: investArr,
                daysInMonth: 12,
                paddingDays: 0,
                year: targetYear,
                month: targetMonth,
                periodLabels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
                accountBalance: null
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
                year: targetYear,
                month: targetMonth,
                periodLabels: [],
                accountBalance: null
            };
        }

        const incomeArr = Array(daysInMonth).fill(0);
        const expenseArr = Array(daysInMonth).fill(0);
        const investArr = getRebasedInvestmentPeriodValues(
            investmentTimeline,
            new Date(targetYear, targetMonth, 1),
            Array.from({ length: daysInMonth }, (_, index) =>
                new Date(targetYear, targetMonth, index + 2).getTime() - 1
            )
        );

        transactions.forEach(t => {
            const date = new Date(t.Timestamp);
            const tYear = date.getFullYear();
            const tMonth = date.getMonth();
            const day = date.getDate();
            const amount = Number(t.Amount);

            if (tYear === targetYear && tMonth === targetMonth && day >= 1 && day <= daysInMonth) {
                const isIncome = t.Category === "Income" || t.Type === "Income" || t.Type === "Credit";
                const isExpense = t.Category === "Expense" || t.Type === "Expense" || t.Type === "Debit";

                if (isIncome) incomeArr[day - 1] += amount;
                else if (isExpense) expenseArr[day - 1] += amount;
            }
        });

        const padding = Array(paddingDays).fill(null);

        return {
            dailyIncome: [...padding, ...incomeArr],
            dailyExpense: [...padding, ...expenseArr],
            dailyInvest: [...padding, ...investArr],
            daysInMonth,
            paddingDays,
            year: targetYear,
            month: targetMonth,
            periodLabels: [],
            accountBalance: null
        };
    }, [transactions, allTransactions, whichMonth, viewMode, investmentTimeline]);

    const maxIncome = useMemo(() => Math.max(...dailyIncome.filter(v => v !== null), 1), [dailyIncome]);
    const maxExpense = useMemo(() => Math.max(...dailyExpense.filter(v => v !== null), 1), [dailyExpense]);
    const maxInvest = useMemo(() => Math.max(...dailyInvest.filter(v => v !== null).map(Math.abs), 1), [dailyInvest]);

    const totalIncome = useMemo(() => dailyIncome.reduce((a, b) => a + (b || 0), 0), [dailyIncome]);
    const totalExpense = useMemo(() => dailyExpense.reduce((a, b) => a + (b || 0), 0), [dailyExpense]);

    const visiblePeriodCount = useMemo(() => getVisibleInsightPeriodCount({
        viewMode,
        year,
        month,
        totalPeriods: dailyIncome.length - paddingDays,
    }), [viewMode, year, month, dailyIncome.length, paddingDays]);

    const displayedInvestTotal = useMemo(() => {
        const visibleValues = dailyInvest.slice(paddingDays, paddingDays + visiblePeriodCount);
        return visibleValues.length ? Number(visibleValues.at(-1)) || 0 : 0;
    }, [dailyInvest, paddingDays, visiblePeriodCount]);

    const portfolioNetValue = Number(portfolio?.totalValueMinor);
    const totalBalance = viewMode === 'alltime'
        ? Number.isFinite(portfolioNetValue)
            ? portfolioNetValue / 100
            : accountBalance
        : totalIncome - totalExpense;

    // --- Balance Comparison Logic ---
    const percentageChange = useMemo(() => {
        if (!allTransactions || viewMode !== 'monthly') return null;

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
        if (!allTransactions || !transactions || viewMode !== 'monthly') return [];

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

    const formatCompact = (val) => {
        const num = Math.abs(Number(val) || 0);
        if (num >= 1000000) {
            return `$${(num / 1000000).toFixed(2)}M`;
        }
        if (num >= 1000) {
            return `$${(num / 1000).toFixed(2)}K`;
        }
        return `$${num.toFixed(2)}`;
    };

    const renderGrid = (title, color, data, maxVal, totalVal) => (
        <div className="Insight_Kpi" style={{ "--insight-accent": color }}>
            <div className="Insight_KpiHeader">
                <span>{title}</span>
                <strong>${formatCurrency(totalVal)}</strong>
            </div>

            <div className="Insight_DotGrid" style={{
                gridTemplateColumns: viewMode === 'yearly'
                    ? "repeat(4, 12px)"
                    : viewMode === 'alltime'
                        ? `repeat(${Math.min(Math.max(data.length, 1), 7)}, 12px)`
                        : "repeat(7, 12px)",
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

                    const titleText = viewMode === 'monthly'
                        ? `Day ${index - paddingDays + 1}: $${amount}`
                        : `${periodLabels[index] || index + 1}: $${amount}`;

                    return (
                        <div key={index} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "12px", height: "12px" }} title={titleText}>
                            <div
                                className="reveal-dot"
                                style={{
                                    backgroundColor: color,
                                    "--to-opacity": finalOpacity,
                                    animationDelay: `${delay}s`,
                                }}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );

    const chartData = useMemo(() => {
        if (!dailyIncome || !dailyExpense || !dailyInvest) return [];
        const income = dailyIncome.slice(paddingDays, paddingDays + visiblePeriodCount);
        const expense = dailyExpense.slice(paddingDays, paddingDays + visiblePeriodCount);
        const invest = dailyInvest.slice(paddingDays, paddingDays + visiblePeriodCount);
        let accIncome = 0;
        let accExpense = 0;

        const cumulativeData = income.map((_, i) => {
            accIncome += (income[i] || 0);
            accExpense += (expense[i] || 0);

            return {
                day: viewMode === 'monthly' ? i + 1 : periodLabels[i],
                income: accIncome,
                expense: accExpense,
                invest: invest[i] || 0
            };
        });
        return [
            { day: 'Start', income: 0, expense: 0, invest: 0 },
            ...cumulativeData,
        ];
    }, [dailyIncome, dailyExpense, dailyInvest, paddingDays, periodLabels, viewMode, visiblePeriodCount]);

    // --- Prepare Data for Category Breakdown and Summary Cards ---
    const currentViewTransactions = useMemo(() => {
        if (viewMode === 'monthly') {
            return transactions || [];
        }

        if (viewMode === 'alltime') {
            return buildAllTimeInsightData(allTransactions).transactions;
        }

        {
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

    const { diningStats, shoppingStats } = useMemo(() => {
        const txList = currentViewTransactions || [];
        let diningTotal = 0;
        let diningCount = 0;
        let shoppingTotal = 0;
        let shoppingCount = 0;

        const bucketCount = 6;
        const diningBuckets = Array(bucketCount).fill(0);
        const shoppingBuckets = Array(bucketCount).fill(0);

        if (txList.length > 0) {
            const timestamps = txList
                .map((t) => new Date(t.Timestamp).getTime())
                .filter((time) => Number.isFinite(time));
            const minTime = timestamps.length ? Math.min(...timestamps) : 0;
            const maxTime = timestamps.length ? Math.max(...timestamps) : 1;
            const timeRange = Math.max(1, maxTime - minTime);

            txList.forEach((t) => {
                const amt = Number(t.Amount || 0);
                if (amt <= 0) return;
                const label = String(t.Label || '').toLowerCase();
                const isExpense = t.Category === "Expense" || t.Type === "Expense" || t.Type === "Debit";
                if (!isExpense && t.Category !== "Dining" && t.Category !== "Shopping") return;

                const tTime = new Date(t.Timestamp).getTime();
                const bucketIdx = Math.min(
                    bucketCount - 1,
                    Math.max(0, Math.floor(((tTime - minTime) / timeRange) * bucketCount))
                );

                if (label.includes('dining') || label.includes('food') || label.includes('restaurant') || label.includes('cafe')) {
                    diningTotal += amt;
                    diningCount++;
                    diningBuckets[bucketIdx] += amt;
                } else if (label.includes('shopping') || label.includes('retail') || label.includes('clothing') || label.includes('merchandise')) {
                    shoppingTotal += amt;
                    shoppingCount++;
                    shoppingBuckets[bucketIdx] += amt;
                }
            });
        }

        const buildSparkline = (buckets) => {
            const maxB = Math.max(...buckets, 1);
            const width = 100;
            const height = 26;
            const padY = 3;
            const usableH = height - padY * 2;
            const step = width / (bucketCount - 1);

            const points = buckets.map((v, i) => {
                const x = i * step;
                const y = height - padY - (v / maxB) * usableH;
                return { x, y };
            });

            let pathD = `M ${points[0].x} ${points[0].y}`;
            for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[i];
                const p1 = points[i + 1];
                const cpX = (p0.x + p1.x) / 2;
                pathD += ` C ${cpX} ${p0.y}, ${cpX} ${p1.y}, ${p1.x} ${p1.y}`;
            }

            const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

            return { pathD, areaD, hasData: buckets.some((b) => b > 0) };
        };

        // Calculate previous period comparison
        let prevDiningTotal = 0;
        let prevShoppingTotal = 0;
        let hasPrevPeriod = false;

        if (viewMode === 'monthly' && allTransactions) {
            const prevYear = month === 0 ? year - 1 : year;
            const prevMonth = month === 0 ? 11 : month - 1;
            const prevKey = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}`;
            const prevVal = allTransactions[prevKey];
            if (prevVal) {
                hasPrevPeriod = true;
                const prevTx = prevVal.transactions || [];
                prevTx.forEach((t) => {
                    const amt = Number(t.Amount || 0);
                    if (amt <= 0) return;
                    const label = String(t.Label || '').toLowerCase();
                    const isExpense = t.Category === "Expense" || t.Type === "Expense" || t.Type === "Debit";
                    if (!isExpense && t.Category !== "Dining" && t.Category !== "Shopping") return;
                    if (label.includes('dining') || label.includes('food') || label.includes('restaurant') || label.includes('cafe')) {
                        prevDiningTotal += amt;
                    } else if (label.includes('shopping') || label.includes('retail') || label.includes('clothing') || label.includes('merchandise')) {
                        prevShoppingTotal += amt;
                    }
                });
            }
        } else if (viewMode === 'yearly' && allTransactions) {
            const prevYear = year - 1;
            let foundPrevYear = false;
            Object.entries(allTransactions).forEach(([key, val]) => {
                const [tYear] = key.split('-').map(Number);
                if (tYear === prevYear && val && val.transactions) {
                    foundPrevYear = true;
                    val.transactions.forEach((t) => {
                        const amt = Number(t.Amount || 0);
                        if (amt <= 0) return;
                        const label = String(t.Label || '').toLowerCase();
                        const isExpense = t.Category === "Expense" || t.Type === "Expense" || t.Type === "Debit";
                        if (!isExpense && t.Category !== "Dining" && t.Category !== "Shopping") return;
                        if (label.includes('dining') || label.includes('food') || label.includes('restaurant') || label.includes('cafe')) {
                            prevDiningTotal += amt;
                        } else if (label.includes('shopping') || label.includes('retail') || label.includes('clothing') || label.includes('merchandise')) {
                            prevShoppingTotal += amt;
                        }
                    });
                }
            });
            hasPrevPeriod = foundPrevYear;
        }

        // Calculate daily average comparison for Dining vs previous period
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const currentDate = now.getDate();

        let currentDaysCount = 1;
        let prevDaysCount = 1;

        if (viewMode === 'monthly') {
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const isCurrentMonth = year === currentYear && month === currentMonth;
            currentDaysCount = isCurrentMonth ? Math.max(1, currentDate) : daysInMonth;

            const prevYear = month === 0 ? year - 1 : year;
            const prevMonth = month === 0 ? 11 : month - 1;
            prevDaysCount = new Date(prevYear, prevMonth + 1, 0).getDate();
        } else if (viewMode === 'yearly') {
            const isCurrentYear = year === currentYear;
            if (isCurrentYear) {
                const startOfYear = new Date(year, 0, 1);
                currentDaysCount = Math.max(1, Math.ceil((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)));
            } else {
                currentDaysCount = 365;
            }
            prevDaysCount = 365;
        }

        const currentDiningDailyAvg = diningTotal / currentDaysCount;
        const prevDiningDailyAvg = prevDiningTotal / prevDaysCount;

        const formatDiningAvgBadge = () => {
            if (!hasPrevPeriod || prevDiningDailyAvg === 0) {
                if (currentDiningDailyAvg > 0) return { text: '▲ 100%', isIncrease: true };
                return { text: '0%', isIncrease: null };
            }

            const diff = currentDiningDailyAvg - prevDiningDailyAvg;
            const pct = Math.round((diff / prevDiningDailyAvg) * 100);

            if (pct === 0) {
                return { text: '0%', isIncrease: null };
            }
            if (pct > 0) {
                return { text: `▲ ${pct}%`, isIncrease: true };
            }
            return { text: `▼ ${Math.abs(pct)}%`, isIncrease: false };
        };

        const diningDiff = formatDiningAvgBadge();

        const totalExpenseSafe = Math.max(1, totalExpense);

        return {
            diningStats: {
                total: diningTotal,
                count: diningCount,
                percentage: (diningTotal / totalExpenseSafe) * 100,
                avg: diningCount > 0 ? diningTotal / diningCount : 0,
                sparkline: buildSparkline(diningBuckets),
                diff: diningDiff,
            },
            shoppingStats: {
                total: shoppingTotal,
                count: shoppingCount,
                percentage: (shoppingTotal / totalExpenseSafe) * 100,
                avg: shoppingCount > 0 ? shoppingTotal / shoppingCount : 0,
                sparkline: buildSparkline(shoppingBuckets),
            },
        };
    }, [currentViewTransactions, totalExpense, allTransactions, viewMode, year, month]);

    const cashFlowBarData = useMemo(() => {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const currentDate = now.getDate();

        let items = [];

        if (viewMode === 'monthly') {
            // MONTHLY: Last 12 days
            const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
            const isViewingCurrentMonth = year === currentYear && month === currentMonth;

            const anchorDay = isViewingCurrentMonth ? Math.min(daysInCurrentMonth, currentDate) : daysInCurrentMonth;
            const startDay = Math.max(1, anchorDay - 11);
            const endDay = Math.min(daysInCurrentMonth, startDay + 11);
            const actualStartDay = Math.max(1, endDay - 11);

            const monthShort = new Date(year, month).toLocaleString('en-US', { month: 'short' });

            for (let d = actualStartDay; d <= endDay; d++) {
                const dayIndex = paddingDays + (d - 1);
                const income = dailyIncome[dayIndex] || 0;
                const expense = dailyExpense[dayIndex] || 0;
                const prevInvest = d > 1 ? (dailyInvest[paddingDays + (d - 2)] || 0) : 0;
                const currInvest = dailyInvest[dayIndex] || 0;
                const investDelta = Math.max(0, currInvest - prevInvest);

                const isCurrent = isViewingCurrentMonth && d === currentDate;
                const isSelected = isCurrent || (!isViewingCurrentMonth && d === endDay);

                items.push({
                    key: `day-${d}`,
                    shortLabel: String(d),
                    fullLabel: `${monthShort} ${d}, ${year}`,
                    inflow: income,
                    outflow: expense,
                    invest: investDelta,
                    isCurrent,
                    isSelected,
                });
            }
        } else if (viewMode === 'yearly') {
            // YEARLY: 12 months of the year
            const isViewingCurrentYear = year === currentYear;
            let prevInvestVal = 0;

            for (let m = 0; m < 12; m++) {
                const d = new Date(year, m, 1);
                const key = `${year}-${String(m + 1).padStart(2, '0')}`;
                const monthShort = d.toLocaleString('en-US', { month: 'short' });
                const monthInitial = monthShort.charAt(0);

                let mIncome = 0;
                let mExpense = 0;

                if (allTransactions && allTransactions[key]) {
                    mIncome = Number(allTransactions[key].totalIncome || 0);
                    mExpense = Number(allTransactions[key].totalExpense || 0);
                }

                const currInvest = dailyInvest[m] || 0;
                const investDelta = Math.max(0, currInvest - prevInvestVal);
                prevInvestVal = currInvest;

                const isCurrent = isViewingCurrentYear && m === currentMonth;
                const isSelected = isCurrent || (!isViewingCurrentYear && m === 11);

                items.push({
                    key,
                    shortLabel: monthInitial,
                    fullLabel: `${monthShort} ${year}`,
                    inflow: mIncome,
                    outflow: mExpense,
                    invest: investDelta,
                    isCurrent,
                    isSelected,
                });
            }
        } else {
            // ALL TIME: Last 12 years
            const startYear = currentYear - 11;
            const yearEndTimes = [];
            for (let y = startYear; y <= currentYear; y++) {
                yearEndTimes.push(new Date(y + 1, 0, 1).getTime() - 1);
            }

            const allTimeInvestValues = getRebasedInvestmentPeriodValues(
                investmentTimeline,
                new Date(startYear, 0, 1),
                yearEndTimes
            );

            let prevYearInvest = 0;
            for (let y = startYear; y <= currentYear; y++) {
                const yIdx = y - startYear;
                let yIncome = 0;
                let yExpense = 0;

                if (allTransactions) {
                    Object.entries(allTransactions).forEach(([key, val]) => {
                        const [tYear] = key.split('-').map(Number);
                        if (tYear === y && val) {
                            yIncome += Number(val.totalIncome || 0);
                            yExpense += Number(val.totalExpense || 0);
                        }
                    });
                }

                const currYearInvest = allTimeInvestValues[yIdx] || 0;
                const investDelta = Math.max(0, currYearInvest - prevYearInvest);
                prevYearInvest = currYearInvest;

                const isCurrent = y === currentYear;

                items.push({
                    key: `year-${y}`,
                    shortLabel: `'${String(y).slice(-2)}`,
                    fullLabel: String(y),
                    inflow: yIncome,
                    outflow: yExpense,
                    invest: investDelta,
                    isCurrent,
                    isSelected: isCurrent,
                });
            }
        }

        const maxPeriodTotal = Math.max(
            ...items.map((it) => it.inflow + it.outflow + it.invest),
            1
        );

        return { items, maxPeriodTotal };
    }, [viewMode, year, month, paddingDays, dailyIncome, dailyExpense, dailyInvest, allTransactions, investmentTimeline]);

    const periodCaption = viewMode === 'alltime'
        ? 'Full financial history'
        : viewMode === 'yearly'
            ? String(year)
            : new Date(year, month).toLocaleDateString('en-CA', {
                month: 'long',
                year: 'numeric'
            });

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
            <header className="Insight_Header">
                <div>
                    <span className="Insight_Eyebrow">Financial overview</span>
                    <h1>Insights</h1>
                </div>
            </header>

            {/* View Mode Toggle */}
            <div className="Insight_PeriodToggle" style={{
                display: 'flex',
                gap: '10px',
                margin: '10px 0 5px 0',
                justifyContent: 'center',
                padding: '4px',
                width: '100%',
                boxSizing: 'border-box',
            }}>
                <span
                    aria-hidden="true"
                    className={`Insight_PeriodIndicator ${viewMode}`}
                />
                <ScalableElement
                    as="button"
                    className={`Insight_PeriodButton ${viewMode === 'monthly' ? 'is-active' : ''}`}
                    onClick={() => setViewMode('monthly')}
                    style={{
                        background: 'radial-gradient(circle at 30% -20%, var(--Bc-3) -100%, var(--Ec-4) 65%)',
                        color: viewMode === 'monthly' ? 'var(--Bc-1)' : 'var(--Ac-1)',
                        outline: '1px solid var(--Bc-3)',
                        border: 'none',
                        borderRadius: '30px',
                        padding: '10px 25px',
                        flex: 1,
                        minWidth: 0,
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
                    className={`Insight_PeriodButton ${viewMode === 'yearly' ? 'is-active' : ''}`}
                    onClick={() => setViewMode('yearly')}
                    style={{
                        background: 'radial-gradient(circle at 30% -20%, var(--Bc-3) -100%, var(--Ec-4) 65%)',
                        color: viewMode === 'yearly' ? 'var(--Bc-1)' : 'var(--Ac-1)',
                        outline: '1px solid var(--Bc-3)',
                        border: 'none',
                        borderRadius: '30px',
                        padding: '10px 25px',
                        flex: 1,
                        minWidth: 0,
                        fontSize: '0.8rem',
                        fontWeight: viewMode === 'yearly' ? '600' : '200',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease'
                    }}
                >
                    Yearly
                </ScalableElement>
                <ScalableElement
                    as="button"
                    className={`Insight_PeriodButton ${viewMode === 'alltime' ? 'is-active' : ''}`}
                    onClick={() => setViewMode('alltime')}
                    style={{
                        background: 'radial-gradient(circle at 30% -20%, var(--Bc-3) -100%, var(--Ec-4) 65%)',
                        color: viewMode === 'alltime' ? 'var(--Bc-1)' : 'var(--Ac-1)',
                        outline: '1px solid var(--Bc-3)',
                        border: 'none',
                        borderRadius: '30px',
                        padding: '10px 20px',
                        flex: 1,
                        minWidth: 0,
                        fontSize: '0.8rem',
                        fontWeight: viewMode === 'alltime' ? '600' : '200',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease',
                        whiteSpace: 'nowrap'
                    }}
                >
                    All Time
                </ScalableElement>
            </div>

            <div className="Insight_Hero" style={{
                width: "100%",
                display: "block",
            }}>
                {/* Cash Flow Balance Card with 7-Day Pill Chart */}
                <div className="Insight_HeroCard Insight_CashFlowCard">
                    {/* Top Row: Overall Balance & Percentage Change */}
                    <div className="Insight_HeroHeader">
                        <div className="Insight_HeroCopy">
                            <span>{viewMode === 'alltime' ? 'Net account value' : 'Cash-flow balance'}</span>
                            <small>{periodCaption}</small>
                        </div>

                        <div className="Insight_HeroValue" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {percentageChange !== null && (
                                <div className={`Insight_ChangeBadge ${Number(percentageChange) >= 0 ? 'positive' : 'negative'}`}>
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
                                fontSize: "1.08rem",
                                fontWeight: "650",
                                color: totalBalance >= 0 ? "var(--Fc-1)" : "var(--Gc-1)"
                            }}>
                                ${formatCurrency(totalBalance)}
                            </span>
                        </div>
                    </div>

                    {/* Bottom Row: Inflow/Outflow Summary + 7-Day Pill Chart */}
                    <div className="Insight_CashFlowBody">
                        {/* Left: Inflow, Outflow, and Invest Totals */}
                        <div className="Insight_CashFlowTotals">
                            <div className="Insight_CashFlowTotalItem">
                                <span className="Insight_CashFlowAmount" style={{ color: "var(--Fc-1)" }}>
                                    {formatCompact(totalIncome)}
                                </span>
                                <div className="Insight_CashFlowLabel">
                                    <span className="Insight_CashFlowDot inflow" />
                                    <span>Inflow</span>
                                </div>
                            </div>
                            <div className="Insight_CashFlowTotalItem">
                                <span className="Insight_CashFlowAmount" style={{ color: "var(--Gc-1)" }}>
                                    {formatCompact(totalExpense)}
                                </span>
                                <div className="Insight_CashFlowLabel">
                                    <span className="Insight_CashFlowDot outflow" />
                                    <span>Outflow</span>
                                </div>
                            </div>
                            <div className="Insight_CashFlowTotalItem">
                                <span className="Insight_CashFlowAmount" style={{ color: "var(--Ac-1)" }}>
                                    {formatCompact(displayedInvestTotal)}
                                </span>
                                <div className="Insight_CashFlowLabel">
                                    <span className="Insight_CashFlowDot invest" />
                                    <span>Invest</span>
                                </div>
                            </div>
                        </div>

                        {/* Right: Multi-Mode Pill Bar Chart (12 Days on Monthly, 12 Months on Yearly, 12 Years on All Time) */}
                        <div className="Insight_CashFlowChart">
                            {cashFlowBarData.items.map((m, idx) => {
                                const maxChartHeight = 66;
                                const hasData = m.inflow > 0 || m.outflow > 0 || m.invest > 0;
                                const totalForMonth = m.inflow + m.outflow + m.invest;

                                let inflowHeight = 0;
                                let outflowHeight = 0;
                                let investHeight = 0;

                                if (hasData) {
                                    const scaledHeight = (totalForMonth / cashFlowBarData.maxPeriodTotal) * maxChartHeight;
                                    const usableHeight = Math.max(scaledHeight, 12);
                                    const activeCount = (m.inflow > 0 ? 1 : 0) + (m.outflow > 0 ? 1 : 0) + (m.invest > 0 ? 1 : 0);

                                    if (activeCount > 1) {
                                        inflowHeight = m.inflow > 0 ? Math.max(Math.round((m.inflow / totalForMonth) * usableHeight), 4) : 0;
                                        outflowHeight = m.outflow > 0 ? Math.max(Math.round((m.outflow / totalForMonth) * usableHeight), 4) : 0;
                                        investHeight = m.invest > 0 ? Math.max(Math.round((m.invest / totalForMonth) * usableHeight), 4) : 0;
                                    } else if (m.inflow > 0) {
                                        inflowHeight = Math.max(Math.round(usableHeight), 6);
                                    } else if (m.outflow > 0) {
                                        outflowHeight = Math.max(Math.round(usableHeight), 6);
                                    } else {
                                        investHeight = Math.max(Math.round(usableHeight), 6);
                                    }
                                }

                                const tooltip = `${m.fullLabel}: Income $${formatCurrency(m.inflow)} · Expense $${formatCurrency(m.outflow)}${m.invest > 0 ? ` · Invest $${formatCurrency(m.invest)}` : ''}`;
                                const isHighlighted = m.isSelected || m.isCurrent;

                                return (
                                    <div
                                        key={m.key || idx}
                                        className={`Insight_CashFlowCol ${isHighlighted ? 'is-active' : ''}`}
                                        title={tooltip}
                                    >
                                        <div
                                            className="Insight_CashFlowBarContainer"
                                            style={{ animationDelay: `${idx * 30}ms` }}
                                        >
                                            {hasData ? (
                                                <>
                                                    {investHeight > 0 && (
                                                        <div
                                                            className="Insight_CashFlowPill invest"
                                                            style={{
                                                                height: `${investHeight}px`,
                                                            }}
                                                        />
                                                    )}
                                                    {outflowHeight > 0 && (
                                                        <div
                                                            className="Insight_CashFlowPill outflow"
                                                            style={{
                                                                height: `${outflowHeight}px`,
                                                                marginTop: investHeight > 0 ? "3px" : "0px",
                                                            }}
                                                        />
                                                    )}
                                                    {inflowHeight > 0 && (
                                                        <div
                                                            className="Insight_CashFlowPill inflow"
                                                            style={{
                                                                height: `${inflowHeight}px`,
                                                                marginTop: (investHeight > 0 || outflowHeight > 0) ? "3px" : "0px",
                                                            }}
                                                        />
                                                    )}
                                                </>
                                            ) : (
                                                <div className="Insight_CashFlowPill empty" />
                                            )}
                                        </div>
                                        <span className="Insight_CashFlowDayLabel">{m.shortLabel}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* 2 Category Squares: Dining (Left) and Shopping (Right) */}
            <div className="Insight_CategorySquares">
                {/* Left: Dining Square */}
                <div className="Insight_CategorySquareCard dining">
                    <div className="Insight_SquareHeader">
                        <div className="Insight_SquareIconBadge dining">
                            <Utensils size={13} strokeWidth={2.2} />
                        </div>
                        <span className={`Insight_SquareBadge ${diningStats.diff.isIncrease === true ? 'increase' : diningStats.diff.isIncrease === false ? 'decrease' : 'neutral'}`}>
                            {diningStats.diff.text}
                        </span>
                    </div>

                    <div className="Insight_SquareMain">
                        <span className="Insight_SquareTitle">Dining</span>
                        <strong className="Insight_SquareAmount">${formatCurrency(diningStats.total)}</strong>
                    </div>

                    {/* Mini Sparkline Chart */}
                    <div className="Insight_SquareChartWrap">
                        <svg className="Insight_SquareSvg" viewBox="0 0 100 26" preserveAspectRatio="none">
                            <defs>
                                <linearGradient id="diningGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--Bc-1)" stopOpacity="0.45" />
                                    <stop offset="100%" stopColor="var(--Bc-1)" stopOpacity="0.0" />
                                </linearGradient>
                            </defs>
                            {diningStats.sparkline.hasData ? (
                                <>
                                    <path d={diningStats.sparkline.areaD} fill="url(#diningGrad)" />
                                    <path d={diningStats.sparkline.pathD} fill="none" stroke="var(--Bc-1)" strokeWidth="2" strokeLinecap="round" />
                                </>
                            ) : (
                                <line x1="0" y1="22" x2="100" y2="22" stroke="var(--Ac-4)" strokeWidth="1.5" strokeDasharray="3 3" />
                            )}
                        </svg>
                    </div>

                    <div className="Insight_SquareFooter">
                        <span>{diningStats.count} {diningStats.count === 1 ? 'txn' : 'txns'}</span>
                        <span>{diningStats.avg > 0 ? `Avg $${Math.round(diningStats.avg)}` : 'No spend'}</span>
                    </div>
                </div>

                {/* Right: Shopping Square */}
                <div className="Insight_CategorySquareCard shopping">
                    <div className="Insight_SquareHeader">
                        <div className="Insight_SquareIconBadge shopping">
                            <ShoppingBag size={13} strokeWidth={2.2} />
                        </div>
                        <span className="Insight_SquareBadge shopping">
                            {shoppingStats.count > 0 ? `${Math.round(shoppingStats.percentage)}%` : '0%'}
                        </span>
                    </div>

                    <div className="Insight_SquareMain">
                        <span className="Insight_SquareTitle">Shopping</span>
                        <strong className="Insight_SquareAmount">${formatCurrency(shoppingStats.total)}</strong>
                    </div>

                    {/* Mini Sparkline Chart */}
                    <div className="Insight_SquareChartWrap">
                        <svg className="Insight_SquareSvg" viewBox="0 0 100 26" preserveAspectRatio="none">
                            <defs>
                                <linearGradient id="shoppingGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--Cc-1)" stopOpacity="0.45" />
                                    <stop offset="100%" stopColor="var(--Cc-1)" stopOpacity="0.0" />
                                </linearGradient>
                            </defs>
                            {shoppingStats.sparkline.hasData ? (
                                <>
                                    <path d={shoppingStats.sparkline.areaD} fill="url(#shoppingGrad)" />
                                    <path d={shoppingStats.sparkline.pathD} fill="none" stroke="var(--Cc-1)" strokeWidth="2" strokeLinecap="round" />
                                </>
                            ) : (
                                <line x1="0" y1="22" x2="100" y2="22" stroke="var(--Ac-4)" strokeWidth="1.5" strokeDasharray="3 3" />
                            )}
                        </svg>
                    </div>

                    <div className="Insight_SquareFooter">
                        <span>{shoppingStats.count} {shoppingStats.count === 1 ? 'txn' : 'txns'}</span>
                        <span>{shoppingStats.avg > 0 ? `Avg $${Math.round(shoppingStats.avg)}` : 'No spend'}</span>
                    </div>
                </div>
            </div>

            <div className="Insight_KpiGrid" style={{
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
                {renderGrid("Invest", "#fff", dailyInvest, maxInvest, displayedInvestTotal)}
            </div>

            {viewMode === 'monthly' && (
                <MonthlyAiBrief
                    month={`${year}-${String(month + 1).padStart(2, '0')}`}
                    transactions={transactions || []}
                    allTransactions={allTransactions}
                />
            )}

            <section className="Insight_ChartCard" style={{ width: "100%", flexShrink: 0 }}>
                <div className="Insight_SectionTitle" style={{
                    width: "100%",
                    paddingLeft: "10px",
                    fontSize: "0.8rem",
                    fontWeight: "bold",
                    color: "var(--Ac-3)",
                    marginBottom: "5px"
                }}>
                    {viewMode === 'alltime'
                        ? 'All-Time Trend'
                        : viewMode === 'yearly'
                            ? `${year} Annual Trend`
                            : 'Monthly Trend'}
                </div>
                <InsightTrendChart data={chartData} />
            </section>

            {/* Expense Warning */}
            {anomalies.length > 0 && (
                <section className="Insight_AnomalyCard" style={{
                    width: "100%",
                    marginTop: "5px",
                    marginBottom: "10px",
                    padding: "10px",
                    borderRadius: "15px",
                    background: "rgba(255, 59, 48, 0.1)",
                    border: "1px solid var(--Gc-1)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: "5px",
                    boxSizing: "border-box",
                    textAlign: "left"
                }}>
                    <div className="Insight_AnomalyHeader" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--Gc-1)" }}>
                        <span className="Insight_AnomalyIcon">!</span>
                        <div>
                            <strong>Unusual spending</strong>
                            <small>Higher than your recent pattern</small>
                        </div>
                    </div>
                    {anomalies.map((t, idx) => (
                        <div className="Insight_AnomalyItem"
                            key={t.id || `${t.Timestamp}-${t.Amount}-${idx}`}
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "flex-start",
                                gap: "5px",
                                fontSize: "0.8rem",
                                color: "var(--Ac-3)",
                                padding: "8px 0 8px 28px",
                                borderTop: idx > 0 ? "1px solid rgba(255,255,255,0.08)" : "none"
                            }}
                        >
                            <div className="Insight_AnomalyCopy" style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
                                <strong style={{ color: "var(--Ac-1)", fontSize: "0.82rem", overflowWrap: "anywhere" }}>
                                    {getTransactionDisplayReason(t.Reason, t.Label)}
                                </strong>
                                <span style={{ fontSize: "0.7rem", opacity: 0.75 }}>
                                    {[t.Label || "Expense", t.Account, t.Timestamp && new Date(t.Timestamp).toLocaleDateString("en-CA", {
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric"
                                    })].filter(Boolean).join(" · ")}
                                </span>
                            </div>
                            <span style={{ fontWeight: "600", color: "var(--Gc-1)", whiteSpace: "nowrap", textAlign: "left" }}>
                                ${Number(t.Amount).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                    ))}
                </section>
            )}

            {/* Category Breakdown */}
            <InsightCategoryBreakdown transactions={currentViewTransactions} />
        </animated.div>
    );
};

export default Insight;
