const crypto = require('crypto');
const { getDb } = require('../database/db');
const { getSavingEffectMinor } = require('./transactionClassification');
const { rankMonthlyInsightCandidates } = require('./aiService');

const cache = new Map();
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

const amountMinor = (transaction) => Number.isSafeInteger(transaction.AmountMinor)
    ? transaction.AmountMinor
    : Math.round(Number(transaction.Amount || 0) * 100);
const isExpense = (transaction) => transaction.Category === 'Expense';
const isIncome = (transaction) => transaction.Category === 'Income';
const normalize = (value) => String(value || '').trim().toLowerCase();
const money = (minor) => new Intl.NumberFormat('en-CA', {
    style: 'currency', currency: 'CAD', maximumFractionDigits: 2,
}).format(Number(minor || 0) / 100);

function monthRange(month, monthsBack = 0) {
    const [year, monthNumber] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year, monthNumber - 1 - monthsBack, 1));
    const end = new Date(Date.UTC(year, monthNumber - monthsBack, 1));
    return { start, end, key: start.toISOString().slice(0, 7) };
}

function transactionDay(transaction) {
    return new Date(transaction.Timestamp).getUTCDate();
}

function buildCandidate(id, type, title, fact, actions, evidenceTransactions, priority, confidence = 'high') {
    return {
        id, type, title, fact, actions, priority, confidence,
        evidence: {
            transactionIds: evidenceTransactions.map((transaction) => transaction.id).filter(Boolean).slice(0, 100),
            count: evidenceTransactions.length,
        },
    };
}

function buildMonthlyAnalysis(transactions, month, dataQuality = {}) {
    if (!MONTH_PATTERN.test(month)) throw new Error('month must be YYYY-MM');
    const current = transactions.filter((transaction) => String(transaction.Timestamp || '').slice(0, 7) === month);
    const latestDay = current.length ? Math.max(...current.map(transactionDay)) : 1;
    const historyByMonth = [];
    for (let offset = 1; offset <= 3; offset += 1) {
        const range = monthRange(month, offset);
        historyByMonth.push({
            month: range.key,
            transactions: transactions.filter((transaction) =>
                String(transaction.Timestamp || '').slice(0, 7) === range.key && transactionDay(transaction) <= latestDay
            ),
        });
    }
    const availableHistory = historyByMonth.filter((entry) => entry.transactions.length > 0);
    const currentExpenses = current.filter(isExpense);
    const currentIncome = current.filter(isIncome);
    const incomeMinor = currentIncome.reduce((sum, transaction) => sum + amountMinor(transaction), 0);
    const expenseMinor = currentExpenses.reduce((sum, transaction) => sum + amountMinor(transaction), 0);
    const savingMinor = current.reduce((sum, transaction) => sum + getSavingEffectMinor(transaction), 0);
    const netCashFlowMinor = incomeMinor - expenseMinor;
    const candidates = [];

    candidates.push(buildCandidate(
        'cash-flow', 'cash_flow', 'Cash flow',
        `Net cash flow is ${money(netCashFlowMinor)}: ${money(incomeMinor)} income minus ${money(expenseMinor)} spending. Internal transfers and trades are excluded.`,
        netCashFlowMinor >= 0
            ? ['Keep the surplus assigned to a clear goal.', 'Protect this surplus from next month’s recurring costs.', 'Review where the surplus should stay or be invested.']
            : ['Review the largest flexible expenses before the next payday.', 'Set a lower limit for the category driving the shortfall.', 'Keep a larger cash buffer before optional spending.'],
        [...currentIncome, ...currentExpenses], 100
    ));

    if (availableHistory.length) {
        const historicalExpenseTotals = availableHistory.map((entry) =>
            entry.transactions.filter(isExpense).reduce((sum, transaction) => sum + amountMinor(transaction), 0)
        );
        const historicalAverage = Math.round(
            historicalExpenseTotals.reduce((sum, value) => sum + value, 0) / historicalExpenseTotals.length
        );
        const changePercent = historicalAverage
            ? Math.round(((expenseMinor - historicalAverage) / historicalAverage) * 100)
            : null;
        candidates.push(buildCandidate(
            'spending-pace', 'spending_change', 'Spending pace',
            changePercent === null
                ? `Spending is ${money(expenseMinor)} through day ${latestDay}; prior comparable months had no spending baseline.`
                : `Spending is ${money(expenseMinor)} through day ${latestDay}, ${Math.abs(changePercent)}% ${changePercent >= 0 ? 'above' : 'below'} the ${money(historicalAverage)} average for the same part of the previous ${availableHistory.length} month${availableHistory.length === 1 ? '' : 's'}.`,
            changePercent !== null && changePercent > 0
                ? ['Inspect the categories responsible for the increase.', 'Use the recent average as next month’s spending ceiling.', 'Separate one-time purchases from changes in routine spending.']
                : ['Keep the lower spending pace without delaying required bills.', 'Move part of the difference toward a goal.', 'Check whether lower spending came from a temporary timing change.'],
            currentExpenses, changePercent !== null && changePercent > 10 ? 95 : 65,
            availableHistory.length >= 2 ? 'high' : 'medium'
        ));
    }

    const byLabel = new Map();
    currentExpenses.forEach((transaction) => {
        const label = transaction.Label || 'Other Expense';
        const entry = byLabel.get(label) || { amountMinor: 0, transactions: [] };
        entry.amountMinor += amountMinor(transaction);
        entry.transactions.push(transaction);
        byLabel.set(label, entry);
    });
    const topCategory = [...byLabel.entries()].sort((left, right) => right[1].amountMinor - left[1].amountMinor)[0];
    if (topCategory) {
        const [label, entry] = topCategory;
        const share = expenseMinor ? Math.round((entry.amountMinor / expenseMinor) * 100) : 0;
        candidates.push(buildCandidate(
            'top-category', 'category_concentration', label,
            `${label} is the largest spending category at ${money(entry.amountMinor)}, representing ${share}% of this month’s expenses across ${entry.transactions.length} transaction${entry.transactions.length === 1 ? '' : 's'}.`,
            ['Review the supporting transactions for avoidable repetition.', 'Set a practical limit for this category next month.', 'Compare this category with its previous three-month pattern.'],
            entry.transactions, share >= 30 ? 90 : 60
        ));
    }

    if (savingMinor !== 0) {
        const savingTransactions = current.filter((transaction) => getSavingEffectMinor(transaction) !== 0);
        candidates.push(buildCandidate(
            'contributions', 'contributions', savingMinor >= 0 ? 'True contributions' : 'Net withdrawals',
            `${money(Math.abs(savingMinor))} was ${savingMinor >= 0 ? 'added as new savings or investment funding' : 'withdrawn from savings or investment accounts'}. Internal transfers and security purchases are not counted as new savings.`,
            savingMinor >= 0
                ? ['Keep the contribution rate consistent next month.', 'Confirm the contribution supports your highest-priority goal.', 'Compare contributions with net cash flow before increasing them.']
                : ['Check whether the withdrawal was planned.', 'Rebuild the withdrawn amount gradually.', 'Review whether future withdrawals need a dedicated cash buffer.'],
            savingTransactions, 85
        ));
    }

    const historyExpenses = availableHistory.flatMap((entry) => entry.transactions.filter(isExpense));
    if (historyExpenses.length >= 5 && currentExpenses.length) {
        const historicalAmounts = historyExpenses.map(amountMinor);
        const mean = historicalAmounts.reduce((sum, value) => sum + value, 0) / historicalAmounts.length;
        const variance = historicalAmounts.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / historicalAmounts.length;
        const threshold = mean + (2 * Math.sqrt(variance));
        const unusual = currentExpenses
            .filter((transaction) => amountMinor(transaction) > threshold)
            .filter((transaction) => !historyExpenses.some((historical) =>
                normalize(historical.Reason) === normalize(transaction.Reason) &&
                Math.abs(amountMinor(historical) - amountMinor(transaction)) <= Math.max(100, amountMinor(transaction) * 0.05)
            ))
            .sort((left, right) => amountMinor(right) - amountMinor(left));
        if (unusual.length) {
            const largest = unusual[0];
            candidates.push(buildCandidate(
                'unusual-spending', 'unusual_spending', 'Unusual spending',
                `${unusual.length} expense${unusual.length === 1 ? '' : 's'} exceeded the recent transaction pattern. The largest was ${largest.Reason || largest.Label || 'an expense'} at ${money(amountMinor(largest))}.`,
                ['Confirm these purchases were expected.', 'Treat one-time costs separately from the regular budget.', 'Review the evidence for a duplicate, refund, or category correction.'],
                unusual, 92, 'medium'
            ));
        }
    }

    const recurring = currentExpenses.filter((transaction) =>
        transaction.Frequency && transaction.Frequency !== 'OneTime'
    );
    if (recurring.length) {
        const recurringMinor = recurring.reduce((sum, transaction) => sum + amountMinor(transaction), 0);
        candidates.push(buildCandidate(
            'recurring-costs', 'recurring', 'Recurring costs',
            `${recurring.length} recurring expense${recurring.length === 1 ? '' : 's'} used ${money(recurringMinor)} this month.`,
            ['Confirm every recurring charge is still useful.', 'Reserve this amount before calculating safe-to-spend cash.', 'Check recurring merchants for price changes.'],
            recurring, 75
        ));
    }

    const sortedCandidates = candidates.sort((left, right) => right.priority - left.priority);
    const issues = [];
    if (Number(dataQuality.pendingEmails || 0) > 0) issues.push(`${dataQuality.pendingEmails} email${dataQuality.pendingEmails === 1 ? '' : 's'} awaiting processing`);
    const uncategorized = current.filter((transaction) => ['Other Expense', 'Other Income'].includes(transaction.Label)).length;
    if (uncategorized) issues.push(`${uncategorized} broadly categorized transaction${uncategorized === 1 ? '' : 's'}`);

    return {
        month,
        latestDay,
        summary: { incomeMinor, expenseMinor, savingMinor, netCashFlowMinor, transactionCount: current.length },
        dataQuality: {
            status: issues.length ? 'review' : 'healthy',
            issues,
            pendingEmails: Number(dataQuality.pendingEmails || 0),
        },
        candidates: sortedCandidates,
    };
}

function hashAnalysis(analysis) {
    return crypto.createHash('sha256').update(JSON.stringify({
        month: analysis.month,
        summary: analysis.summary,
        dataQuality: analysis.dataQuality,
        candidates: analysis.candidates.map(({ id, fact, evidence }) => ({ id, fact, evidence })),
    })).digest('hex').slice(0, 16);
}

async function getMonthlyInsightBrief(userId, month, options = {}) {
    if (!MONTH_PATTERN.test(month)) throw new Error('month must be YYYY-MM');
    const db = await getDb();
    const earliest = monthRange(month, 3).start.toISOString();
    const latest = monthRange(month, -1).start.toISOString();
    const transactions = await db.all(
        `SELECT * FROM transactions WHERE userId = ? AND Timestamp >= ? AND Timestamp < ? ORDER BY Timestamp ASC`,
        [userId, earliest, latest]
    );
    const pending = await db.get(`SELECT COUNT(*) AS count FROM email_ingestion_queue WHERE status = 'pending'`);
    const analysis = buildMonthlyAnalysis(transactions, month, { pendingEmails: pending?.count || 0 });
    const dataHash = hashAnalysis(analysis);
    const cacheKey = `${userId}:${month}:${dataHash}`;
    if (!options.refresh && cache.has(cacheKey)) return cache.get(cacheKey);

    let ranking = null;
    // Pending email means the month's ledger is still incomplete, so wait before
    // asking AI to prioritize it. Broad categories remain visible as a quality
    // warning, but they do not invalidate the verified amounts below.
    if (analysis.dataQuality.pendingEmails === 0 && analysis.candidates.length) {
        try {
            ranking = await rankMonthlyInsightCandidates(analysis.candidates);
        } catch (error) {
            console.warn('[Monthly insights] AI ranking unavailable; using deterministic ranking:', error.message);
        }
    }
    const byId = new Map(analysis.candidates.map((candidate) => [candidate.id, candidate]));
    const selected = [];
    for (const choice of ranking?.selections || []) {
        const candidate = byId.get(choice.id);
        if (!candidate || selected.some((item) => item.id === candidate.id)) continue;
        selected.push({ ...candidate, action: candidate.actions[choice.actionIndex] || candidate.actions[0] });
        if (selected.length === 3) break;
    }
    for (const candidate of analysis.candidates) {
        if (selected.length === 3) break;
        if (!selected.some((item) => item.id === candidate.id)) {
            selected.push({ ...candidate, action: candidate.actions[0] });
        }
    }
    const result = {
        month,
        generatedAt: new Date().toISOString(),
        dataHash,
        source: ranking ? 'ai-ranked' : 'deterministic',
        summary: analysis.summary,
        dataQuality: analysis.dataQuality,
        insights: selected.map(({ actions, priority, ...insight }) => insight),
    };
    cache.set(cacheKey, result);
    return result;
}

module.exports = { buildMonthlyAnalysis, getMonthlyInsightBrief };
