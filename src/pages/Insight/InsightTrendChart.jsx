
import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const InsightTrendChart = ({ data }) => {
    // data format: [{ day: 1, income: 100, expense: 50, invest: 20 }, ...]

    // Custom Tooltip for better aesthetics matching the app
    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{
                    backgroundColor: 'var(--Ec-1)',
                    border: '1px solid var(--Bc-2)',
                    padding: '10px',
                    borderRadius: '8px',
                    color: 'var(--Ac-1)',
                    fontSize: '0.8rem',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
                }}>
                    <p style={{ margin: 0, fontWeight: 'bold', marginBottom: '5px' }}>{isNaN(label) ? label : `Day ${label}`}</p>
                    {payload.map((entry, index) => (
                        <p key={index} style={{ margin: 0, color: entry.color, fontSize: '0.75rem' }}>
                            {entry.name}: ${entry.value.toFixed(2)}
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div style={{ width: '100%', height: 150, paddingRight: '10px' }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                    <XAxis
                        dataKey="day"
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
                        domain={[0, (dataMax) => Math.ceil(dataMax / 100) * 100]}
                    />
                    <Tooltip content={<CustomTooltip />} />

                    <Line
                        type="monotone"
                        dataKey="income"
                        name="Income"
                        stroke="var(--Fc-1)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                    <Line
                        type="monotone"
                        dataKey="expense"
                        name="Expense"
                        stroke="var(--Gc-1)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                    <Line
                        type="monotone"
                        dataKey="invest"
                        name="Invest"
                        stroke="#fff"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export default InsightTrendChart;
