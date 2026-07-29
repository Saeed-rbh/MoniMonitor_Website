import React, { useEffect, useMemo, useState } from "react";
import { createGoalAPI, deleteGoalAPI, getBudgetsAPI, getGoalsAPI, getSettingsAPI, saveBudgetAPI, sendDataToDB, updateGoalAPI } from "../../services/apiService";

const toMinor = (value) => Math.round(Number(value) * 100);
const csvRows = (text) => text.trim().split(/\r?\n/).map((line) => line.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)?.map((cell) => cell.replace(/^,/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()) || []);

const Finance = () => {
    const month = useMemo(() => new Date().toISOString().slice(0, 7), []);
    const [budgets, setBudgets] = useState([]);
    const [goals, setGoals] = useState([]);
    const [currency, setCurrency] = useState("USD");
    const [category, setCategory] = useState("Groceries");
    const [budgetAmount, setBudgetAmount] = useState("");
    const [goalName, setGoalName] = useState("");
    const [goalAmount, setGoalAmount] = useState("");
    const [goalDate, setGoalDate] = useState("");
    const [importRows, setImportRows] = useState([]);
    const [status, setStatus] = useState("");

    const money = (minor) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(minor || 0) / 100);
    const load = async () => {
        const [nextBudgets, nextGoals, settings] = await Promise.all([getBudgetsAPI(month), getGoalsAPI(), getSettingsAPI()]);
        setBudgets(nextBudgets);
        setGoals(nextGoals);
        if (settings?.currency) setCurrency(settings.currency);
    };
    useEffect(() => { load(); }, []);

    const saveBudget = async (event) => {
        event.preventDefault();
        const amountMinor = toMinor(budgetAmount);
        if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return setStatus("Enter a valid budget amount.");
        const result = await saveBudgetAPI({ category, month, amountMinor, currency });
        if (!result) return setStatus("Could not save your budget.");
        setBudgetAmount(""); setStatus("Budget saved."); load();
    };
    const saveGoal = async (event) => {
        event.preventDefault();
        const targetMinor = toMinor(goalAmount);
        if (!goalName.trim() || !Number.isSafeInteger(targetMinor) || targetMinor <= 0) return setStatus("Enter a goal name and a positive target.");
        const result = await createGoalAPI({ name: goalName.trim(), targetMinor, currency, targetDate: goalDate || null });
        if (!result) return setStatus("Could not create your goal.");
        setGoalName(""); setGoalAmount(""); setGoalDate(""); setStatus("Goal created."); load();
    };
    const updateProgress = async (goal, value) => {
        const currentMinor = toMinor(value);
        if (!Number.isSafeInteger(currentMinor) || currentMinor < 0) return setStatus("Enter a valid saved amount.");
        if (!await updateGoalAPI(goal.id, { currentMinor })) return setStatus("Could not update your goal.");
        setStatus("Goal progress updated."); load();
    };
    const readImport = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const rows = csvRows(await file.text());
        const header = (rows.shift() || []).map((item) => item.toLowerCase());
        const index = (name) => header.indexOf(name);
        const parsed = rows.slice(0, 250).map((row) => ({
            Amount: Number(row[index("amount")]), Category: row[index("category")], Label: row[index("label")] || null,
            Reason: row[index("reason")] || null, Timestamp: row[index("timestamp")] || new Date().toISOString(),
        })).filter((item) => Number.isFinite(item.Amount) && item.Amount > 0 && ["Income", "Expense", "Saving", "Save&Invest"].includes(item.Category));
        setImportRows(parsed);
        setStatus(parsed.length ? `${parsed.length} valid rows ready for review (maximum 250).` : "No valid rows found. CSV needs Amount and Category columns.");
    };
    const importTransactions = async () => {
        if (!importRows.length) return;
        let imported = 0;
        for (const record_entry of importRows) {
            const result = await sendDataToDB({ record_entry, record_type: record_entry.Type });
            if (result?.data || result?.message === "Created") imported += 1;
        }
        setImportRows([]); setStatus(`${imported} of ${importRows.length} reviewed rows imported.`);
    };
    const card = { background: "var(--Ac-4)", border: "1px solid var(--Bc-3)", borderRadius: "16px", padding: "16px", width: "100%", boxSizing: "border-box" };
    const field = { width: "100%", boxSizing: "border-box", padding: "10px", borderRadius: "10px", border: "1px solid var(--Bc-3)", background: "var(--Ec-4)", color: "var(--Ac-1)" };

    return <main style={{ width: "100%", maxWidth: "620px", margin: "0 auto", padding: "16px", overflowY: "auto", color: "var(--Ac-1)", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: "1.35rem", margin: "4px 0 6px" }}>Budgets & Goals</h1><p style={{ color: "var(--Ac-2)", marginTop: 0 }}>Plan, track, and safely import your financial history.</p>
        {status && <p role="status" style={{ color: "var(--Fc-1)" }}>{status}</p>}
        <section style={{ ...card, marginBottom: "14px" }}><h2 style={{ fontSize: "1rem", marginTop: 0 }}>Monthly budget · {month}</h2><form onSubmit={saveBudget} style={{ display: "grid", gap: "8px" }}><input aria-label="Budget category" value={category} onChange={(e) => setCategory(e.target.value)} style={field} maxLength="100" required /><input aria-label="Budget amount" type="number" min="0" step="0.01" placeholder="Amount" value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} style={field} required /><button type="submit" className="auth-button">Save budget</button></form><div style={{ marginTop: "14px", display: "grid", gap: "6px" }}>{budgets.length ? budgets.map((budget) => <div key={budget.id} style={{ display: "flex", justifyContent: "space-between" }}><span>{budget.category}</span><strong>{money(budget.amountMinor)}</strong></div>) : <span style={{ color: "var(--Ac-2)" }}>No budgets set yet.</span>}</div></section>
        <section style={{ ...card, marginBottom: "14px" }}><h2 style={{ fontSize: "1rem", marginTop: 0 }}>Savings goals</h2><form onSubmit={saveGoal} style={{ display: "grid", gap: "8px" }}><input aria-label="Goal name" value={goalName} onChange={(e) => setGoalName(e.target.value)} placeholder="Emergency fund" style={field} maxLength="120" required /><input aria-label="Goal target" type="number" min="0.01" step="0.01" placeholder="Target amount" value={goalAmount} onChange={(e) => setGoalAmount(e.target.value)} style={field} required /><input aria-label="Goal target date" type="date" value={goalDate} onChange={(e) => setGoalDate(e.target.value)} style={field} /><button type="submit" className="auth-button">Create goal</button></form><div style={{ marginTop: "14px", display: "grid", gap: "12px" }}>{goals.length ? goals.map((goal) => <div key={goal.id}><div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}><span>{goal.name}{goal.targetDate ? ` · ${goal.targetDate}` : ""}</span><strong>{money(goal.currentMinor)} / {money(goal.targetMinor)}</strong></div><div aria-label={`${goal.name} progress`} style={{ height: "7px", marginTop: "6px", borderRadius: "99px", background: "var(--Ec-4)" }}><div style={{ width: `${Math.min(100, (goal.currentMinor / goal.targetMinor) * 100)}%`, height: "100%", borderRadius: "inherit", background: "var(--Fc-1)" }} /></div><div style={{ display: "flex", gap: "8px", marginTop: "8px" }}><input aria-label={`${goal.name} saved amount`} defaultValue={(goal.currentMinor / 100).toFixed(2)} type="number" min="0" step="0.01" style={field} onBlur={(e) => updateProgress(goal, e.target.value)} /><button type="button" onClick={async () => { if (window.confirm(`Delete ${goal.name}?`) && await deleteGoalAPI(goal.id)) { setStatus("Goal deleted."); load(); } }} style={{ whiteSpace: "nowrap" }}>Delete</button></div></div>) : <span style={{ color: "var(--Ac-2)" }}>No goals created yet.</span>}</div></section>
        <section style={card}><h2 style={{ fontSize: "1rem", marginTop: 0 }}>Import CSV</h2><p style={{ color: "var(--Ac-2)", fontSize: ".9rem" }}>Review valid rows before importing. Required columns: Amount, Category. Optional: Label, Reason, Timestamp.</p><input aria-label="Choose a CSV file" type="file" accept=".csv,text/csv" onChange={readImport} style={field} />{importRows.length > 0 && <><p>{importRows.length} rows ready. First: {importRows[0].Category} · {money(toMinor(importRows[0].Amount))}</p><button type="button" className="auth-button" onClick={importTransactions}>Import reviewed rows</button></>}</section>
    </main>;
};
export default Finance;