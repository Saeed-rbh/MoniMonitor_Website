import React, { useMemo } from "react";
import {
    PieChart,
    Pie,
    Cell,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";
import { useTransactionData } from "../../hooks/useSharedHooks";

const Insight = () => {
    // Use shared hook or mock data directly for now
    const { transactions } = useTransactionData(0, 90260003) || { transactions: [] };

    // Sample data processing (aggregating by category)
    const categoryData = useMemo(() => {
        if (!transactions) return [];

        const aggregated = transactions.reduce((acc, curr) => {
            if (curr.Category === "Income" || curr.Category === "Save&Invest") return acc;

            const category = curr.Label || curr.Category;
            if (!acc[category]) acc[category] = 0;
            acc[category] += Number(curr.Amount);
            return acc;
        }, {});

        return Object.keys(aggregated).map((key) => ({
            name: key,
            value: Number(aggregated[key].toFixed(2)),
        }));
    }, [transactions]);

    const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8", "#82ca9d"];

    return (
        <div
            style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                padding: "20px",
                paddingBottom: "80px", // Space for menu
                color: "var(--Ac-1)",
                overflowY: "auto",
                boxSizing: "border-box",
            }}
        >
            <h2 style={{ marginBottom: "20px", textAlign: "center" }}>
                Spending Analysis
            </h2>

            {/* Pie Chart Section */}
            <div style={{ width: "100%", height: 300, marginBottom: "30px" }}>
                <h3 style={{ textAlign: "center", fontSize: "1rem", marginBottom: "10px" }}>
                    Expense Distribution
                </h3>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={categoryData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            fill="#8884d8"
                            paddingAngle={5}
                            dataKey="value"
                        >
                            {categoryData.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={COLORS[index % COLORS.length]}
                                />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{
                                backgroundColor: "var(--Bc-4)",
                                border: "none",
                                borderRadius: "10px",
                            }}
                        />
                        <Legend layout="horizontal" verticalAlign="bottom" align="center" />
                    </PieChart>
                </ResponsiveContainer>
            </div>

            {/* Bar Chart Section */}
            <div style={{ width: "100%", height: 300 }}>
                <h3 style={{ textAlign: "center", fontSize: "1rem", marginBottom: "10px" }}>
                    Category Breakdown
                </h3>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={categoryData}
                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                        <XAxis dataKey="name" stroke="var(--Ac-2)" fontSize={12} />
                        <YAxis stroke="var(--Ac-2)" fontSize={12} />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: "var(--Bc-4)",
                                border: "none",
                                borderRadius: "10px",
                            }}
                            cursor={{ fill: "transparent" }}
                        />
                        <Bar dataKey="value" fill="#82ca9d" radius={[5, 5, 0, 0]}>
                            {categoryData.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={COLORS[index % COLORS.length]}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default Insight;
