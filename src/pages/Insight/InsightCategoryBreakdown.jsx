import React, { useMemo, useState } from 'react';
import { PieChart, ChevronDown, ChevronUp } from 'lucide-react';
import { getTransactionIcon } from '../../components/Categories';

const InsightCategoryBreakdown = ({ transactions }) => {
    const [showAllExpenses, setShowAllExpenses] = useState(false);

    const { expenseStats, totalExpense } = useMemo(() => {
        if (!transactions || transactions.length === 0) {
            return { expenseStats: [], totalExpense: 0 };
        }

        const expenseMap = {};
        let total = 0;

        transactions.forEach((t) => {
            const amt = Number(t.Amount);
            if (isNaN(amt) || amt <= 0) return;

            const isExpense = t.Category === "Expense" || t.Type === "Expense" || t.Type === "Debit";
            if (!isExpense && t.Category !== "Dining" && t.Category !== "Shopping") return;

            const label = t.Label || "Other";

            if (!expenseMap[label]) {
                expenseMap[label] = { amount: 0, count: 0 };
            }
            expenseMap[label].amount += amt;
            expenseMap[label].count += 1;
            total += amt;
        });

        // Convert to Array & Sort descending by amount
        const stats = Object.entries(expenseMap)
            .map(([label, info]) => ({
                label,
                amount: info.amount,
                count: info.count,
                percentage: total > 0 ? (info.amount / total) * 100 : 0,
            }))
            .sort((a, b) => b.amount - a.amount);

        return {
            expenseStats: stats,
            totalExpense: total,
        };
    }, [transactions]);

    const formatAmount = (val) => {
        const num = Number(val || 0);
        if (num % 1 === 0) {
            return `$${Math.round(num).toLocaleString('en-CA')}`;
        }
        return `$${num.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    if (!transactions || transactions.length === 0 || expenseStats.length === 0) {
        return null;
    }

    const visibleStats = showAllExpenses ? expenseStats : expenseStats.slice(0, 4);

    return (
        <section className="Insight_BreakdownSection">
            <div className="Insight_BreakdownCard">
                {/* Header */}
                <div className="Insight_BreakdownHeader">
                    <div className="Insight_BreakdownHeaderLeft">
                        <div className="Insight_BreakdownIconBadge">
                            <PieChart size={14} strokeWidth={2.2} />
                        </div>
                        <div className="Insight_BreakdownHeaderText">
                            <strong>Expense Breakdown</strong>
                            <span>{expenseStats.length} {expenseStats.length === 1 ? 'category' : 'categories'} · {formatAmount(totalExpense)} total</span>
                        </div>
                    </div>
                </div>

                {/* Categories List */}
                <div className="Insight_BreakdownList">
                    {visibleStats.map((item, idx) => {
                        const icon = getTransactionIcon("Expense", item.label);
                        const pctRounded = Math.round(item.percentage);

                        return (
                            <div className="Insight_BreakdownItem" key={item.label || idx}>
                                <div className="Insight_BreakdownRow">
                                    <div className="Insight_BreakdownItemLeft">
                                        <div className="Insight_BreakdownCategoryIcon">
                                            {icon}
                                        </div>
                                        <span className="Insight_BreakdownLabel">{item.label}</span>
                                        <span className="Insight_BreakdownCount">
                                            · {item.count} {item.count === 1 ? 'txn' : 'txns'}
                                        </span>
                                    </div>

                                    <div className="Insight_BreakdownItemRight">
                                        <strong className="Insight_BreakdownAmount">
                                            {formatAmount(item.amount)}
                                        </strong>
                                        <span className="Insight_BreakdownPctBadge">
                                            {pctRounded}%
                                        </span>
                                    </div>
                                </div>

                                {/* Modern Glowing Progress Track */}
                                <div className="Insight_BreakdownTrack">
                                    <div
                                        className="Insight_BreakdownFill"
                                        style={{
                                            width: `${Math.min(100, Math.max(2, item.percentage))}%`,
                                        }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Show More / Show Less Toggle Button */}
                {expenseStats.length > 4 && (
                    <button
                        type="button"
                        className="Insight_BreakdownToggleBtn"
                        onClick={() => setShowAllExpenses((prev) => !prev)}
                    >
                        <span>{showAllExpenses ? 'Show Less' : `View All (${expenseStats.length})`}</span>
                        {showAllExpenses ? (
                            <ChevronUp size={13} strokeWidth={2.2} />
                        ) : (
                            <ChevronDown size={13} strokeWidth={2.2} />
                        )}
                    </button>
                )}
            </div>
        </section>
    );
};

export default InsightCategoryBreakdown;
