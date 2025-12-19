import React, { useMemo } from 'react';

const InsightCategoryBreakdown = ({ transactions }) => {

    const { incomeStats, expenseStats } = useMemo(() => {
        if (!transactions || transactions.length === 0) return { incomeStats: [], expenseStats: [] };

        const incomeMap = {};
        const expenseMap = {};
        let totalIncome = 0;
        let totalExpense = 0;

        transactions.forEach(t => {
            const amt = Number(t.Amount);
            if (isNaN(amt) || amt === 0) return;

            const label = t.Label || "Other";

            // Categorize
            const isIncome = t.Category === "Income" || t.Type === "Income" || t.Type === "Credit";
            const isExpense = t.Category === "Expense" || t.Type === "Expense" || t.Type === "Debit";

            if (isIncome) {
                incomeMap[label] = (incomeMap[label] || 0) + amt;
                totalIncome += amt;
            } else if (isExpense) {
                expenseMap[label] = (expenseMap[label] || 0) + amt;
                totalExpense += amt;
            }
        });

        // Convert to Arrays & Sort
        const fmt = (map, total) => Object.entries(map)
            .map(([label, amount]) => ({
                label,
                amount,
                percentage: total > 0 ? (amount / total) * 100 : 0
            }))
            .sort((a, b) => b.amount - a.amount);

        return {
            incomeStats: fmt(incomeMap, totalIncome),
            expenseStats: fmt(expenseMap, totalExpense)
        };
    }, [transactions]);

    const formatCurrency = (val) => val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const RenderList = ({ title, data, colorVar, emptyMsg }) => (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <h3 style={{
                margin: '0',
                paddingLeft: '5px',
                textAlign: 'left',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                color: 'var(--Ac-3)',
                opacity: 0.8,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                width: '100%'
            }}>
                {title}
            </h3>

            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '25px',
                padding: '20px',
                border: '1px solid var(--Bc-3)'
            }}>
                {data.length === 0 ? (
                    <span style={{ fontSize: '0.8rem', color: 'var(--Ac-1)', fontStyle: 'italic', opacity: 0.5 }}>{emptyMsg}</span>
                ) : (
                    data.map((item, idx) => (
                        <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                                <span style={{ color: 'var(--Ac-1)', fontWeight: 'normal' }}>{item.label}</span>
                                <span style={{ fontWeight: '300', color: colorVar }}>
                                    ${formatCurrency(item.amount)} <span style={{ opacity: 0.7, fontSize: '0.7rem', color: '#fff' }}>({Math.round(item.percentage)}%)</span>
                                </span>
                            </div>
                            {/* Progress Bar */}
                            <div style={{ width: '100%', height: '4px', background: 'var(--Bc-3)', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{
                                    width: `${item.percentage}%`,
                                    height: '100%',
                                    background: colorVar,
                                    borderRadius: '2px'
                                }} />
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    if (!transactions || transactions.length === 0) return null;

    return (
        <div style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px', // Reduced gap
            marginTop: '0px', // Close to box
            marginBottom: '20px'
        }}>
            <div style={{ display: 'flex', gap: '15px', flexDirection: 'row', flexWrap: 'wrap' }}>
                <RenderList
                    title="Expense Breakdown"
                    data={expenseStats}
                    colorVar="var(--Gc-1)"
                    emptyMsg="No Expense Data"
                />
            </div>
        </div>
    );
};

export default InsightCategoryBreakdown;
