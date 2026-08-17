const crypto = require('crypto');
const { getDb } = require('../database/db');
const { getSavingEffectMinor } = require('./transactionClassification');
const { rankMonthlyInsightCandidates, synthesizeMonthlyInsightsWithGemini } = require('./aiService');

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
    if (!options.refresh) {
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        const dbRecord = await db.get(
            `SELECT briefJson FROM monthly_ai_briefs WHERE userId = ? AND month = ? AND dataHash = ?`,
            [userId, month, dataHash]
        );
        if (dbRecord?.briefJson) {
            try {
                const parsed = JSON.parse(dbRecord.briefJson);
                cache.set(cacheKey, parsed);
                return parsed;
            } catch (_err) {
                // Fall through to generation if corrupted
            }
        }
    }

    let selectedInsights = null;
    let source = 'deterministic';

    if (analysis.dataQuality.pendingEmails === 0 && analysis.candidates.length) {
        const currentMonthTxs = transactions.filter((t) => String(t.Timestamp || '').slice(0, 7) === month);
        const expenses = currentMonthTxs.filter(isExpense);
        const income = currentMonthTxs.filter(isIncome);
        const sortedExpenses = [...expenses].sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));

        // Micro purchases <= $20
        const microTxs = sortedExpenses.filter((t) => amountMinor(t) <= 2000);
        const microSumMinor = microTxs.reduce((sum, t) => sum + amountMinor(t), 0);

        // Day of week breakdown (0 = Sun, 6 = Sat)
        const dayOfWeekMap = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
        const dayTotals = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
        const dayCounts = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
        let weekendSum = 0;
        let weekdaySum = 0;
        const weekendIds = [];
        const weekdayIds = [];

        sortedExpenses.forEach((t) => {
            const dow = new Date(t.Timestamp).getUTCDay();
            const dayName = dayOfWeekMap[dow];
            const amt = amountMinor(t);
            dayTotals[dayName] += amt;
            dayCounts[dayName] += 1;
            if (dow === 0 || dow === 6) {
                weekendSum += amt;
                weekendIds.push(t.id);
            } else {
                weekdaySum += amt;
                weekdayIds.push(t.id);
            }
        });

        // Payday velocity: calculate expenses that occur within 5 days after each income deposit
        const postPaydayTxs = [];
        let postPaydaySumMinor = 0;
        income.forEach((inc) => {
            const incTime = new Date(inc.Timestamp).getTime();
            const fiveDaysLater = incTime + (5 * 24 * 60 * 60 * 1000);
            sortedExpenses.forEach((exp) => {
                const expTime = new Date(exp.Timestamp).getTime();
                if (expTime >= incTime && expTime <= fiveDaysLater && !postPaydayTxs.some(t => t.id === exp.id)) {
                    postPaydayTxs.push(exp);
                    postPaydaySumMinor += amountMinor(exp);
                }
            });
        });

        // Month-over-Month (MoM) Trend Calculations
        const prevMonth1Key = monthRange(month, 1).key;
        const prevMonth2Key = monthRange(month, 2).key;

        const prev1Txs = transactions.filter((t) => String(t.Timestamp || '').slice(0, 7) === prevMonth1Key);
        const prev2Txs = transactions.filter((t) => String(t.Timestamp || '').slice(0, 7) === prevMonth2Key);

        function getMerchantTotalsMap(txList) {
            const map = {};
            txList.filter(isExpense).forEach((t) => {
                const name = t.Reason || t.Label || 'Merchant';
                const entry = map[name] || { totalMinor: 0, count: 0, ids: [] };
                entry.totalMinor += amountMinor(t);
                entry.count += 1;
                entry.ids.push(t.id);
                map[name] = entry;
            });
            return map;
        }

        function getCategoryTotalsMap(txList) {
            const map = {};
            txList.filter(isExpense).forEach((t) => {
                const label = t.Label || t.Category || 'Other';
                const entry = map[label] || { totalMinor: 0, count: 0, ids: [] };
                entry.totalMinor += amountMinor(t);
                entry.count += 1;
                entry.ids.push(t.id);
                map[label] = entry;
            });
            return map;
        }

        const curMerchantsMap = getMerchantTotalsMap(currentMonthTxs);
        const p1MerchantsMap = getMerchantTotalsMap(prev1Txs);
        const p2MerchantsMap = getMerchantTotalsMap(prev2Txs);

        const curCategoriesMap = getCategoryTotalsMap(currentMonthTxs);
        const p1CategoriesMap = getCategoryTotalsMap(prev1Txs);

        // Merchant MoM trends
        const merchantTrends = Object.entries(curMerchantsMap).map(([name, cur]) => {
            const p1 = p1MerchantsMap[name] || { totalMinor: 0, count: 0, ids: [] };
            const p2 = p2MerchantsMap[name] || { totalMinor: 0, count: 0, ids: [] };
            const diffMinor = cur.totalMinor - p1.totalMinor;
            const percentChange = p1.totalMinor
                ? Math.round(((cur.totalMinor - p1.totalMinor) / p1.totalMinor) * 100)
                : null;
            const isConsecutiveIncrease = cur.totalMinor > p1.totalMinor && p1.totalMinor > p2.totalMinor && p2.totalMinor > 0;
            return {
                merchant: name,
                currentMonthSpentMinor: cur.totalMinor,
                previousMonthSpentMinor: p1.totalMinor,
                diffMinor,
                currentMonthSpent: money(cur.totalMinor),
                currentMonthCount: cur.count,
                previousMonthSpent: money(p1.totalMinor),
                previousMonthCount: p1.count,
                twoMonthsAgoSpent: money(p2.totalMinor),
                dollarChangeVsLastMonth: money(diffMinor),
                percentChangeVsLastMonth: percentChange !== null ? `${percentChange > 0 ? '+' : ''}${percentChange}%` : 'New merchant this month',
                isConsecutiveIncrease,
                transactionIds: cur.ids,
            };
        });

        // Category MoM trends
        const categoryTrends = Object.entries(curCategoriesMap).map(([label, cur]) => {
            const p1 = p1CategoriesMap[label] || { totalMinor: 0, count: 0, ids: [] };
            const diffMinor = cur.totalMinor - p1.totalMinor;
            const percentChange = p1.totalMinor
                ? Math.round(((cur.totalMinor - p1.totalMinor) / p1.totalMinor) * 100)
                : null;
            return {
                categoryLabel: label,
                currentMonthSpentMinor: cur.totalMinor,
                previousMonthSpentMinor: p1.totalMinor,
                diffMinor,
                currentMonthSpent: money(cur.totalMinor),
                previousMonthSpent: money(p1.totalMinor),
                dollarChangeVsLastMonth: money(diffMinor),
                percentChangeVsLastMonth: percentChange !== null ? `${percentChange > 0 ? '+' : ''}${percentChange}%` : 'New category this month',
                transactionIds: cur.ids,
            };
        });

        // Candidate 1: Real MoM Increasing Merchant or Category
        const increasingMerchants = merchantTrends
            .filter((m) => m.diffMinor > 0 && m.previousMonthSpentMinor > 0)
            .sort((a, b) => b.diffMinor - a.diffMinor);
        
        const candidate1 = increasingMerchants[0]
            ? {
                type: 'MoM_Increase',
                merchantOrCategory: increasingMerchants[0].merchant,
                currentMonthSpent: increasingMerchants[0].currentMonthSpent,
                previousMonthSpent: increasingMerchants[0].previousMonthSpent,
                dollarChange: increasingMerchants[0].dollarChangeVsLastMonth,
                percentChange: increasingMerchants[0].percentChangeVsLastMonth,
                isConsecutiveIncrease: increasingMerchants[0].isConsecutiveIncrease,
                transactionIds: increasingMerchants[0].transactionIds,
            }
            : {
                type: 'MoM_Increase',
                merchantOrCategory: categoryTrends[0]?.categoryLabel || 'Expenses',
                currentMonthSpent: categoryTrends[0]?.currentMonthSpent || money(analysis.summary.expenseMinor),
                previousMonthSpent: categoryTrends[0]?.previousMonthSpent || '$0.00',
                dollarChange: categoryTrends[0]?.dollarChangeVsLastMonth || '$0.00',
                percentChange: categoryTrends[0]?.percentChangeVsLastMonth || '0%',
                transactionIds: categoryTrends[0]?.transactionIds || [],
            };

        // Candidate 2: Real MoM Decreasing Merchant or Category Shift
        const decreasingMerchants = merchantTrends
            .filter((m) => m.diffMinor < 0 && m.previousMonthSpentMinor > 0)
            .sort((a, b) => a.diffMinor - b.diffMinor);

        const decreasingCategories = categoryTrends
            .filter((c) => c.diffMinor < 0 && c.previousMonthSpentMinor > 0)
            .sort((a, b) => a.diffMinor - b.diffMinor);

        const candidate2 = decreasingMerchants[0]
            ? {
                type: 'MoM_Decrease',
                merchantOrCategory: decreasingMerchants[0].merchant,
                currentMonthSpent: decreasingMerchants[0].currentMonthSpent,
                previousMonthSpent: decreasingMerchants[0].previousMonthSpent,
                dollarChange: decreasingMerchants[0].dollarChangeVsLastMonth,
                percentChange: decreasingMerchants[0].percentChangeVsLastMonth,
                transactionIds: decreasingMerchants[0].transactionIds,
            }
            : decreasingCategories[0]
            ? {
                type: 'MoM_Decrease',
                merchantOrCategory: decreasingCategories[0].categoryLabel,
                currentMonthSpent: decreasingCategories[0].currentMonthSpent,
                previousMonthSpent: decreasingCategories[0].previousMonthSpent,
                dollarChange: decreasingCategories[0].dollarChangeVsLastMonth,
                percentChange: decreasingCategories[0].percentChangeVsLastMonth,
                transactionIds: decreasingCategories[0].transactionIds,
            }
            : {
                type: 'MoM_Baseline',
                merchantOrCategory: 'Overall Expenses',
                currentMonthSpent: money(analysis.summary.expenseMinor),
                previousMonthSpent: '$0.00',
                dollarChange: '$0.00',
                percentChange: '0%',
                transactionIds: expenses.slice(0, 5).map((t) => t.id),
            };

        // Candidate 3: Pre-Calculated Fun Fact
        const daysInMonthSoFar = analysis.latestDay || 1;
        const totalHoursSoFar = daysInMonthSoFar * 24;
        const totalExpenseCount = expenses.length || 1;
        const hoursPerPurchase = Math.round((totalHoursSoFar / totalExpenseCount) * 10) / 10;

        let candidate3;
        if (microTxs.length >= 4) {
            candidate3 = {
                type: 'FunFact_MicroPurchases',
                funFactTopic: 'Micro-purchases under $20',
                details: `${microTxs.length} small purchases under $20 added up to ${money(microSumMinor)} this month (${Math.round((microSumMinor / (analysis.summary.expenseMinor || 1)) * 100)}% of total expenses)`,
                transactionIds: microTxs.map((t) => t.id).slice(0, 10),
            };
        } else {
            candidate3 = {
                type: 'FunFact_PurchaseFrequency',
                funFactTopic: 'Purchase Frequency',
                details: `You made ${expenses.length} purchases across ${daysInMonthSoFar} days — averaging one purchase every ${hoursPerPurchase} hours!`,
                transactionIds: expenses.slice(0, 10).map((t) => t.id),
            };
        }

        const richData = {
            month,
            previousMonthsKeys: [prevMonth1Key, prevMonth2Key],
            Candidate1_MoM_Increase: candidate1,
            Candidate2_MoM_Decrease: candidate2,
            Candidate3_FunFact: candidate3,
            summary: {
                income: money(analysis.summary.incomeMinor),
                expenses: money(analysis.summary.expenseMinor),
                savingsContribution: money(analysis.summary.savingMinor),
                netCashFlow: money(analysis.summary.netCashFlowMinor),
                totalTransactions: analysis.summary.transactionCount,
                expenseCount: expenses.length,
            },
        };

        try {
            const rawSynthesized = await synthesizeMonthlyInsightsWithGemini(richData);
            if (rawSynthesized && rawSynthesized.length) {
                selectedInsights = rawSynthesized.map((item) => ({
                    id: item.id,
                    type: 'ai_synthesis',
                    title: item.title,
                    fact: item.fact,
                    action: item.action,
                    confidence: item.confidence || 'high',
                    evidence: {
                        transactionIds: item.evidenceTransactionIds || [],
                        count: (item.evidenceTransactionIds || []).length,
                    },
                }));
                source = 'ai-synthesized';
            }
        } catch (error) {
            console.warn('[Monthly insights] Gemini synthesis error; attempting ranking fallback:', error.message);
        }

        // Fallback to ranking or deterministic candidates if Gemini synthesis was skipped/failed
        if (!selectedInsights) {
            let ranking = null;
            try {
                ranking = await rankMonthlyInsightCandidates(analysis.candidates);
            } catch (error) {
                console.warn('[Monthly insights] AI ranking fallback unavailable; using deterministic candidates:', error.message);
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
            selectedInsights = selected.map(({ actions, priority, ...insight }) => insight);
            source = ranking ? 'ai-ranked' : 'deterministic';
        }
    } else {
        selectedInsights = analysis.candidates.map(({ actions, priority, ...insight }) => ({
            ...insight,
            action: actions[0],
        })).slice(0, 3);
    }

    const result = {
        month,
        generatedAt: new Date().toISOString(),
        dataHash,
        source,
        summary: analysis.summary,
        dataQuality: analysis.dataQuality,
        insights: selectedInsights,
    };
    cache.set(cacheKey, result);

    await db.run(
        `INSERT INTO monthly_ai_briefs (userId, month, dataHash, briefJson, createdAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(userId, month, dataHash) DO UPDATE SET briefJson = excluded.briefJson, createdAt = excluded.createdAt`,
        [userId, month, dataHash, JSON.stringify(result), new Date().toISOString()]
    ).catch((err) => console.warn('[Monthly insights] DB persistence error:', err.message));

    return result;
}

module.exports = { buildMonthlyAnalysis, getMonthlyInsightBrief };
