const { BigQuery } = require("@google-cloud/bigquery");
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

const toDateParam = (date) => {
    const value = date?.value || date;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
};

function getBigQueryClient() {
    const projectId = process.env.GCP_PROJECT_ID;
    if (!projectId) {
        throw forecastError("BIGQUERY_NOT_CONFIGURED", "Set GCP_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS to enable hosted TimesFM forecasts.");
    }
    return new BigQuery({
        projectId,
        ...(process.env.GOOGLE_APPLICATION_CREDENTIALS
            ? { keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS }
            : {}),
    });
}

async function runTimesFm(dates, values) {
    const client = getBigQueryClient();
    try {
        const [rows] = await client.query({
            query: `
                WITH history AS (
                    SELECT
                        PARSE_DATE('%F', date_value) AS expense_date,
                        CAST(@historyAmounts[OFFSET(position)] AS FLOAT64) AS expense_amount
                    FROM UNNEST(@historyDates) AS date_value WITH OFFSET AS position
                )
                SELECT *
                FROM AI.FORECAST(
                    (SELECT expense_date, expense_amount FROM history),
                    data_col => 'expense_amount',
                    timestamp_col => 'expense_date',
                    horizon => ${FORECAST_DAYS},
                    model => 'TimesFM 2.5',
                    confidence_level => 0.8
                )
            `,
            params: {
                historyDates: dates.map(toDateParam),
                historyAmounts: values,
            },
            location: process.env.BIGQUERY_LOCATION || "US",
            // A personal daily series is far below this. The cap prevents an
            // accidental query change from turning a refresh into a large bill.
            maximumBytesBilled: String(process.env.TIMESFM_MAX_BYTES_BILLED || 10 * 1024 * 1024),
        });
        if (!rows.length || rows.some((row) => row.ai_forecast_status)) {
            throw forecastError("TIMESFM_API_FAILED", rows.find((row) => row.ai_forecast_status)?.ai_forecast_status || "BigQuery TimesFM did not return a forecast.");
        }
        return rows.map((row) => {
            const lower = Math.max(Number(row.prediction_interval_lower_bound || 0), 0);
            return {
                date: toDateParam(row.forecast_timestamp),
                amount: Math.max(Number(row.forecast_value || 0), 0),
                lower,
                upper: Math.max(Number(row.prediction_interval_upper_bound || 0), lower),
            };
        });
    } catch (error) {
        if (error.code && ["BIGQUERY_NOT_CONFIGURED", "TIMESFM_API_FAILED"].includes(error.code)) {
            throw error;
        }
        console.error("BigQuery TimesFM request failed:", error.message);
        throw forecastError("TIMESFM_API_FAILED", "BigQuery could not generate a TimesFM forecast. Check the project, credentials, and BigQuery API access.");
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
    const dates = Array.from({ length: values.length }, (_, index) => addDays(series.end, index - values.length + 1));
    const cacheKey = `${userId}:${series.end}:${values.join(",")}`;
    const cached = forecastCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return cached.payload;

    const days = await runTimesFm(dates, values);
    const total = (field) => Number(days.reduce((sum, day) => sum + Number(day[field] || 0), 0).toFixed(2));
    const payload = {
        model: "TimesFM 2.5 via BigQuery",
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
