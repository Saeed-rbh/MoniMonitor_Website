import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';

const InsightMonthlyTrendChart = ({ data }) => {
    const chartData = React.useMemo(() => {
        if (!data || !Array.isArray(data)) return [];
        return data;
    }, [data]);

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{
                    backgroundColor: 'var(--Ec-1)',
                    border: '1px solid var(--Bc-2)',
                    padding: '10px',
                    borderRadius: '12px',
                    color: 'var(--Ac-1)',
                    fontSize: '0.8rem',
                    boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
                    backdropFilter: 'blur(8px)',
                }}>
                    <p style={{ margin: 0, fontWeight: 'bold', marginBottom: '8px', color: 'var(--Ac-1)' }}>
                        {label}
                    </p>
                    {payload.map((entry, index) => (
                        <p key={index} style={{ margin: '4px 0', color: entry.color, fontSize: '0.75rem', display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
                            <span>{entry.name}:</span>
                            <span style={{ fontWeight: '600' }}>${entry.value.toFixed(2)}</span>
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="Insight_BarChart" style={{
            width: '100%',
            height: 220,
            padding: '15px',
            boxSizing: 'border-box',
            background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: '20px',
            border: '1px solid var(--Bc-3)',
            marginTop: '5px',
            marginBottom: '15px'
        }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 5, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.05} vertical={false} />
                    <XAxis
                        dataKey="period"
                        stroke="var(--Ac-3)"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        interval="preserveStartEnd"
                        minTickGap={10}
                    />
                    <YAxis
                        stroke="var(--Ac-3)"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `$${Math.round(val)}`}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.03)' }} />
                    <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={8}
                        wrapperStyle={{ fontSize: '0.7rem', color: 'var(--Ac-3)' }}
                    />
                    <Bar
                        dataKey="income"
                        name="Income"
                        fill="var(--Fc-1)"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={20}
                    />
                    <Bar
                        dataKey="expenses"
                        name="Expense"
                        fill="var(--Gc-1)"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={20}
                    />
                    <Bar
                        dataKey="invest"
                        name="Invest"
                        fill="var(--Bc-1)"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={20}
                    />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};

export default InsightMonthlyTrendChart;
