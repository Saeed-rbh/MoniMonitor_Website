const path = require("path");
const { spawn } = require("child_process");
const dbService = require("../database/dbService");

const FORECAST_DAYS = 30;
const MIN_HISTORY_DAYS = 21;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const forecastCache = new Map();

const isExpense = (transaction) => (
    transaction.Category === "Expense" ||
    (!transaction.Category && (
        transaction.Type === "Expense" ||
        transaction.Type === "Debit" ||
        String(transaction.AccountFlow || "").toUpperCase() === "OUT"
    ))
);

const dayKey = (timestamp) => String(timestamp || "").slice(0, 10);
const addDays = (date, days) => {
    const next = new Date(`${date}T12:00:00`);
    next.setDate(next.getDate() + days);
    return next.toISOString().slice(0, 10);
};

function forecastError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function buildDailyExpenseSeries(transactions) {
    const expenseByDay = new Map();
    transactions.filter(isExpense).forEach((transaction) => {
        const day = dayKey(transaction.Timestamp);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
        const amountMinor = Number.isFinite(Number(transaction.AmountMinor))
            ? Number(transaction.AmountMinor)
            : Math.round(Number(transaction.Amount || 0) * 100);
        if (amountMinor > 0) expenseByDay.set(day, (expenseByDay.get(day) || 0) + amountMinor / 100);
    });

    const dates = [...expenseByDay.keys()].sort();
    if (!dates.length) return null;
    const start = dates[0];
    const end = dates.at(-1);
    const values = [];
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
        values.push(Number((expenseByDay.get(cursor) || 0).toFixed(2)));
    }
    return { start, end, values };
}

async function runTimesFm(values) {
    const python = process.env.TIMESFM_PYTHON || "python";
    const script = path.resolve(__dirname, "../../scripts/timesfm_forecast.py");
    try {
        const stdout = await new Promise((resolve, reject) => {
            const child = spawn(python, [script], { windowsHide: true });
            let output = "";
            let errorOutput = "";
            const timer = setTimeout(() => {
                child.kill();
                reject(forecastError("TIMESFM_TIMEOUT", "TimesFM took too long to generate this forecast."));
            }, Number(process.env.TIMESFM_TIMEOUT_MS || 180000));
            child.stdout.on("data", (chunk) => { output += chunk; });
            child.stderr.on("data", (chunk) => { errorOutput += chunk; });
            child.on("error", () => {
                clearTimeout(timer);
                reject(forecastError("TIMESFM_UNAVAILABLE", "TimesFM could not be started by the configured Python runtime."));
            });
            child.on("close", (code) => {
                clearTimeout(timer);
                if (code === 0) return resolve(output);
                const error = forecastError("TIMESFM_FAILED", errorOutput.slice(0, 300) || "TimesFM did not return a forecast.");
                error.stdout = output;
                reject(error);
            });
            child.stdin.end(JSON.stringify({ values, horizon: FORECAST_DAYS }));
        });
        const payload = JSON.parse(stdout);
        if (!payload.ok) throw forecastError(payload.code || "TIMESFM_FAILED", payload.message || "TimesFM did not return a forecast.");
        return payload;
    } catch (error) {
        if (error.code && ["TIMESFM_NOT_INSTALLED", "INSUFFICIENT_HISTORY", "INVALID_HORIZON", "TIMESFM_TIMEOUT", "TIMESFM_UNAVAILABLE"].includes(error.code)) {
            throw error;
        }
        const processPayload = (() => {
            try { return JSON.parse(String(error.stdout || "")); } catch { return null; }
        })();
        if (processPayload?.code) throw forecastError(processPayload.code, processPayload.message);
        throw forecastError("TIMESFM_UNAVAILABLE", "TimesFM could not be started by the configured Python runtime.");
    }
}

async function getExpenseForecast(userId) {
    const db = await dbService.getDb();
    const transactions = await db.all(
        `SELECT Amount, AmountMinor, Category, Type, AccountFlow, Timestamp
         FROM transactions WHERE userId = ? ORDER BY Timestamp ASC`,
        [userId]
    );
    const series = buildDailyExpenseSeries(transactions);
    if (!series || series.values.length < MIN_HISTORY_DAYS) {
        throw forecastError("INSUFFICIENT_HISTORY", "Add at least 21 days of expense history to generate a forecast.");
    }

    const values = series.values.slice(-365);
    const cacheKey = `${userId}:${series.end}:${values.join(",")}`;
    const cached = forecastCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return cached.payload;

    const result = await runTimesFm(values);
    const days = result.forecast.map((amount, index) => ({
        date: addDays(series.end, index + 1),
        amount,
        lower: result.lower[index],
        upper: result.upper[index],
    }));
    const total = (field) => Number(days.reduce((sum, day) => sum + Number(day[field] || 0), 0).toFixed(2));
    const payload = {
        model: result.model,
        horizonDays: FORECAST_DAYS,
        historyDays: values.length,
        forecastStart: days[0].date,
        forecastEnd: days.at(-1).date,
        expectedTotal: total("amount"),
        lowerTotal: total("lower"),
        upperTotal: total("upper"),
        days,
    };
    forecastCache.set(cacheKey, { createdAt: Date.now(), payload });
    if (forecastCache.size > 100) forecastCache.delete(forecastCache.keys().next().value);
    return payload;
}

module.exports = { buildDailyExpenseSeries, getExpenseForecast };
