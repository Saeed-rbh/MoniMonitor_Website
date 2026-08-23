const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDailyExpenseSeries } = require("./timesFmForecastService");

test("buildDailyExpenseSeries fills no-spend days and excludes income", () => {
    const result = buildDailyExpenseSeries([
        { Timestamp: "2026-08-01T12:00:00.000Z", AmountMinor: 1200, Category: "Expense" },
        { Timestamp: "2026-08-03T12:00:00.000Z", AmountMinor: 800, Type: "Debit" },
        { Timestamp: "2026-08-02T12:00:00.000Z", AmountMinor: 5000, Category: "Income" },
    ]);
    assert.deepEqual(result, { start: "2026-08-01", end: "2026-08-03", values: [12, 0, 8] });
});
