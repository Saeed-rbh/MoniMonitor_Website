import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { TrendingUp } from 'lucide-react';

const InsightTrendChart = ({ data, title }) => {
    // data format: [{ day: 1, income: 100, expense: 50, invest: 20 }, ...]
    const [activeSeries, setActiveSeries] = useState({
        income: true,
        expense: true,
        invest: true,
    });

    const toggleSeries = (key) => {
        setActiveSeries((prev) => {
            const next = { ...prev, [key]: !prev[key] };
            // Ensure at least one series stays active
            if (!next.income && !next.expense && !next.invest) {
                return prev;
            }
            return next;
        });
    };

    // Custom Glassmorphic Tooltip
    const CustomTooltip = ({ active, payload, label }) => {
        if (!active || !payload || !payload.length) return null;

        const incomeEntry = payload.find((p) => p.dataKey === 'income');
        const expenseEntry = payload.find((p) => p.dataKey === 'expense');
        const investEntry = payload.find((p) => p.dataKey === 'invest');

        const incomeVal = incomeEntry ? Number(incomeEntry.value || 0) : 0;
        const expenseVal = expenseEntry ? Number(expenseEntry.value || 0) : 0;
        const netVal = incomeVal - expenseVal;

        const formattedLabel = typeof label === 'number' ? `Day ${label}` : label === 'Start' ? 'Period Start' : String(label);

        return (
            <div className="Insight_TrendTooltip">
                <div className="Insight_TrendTooltipHeader">
                    <span>{formattedLabel}</span>
                    {incomeEntry && expenseEntry && (
                        <span className={`Insight_TrendTooltipNet ${netVal >= 0 ? 'positive' : 'negative'}`}>
                            {netVal >= 0 ? `+$${Math.round(netVal).toLocaleString()}` : `-$${Math.round(Math.abs(netVal)).toLocaleString()}`}
                        </span>
                    )}
                </div>
                <div className="Insight_TrendTooltipList">
                    {payload.map((entry, index) => (
                        <div key={index} className="Insight_TrendTooltipRow">
                            <div className="Insight_TrendTooltipDotWrap">
                                <span className="Insight_TrendTooltipDot" style={{ backgroundColor: entry.color }} />
                                <span>{entry.name}</span>
                            </div>
                            <strong style={{ color: entry.color }}>
                                ${Number(entry.value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </strong>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const endDot = (color, isVisible) => ({ cx, cy, index }) => {
        if (!isVisible || index !== data.length - 1 || !Number.isFinite(cx) || !Number.isFinite(cy)) {
            return null;
        }
        return (
            <g>
                <circle cx={cx} cy={cy} r={5} fill={color} fillOpacity={0.25} />
                <circle cx={cx} cy={cy} r={3} fill={color} stroke="var(--Ec-1)" strokeWidth={1.5} />
            </g>
        );
    };

    return (
        <div className="Insight_TrendChartWrap">
            {/* Header with Title and Interactive Legend */}
            <div className="Insight_TrendHeader">
                <div className="Insight_TrendTitle">
                    <TrendingUp size={13} strokeWidth={2.2} className="Insight_TrendTitleIcon" />
                    <span>{title || 'Spending & Income Trend'}</span>
                </div>
                <div className="Insight_TrendLegend">
                    <button
                        type="button"
                        className={`Insight_TrendLegendBtn income ${activeSeries.income ? 'active' : 'inactive'}`}
                        onClick={() => toggleSeries('income')}
                    >
                        <span className="Insight_LegendDot income" />
                        <span>Income</span>
                    </button>
                    <button
                        type="button"
                        className={`Insight_TrendLegendBtn expense ${activeSeries.expense ? 'active' : 'inactive'}`}
                        onClick={() => toggleSeries('expense')}
                    >
                        <span className="Insight_LegendDot expense" />
                        <span>Expense</span>
                    </button>
                    <button
                        type="button"
                        className={`Insight_TrendLegendBtn invest ${activeSeries.invest ? 'active' : 'inactive'}`}
                        onClick={() => toggleSeries('invest')}
                    >
                        <span className="Insight_LegendDot invest" />
                        <span>Invest</span>
                    </button>
                </div>
            </div>

            {/* SVG Chart Area */}
            <div className="Insight_TrendSvgContainer">
                <ResponsiveContainer width="100%" height={165}>
                    <AreaChart data={data} margin={{ top: 10, right: 6, left: -22, bottom: 0 }}>
                        <defs>
                            <linearGradient id="trendIncomeGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--Fc-1)" stopOpacity={0.32} />
                                <stop offset="85%" stopColor="var(--Fc-1)" stopOpacity={0.02} />
                                <stop offset="100%" stopColor="var(--Fc-1)" stopOpacity={0.0} />
                            </linearGradient>
                            <linearGradient id="trendExpenseGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--Gc-1)" stopOpacity={0.32} />
                                <stop offset="85%" stopColor="var(--Gc-1)" stopOpacity={0.02} />
                                <stop offset="100%" stopColor="var(--Gc-1)" stopOpacity={0.0} />
                            </linearGradient>
                            <linearGradient id="trendInvestGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#ffffff" stopOpacity={0.22} />
                                <stop offset="85%" stopColor="#ffffff" stopOpacity={0.02} />
                                <stop offset="100%" stopColor="#ffffff" stopOpacity={0.0} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="3 3" vertical={false} />

                        <XAxis
                            dataKey="day"
                            stroke="var(--Ac-3)"
                            fontSize={9.5}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                            minTickGap={12}
                            tick={{ fill: 'var(--Ac-3)', dy: 4 }}
                        />

                        <YAxis
                            stroke="var(--Ac-3)"
                            fontSize={9.5}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(val) => (val >= 1000 ? `$${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k` : `$${Math.round(val)}`)}
                            domain={[
                                (dataMin) => Math.min(0, Math.floor(dataMin / 100) * 100),
                                (dataMax) => Math.max(0, Math.ceil(dataMax / 100) * 100),
                            ]}
                            tick={{ fill: 'var(--Ac-3)', dx: -2 }}
                        />

                        <Tooltip content={<CustomTooltip />} />

                        {activeSeries.income && (
                            <Area
                                type="monotone"
                                dataKey="income"
                                name="Income"
                                stroke="var(--Fc-1)"
                                strokeWidth={2.2}
                                fill="url(#trendIncomeGrad)"
                                dot={endDot('var(--Fc-1)', activeSeries.income)}
                                activeDot={{ r: 4.5, stroke: 'var(--Ec-1)', strokeWidth: 2 }}
                            />
                        )}

                        {activeSeries.expense && (
                            <Area
                                type="monotone"
                                dataKey="expense"
                                name="Expense"
                                stroke="var(--Gc-1)"
                                strokeWidth={2.2}
                                fill="url(#trendExpenseGrad)"
                                dot={endDot('var(--Gc-1)', activeSeries.expense)}
                                activeDot={{ r: 4.5, stroke: 'var(--Ec-1)', strokeWidth: 2 }}
                            />
                        )}

                        {activeSeries.invest && (
                            <Area
                                type="monotone"
                                dataKey="invest"
                                name="Invest"
                                stroke="#ffffff"
                                strokeWidth={2.2}
                                fill="url(#trendInvestGrad)"
                                dot={endDot('#ffffff', activeSeries.invest)}
                                activeDot={{ r: 4.5, stroke: 'var(--Ec-1)', strokeWidth: 2 }}
                            />
                        )}
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default InsightTrendChart;
