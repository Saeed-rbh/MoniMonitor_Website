import React, { useMemo } from 'react';

const InsightFacts = ({ transactions, allTransactions, viewMode, currentDate }) => {

    const stats = useMemo(() => {
        if (!transactions || transactions.length === 0) return null;

        let totalIncome = 0;
        let totalExpense = 0;
        let totalInvest = 0;
        const merchantMap = {};
        let maxTransaction = { Amount: 0, Label: 'None' };

        // Busiest Day Stats
        const dayStats = {}; // { count: 0, spend: 0, dateObj: Date }
        let totalCount = 0;

        // Process transactions
        transactions.forEach(t => {
            const amt = Number(t.Amount);
            if (isNaN(amt)) return;

            const isIncome = t.Category === "Income" || t.Type === "Income" || t.Type === "Credit";
            const isExpense = t.Category === "Expense" || t.Type === "Expense" || t.Type === "Debit";
            const isInvest = t.Category === "Save&Invest" || t.Type === "Transfer" || t.Type === "Invest";

            // 1. Income/Expense/Invest Calc
            if (isIncome) totalIncome += amt;
            else if (isExpense) totalExpense += amt;
            else if (isInvest) {
                totalInvest += amt;
            }

            // 2. Top Merchant (Expenses only)
            if (isExpense) {
                const merchant = t.Reason || t.Label || "Unknown";
                merchantMap[merchant] = (merchantMap[merchant] || 0) + amt;

                if (amt > maxTransaction.Amount) {
                    maxTransaction = { Amount: amt, Label: merchant, Date: t.Timestamp };
                }
            }

            // 3. Busiest Day (Count frequency & Spend)
            if (t.Timestamp) {
                const date = new Date(t.Timestamp.replace(" ", "T"));
                // Aggregate by unique date (YYYY-MM-DD)
                const dateKey = date.toDateString();

                if (!dayStats[dateKey]) dayStats[dateKey] = { count: 0, spend: 0, dateObj: date };
                dayStats[dateKey].count += 1;

                if (isExpense) {
                    dayStats[dateKey].spend += amt;
                }
                totalCount++;
            }
        });

        // Current Metrics
        const investedRate = totalIncome > 0 ? (totalInvest / totalIncome) * 100 : 0;

        // Previous Period Metrics
        let prevInvestedRate = null;
        if (allTransactions && currentDate) {
            const cDate = new Date(currentDate);
            let prevKey = "";
            if (viewMode === 'monthly') {
                // Previous Month
                const pDate = new Date(cDate.getFullYear(), cDate.getMonth() - 1, 1);
                prevKey = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}`;
            } else {
                prevKey = `${cDate.getFullYear() - 1}-Annual`;
            }

            const prevData = allTransactions[prevKey];
            if (prevData && prevData.totalIncome > 0) {
                const pIncome = prevData.totalIncome || 0;
                const pInvest = prevData.totalSaving || 0;
                prevInvestedRate = (pInvest / pIncome) * 100;
            }
        }

        const investedChange = prevInvestedRate !== null ? (investedRate - prevInvestedRate) : null;

        // Top Merchant
        let topMerchant = { name: "None", amount: 0 };
        Object.entries(merchantMap).forEach(([name, amount]) => {
            if (amount > topMerchant.amount) {
                topMerchant = { name, amount };
            }
        });

        // Busiest Day (By Specific Date)
        let busyDay = { name: "None", count: 0, spend: 0, percent: 0, dateObj: null };
        Object.entries(dayStats).forEach(([key, stat]) => {
            if (stat.count > busyDay.count) {
                busyDay = {
                    name: key,
                    count: stat.count,
                    spend: stat.spend,
                    percent: totalCount > 0 ? (stat.count / totalCount) * 100 : 0,
                    dateObj: stat.dateObj
                };
            }
        });

        return {
            investedRate,
            investedChange,
            topMerchant,
            maxTransaction,
            busyDay
        };
    }, [transactions, allTransactions, viewMode, currentDate]);

    if (!stats) return null;

    const formatCurrency = (val) => Number(val).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

    // Helper to format date nicely "Mon, Dec 25"
    const formatDate = (dateObj) => {
        if (!dateObj) return "None";
        return dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    };

    const FactCard = ({ title, value, subtext, icon, color }) => (
        <div style={{
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '20px',
            padding: '12px',
            border: '1px solid var(--Bc-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0px',
            minWidth: '130px',
            flex: 1
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '15px' }}>
                <span style={{ fontSize: '0.9rem' }}>{icon}</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--Ac-3)', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{title}</span>
            </div>

            <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--Ac-1)', alignSelf: 'flex-end', lineHeight: '1', marginBottom: '2px', textAlign: 'right' }}>
                {value}
            </div>

            <div style={{ fontSize: '0.7rem', color: 'var(--Ac-3)', opacity: 0.8, alignSelf: 'flex-end', textAlign: 'right', lineHeight: '1' }}>
                {subtext}
            </div>
        </div>
    );

    // Drag to Scroll Logic
    const scrollRef = React.useRef(null);
    const [isDragging, setIsDragging] = React.useState(false);
    const [startX, setStartX] = React.useState(0);
    const [scrollLeft, setScrollLeft] = React.useState(0);

    const onMouseDown = (e) => {
        setIsDragging(true);
        setStartX(e.pageX - scrollRef.current.offsetLeft);
        setScrollLeft(scrollRef.current.scrollLeft);
    };

    const onMouseLeave = () => {
        setIsDragging(false);
    };

    const onMouseUp = () => {
        setIsDragging(false);
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const x = e.pageX - scrollRef.current.offsetLeft;
        const walk = (x - startX) * 2; // Scroll-fast
        scrollRef.current.scrollLeft = scrollLeft - walk;
    };

    return (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '0', marginBottom: '5px' }}>
            <h3 style={{
                margin: '0',
                paddingLeft: '5px',
                textAlign: 'left',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                color: 'var(--Ac-3)',
                textTransform: 'uppercase',
                letterSpacing: '1px'
            }}>
                Did You Know?
            </h3>

            <div
                ref={scrollRef}
                className="no-scrollbar"
                onMouseDown={onMouseDown}
                onMouseLeave={onMouseLeave}
                onMouseUp={onMouseUp}
                onMouseMove={onMouseMove}
                style={{
                    display: 'flex',
                    gap: '10px',
                    overflowX: 'auto',
                    paddingBottom: '5px',
                    cursor: isDragging ? 'grabbing' : 'grab'
                }}
            >
                {/* Invested % */}
                <FactCard
                    title="Invested"
                    icon="📈"
                    value={`${stats.investedRate.toFixed(1)}%`}
                    subtext={
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                            <span style={{ whiteSpace: 'nowrap' }}>of income</span>
                            {stats.investedChange !== null && (
                                <span style={{
                                    color: stats.investedChange >= 0 ? 'var(--Fc-1)' : 'var(--Gc-1)',
                                    fontWeight: 'bold',
                                    whiteSpace: 'nowrap'
                                }}>
                                    {stats.investedChange >= 0 ? '▲' : '▼'} {Math.abs(stats.investedChange).toFixed(1)}% vs last
                                </span>
                            )}
                        </div>
                    }
                    color={stats.investedRate > 15 ? "var(--Fc-1)" : stats.investedRate > 0 ? "orange" : "var(--Ac-3)"}
                />

                {/* Top Merchant */}
                {stats.topMerchant.amount > 0 && (
                    <FactCard
                        title="Top Merchant"
                        icon="🏆"
                        value={stats.topMerchant.name}
                        subtext={`${formatCurrency(stats.topMerchant.amount)} spent`}
                        color="var(--Bc-1)" // Blue
                    />
                )}

                {/* Largest Spend */}
                {stats.maxTransaction.Amount > 0 && (
                    <FactCard
                        title="Biggest Buys"
                        icon="🛍️"
                        value={stats.maxTransaction.Label}
                        subtext={`${formatCurrency(stats.maxTransaction.Amount)} single item`}
                        color="var(--Ec-1)" // Purpleish
                    />
                )}

                {/* Busiest Day */}
                {stats.busyDay.count > 0 && (
                    <FactCard
                        title="Busiest Day"
                        icon="📅"
                        value={formatDate(stats.busyDay.dateObj)}
                        subtext={
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
                                <span>{stats.busyDay.count} transactions</span>
                                <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>
                                    ({stats.busyDay.percent.toFixed(0)}% of total)
                                </span>
                                <span style={{ color: 'var(--Bc-1)', fontWeight: 'bold' }}>
                                    {formatCurrency(stats.busyDay.spend)} spent
                                </span>
                            </div>
                        }
                        color="var(--Ac-3)"
                    />
                )}
            </div>
        </div>
    );
};

export default InsightFacts;
