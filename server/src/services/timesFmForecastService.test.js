const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildDailyExpenseSeries,
    summarizeForecastAccuracy,
} = require("./timesFmForecastService");

test("buildDailyExpenseSeries fills no-spend days and excludes income", () => {
    const result = buildDailyExpenseSeries([
        { Timestamp: "2026-08-01T12:00:00.000Z", AmountMinor: 1200, Category: "Expense" },
        { Timestamp: "2026-08-03T12:00:00.000Z", AmountMinor: 800, Type: "Debit" },
        { Timestamp: "2026-08-02T12:00:00.000Z", AmountMinor: 5000, Category: "Income" },
    ]);
    assert.deepEqual(result, { start: "2026-08-01", end: "2026-08-03", values: [12, 0, 8] });
});

test("buildDailyExpenseSeries excludes wrongly classified transfers and refunds", () => {
    const result = buildDailyExpenseSeries([
        { Timestamp: "2026-08-01T12:00:00.000Z", AmountMinor: 1200, Category: "Expense" },
        { Timestamp: "2026-08-02T12:00:00.000Z", AmountMinor: 4000, Category: "Expense", Label: "Internal Transfer" },
        { Timestamp: "2026-08-03T12:00:00.000Z", AmountMinor: 900, Category: "Expense", Reason: "Refund received" },
    ]);
    assert.deepEqual(result, { start: "2026-08-01", end: "2026-08-01", values: [12] });
});

test("summarizeForecastAccuracy reports WAPE after enough completed days", () => {
    const points = Array.from({ length: 7 }, (_, index) => ({
        forecastDate: `2026-08-0${index + 1}`,
        forecastAmount: 10,
    }));
    const actuals = new Map(points.map((point, index) => [point.forecastDate, index === 0 ? 20 : 10]));
    assert.deepEqual(summarizeForecastAccuracy(points, actuals), {
        status: "measured",
        evaluatedDays: 7,
        meanAbsoluteError: 1.43,
        wape: 12.5,
    });
});
