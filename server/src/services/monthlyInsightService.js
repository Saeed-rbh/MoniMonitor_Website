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
    for (let offset = 1; offset <= 6; offset += 1) {
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
    const earliest = monthRange(month, 6).start.toISOString();
    const latest = monthRange(month, -1).start.toISOString();
    const transactions = await db.all(
        `SELECT * FROM transactions WHERE userId = ? AND Timestamp >= ? AND Timestamp < ? ORDER BY Timestamp ASC`,
        [userId, earliest, latest]
    );
    const pending = await db.get(`SELECT COUNT(*) AS count FROM email_ingestion_queue WHERE status = 'pending'`);
    const analysis = buildMonthlyAnalysis(transactions, month, { pendingEmails: pending?.count || 0 });
    const cacheKey = `${userId}:${month}`;
    if (!options.refresh) {
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        const dbRecord = await db.get(
            `SELECT briefJson FROM monthly_ai_briefs WHERE userId = ? AND month = ? ORDER BY id DESC LIMIT 1`,
            [userId, month]
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

    const dataHash = hashAnalysis(analysis);

    let selectedInsights = null;
    let source = 'deterministic';

    if (analysis.dataQuality.pendingEmails === 0 && analysis.candidates.length) {
        const currentMonthTxs = transactions.filter((t) => String(t.Timestamp || '').slice(0, 7) === month);
        const expenses = currentMonthTxs.filter(isExpense);
        const income = currentMonthTxs.filter(isIncome);
        const sortedExpenses = [...expenses].sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));

        const microTxs = sortedExpenses.filter((t) => amountMinor(t) <= 2000);
        const microSumMinor = microTxs.reduce((sum, t) => sum + amountMinor(t), 0);

        const dayOfWeekMap = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
        const dayTotals = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
        const dayCounts = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
        let weekendSum = 0;
        const weekendIds = [];

        sortedExpenses.forEach((t) => {
            const dow = new Date(t.Timestamp).getUTCDay();
            const dayName = dayOfWeekMap[dow];
            const amt = amountMinor(t);
            dayTotals[dayName] += amt;
            dayCounts[dayName] += 1;
            if (dow === 0 || dow === 6) {
                weekendSum += amt;
                weekendIds.push(t.id);
            }
        });

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

        const past6Months = [];
        for (let i = 1; i <= 6; i++) {
            const mKey = monthRange(month, i).key;
            const mTxs = transactions.filter((t) => String(t.Timestamp || '').slice(0, 7) === mKey);
            const mExpenseTotal = mTxs.filter(isExpense).reduce((sum, t) => sum + amountMinor(t), 0);
            if (mExpenseTotal > 0 || mTxs.length > 0) {
                past6Months.push({ month: mKey, totalMinor: mExpenseTotal, txs: mTxs });
            }
        }

        const valid6MoTotals = past6Months.map(m => m.totalMinor).filter(tot => tot > 0);
        const sixMoAvgMinor = valid6MoTotals.length
            ? Math.round(valid6MoTotals.reduce((a, b) => a + b, 0) / valid6MoTotals.length)
            : analysis.summary.expenseMinor;

        const deltaVs6MoAvg = sixMoAvgMinor > 0
            ? Math.round(((analysis.summary.expenseMinor - sixMoAvgMinor) / sixMoAvgMinor) * 100)
            : 0;

        const isSixMonthHigh = valid6MoTotals.length >= 2 && analysis.summary.expenseMinor >= Math.max(...valid6MoTotals);
        const isSixMonthLow = valid6MoTotals.length >= 2 && analysis.summary.expenseMinor <= Math.min(...valid6MoTotals);

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
        const curCategoriesMap = getCategoryTotalsMap(currentMonthTxs);

        const allPast6MoTxs = past6Months.flatMap(m => m.txs);
        const past6MoMerchantsMap = getMerchantTotalsMap(allPast6MoTxs);
        const p1Txs = past6Months[0]?.txs || [];
        const p1MerchantsMap = getMerchantTotalsMap(p1Txs);
        const p1CategoriesMap = getCategoryTotalsMap(p1Txs);

        let consecutiveCategoryTrend = null;
        if (past6Months.length >= 2) {
            const p2Txs = past6Months[1]?.txs || [];
            const p2CategoriesMap = getCategoryTotalsMap(p2Txs);

            for (const [cat, curEntry] of Object.entries(curCategoriesMap)) {
                const p1Entry = p1CategoriesMap[cat] || { totalMinor: 0 };
                const p2Entry = p2CategoriesMap[cat] || { totalMinor: 0 };
                if (curEntry.totalMinor > p1Entry.totalMinor && p1Entry.totalMinor > p2Entry.totalMinor && p2Entry.totalMinor > 0) {
                    consecutiveCategoryTrend = {
                        category: cat,
                        current: money(curEntry.totalMinor),
                        p1: money(p1Entry.totalMinor),
                        p2: money(p2Entry.totalMinor),
                        ids: curEntry.ids,
                    };
                    break;
                }
            }
        }

        let candidate1;
        if (consecutiveCategoryTrend) {
            candidate1 = {
                type: '6Month_Consecutive_Rise',
                topic: `${consecutiveCategoryTrend.category} 3-Month Momentum`,
                summary: `${consecutiveCategoryTrend.category} spending has risen for 3 straight months (${consecutiveCategoryTrend.p2} → ${consecutiveCategoryTrend.p1} → ${consecutiveCategoryTrend.current}).`,
                transactionIds: consecutiveCategoryTrend.ids,
            };
        } else if (isSixMonthHigh) {
            candidate1 = {
                type: '6Month_High',
                topic: '6-Month Spending Peak',
                summary: `This month's expenses (${money(analysis.summary.expenseMinor)}) are the highest in 6 months, ${deltaVs6MoAvg}% above your 6-month average of ${money(sixMoAvgMinor)}.`,
                transactionIds: expenses.slice(0, 10).map(t => t.id),
            };
        } else if (isSixMonthLow) {
            candidate1 = {
                type: '6Month_Low',
                topic: '6-Month Spending Low',
                summary: `Spending this month (${money(analysis.summary.expenseMinor)}) is your lowest in 6 months, saving ${money(sixMoAvgMinor - analysis.summary.expenseMinor)} vs your 6-month norm.`,
                transactionIds: expenses.slice(0, 10).map(t => t.id),
            };
        } else {
            candidate1 = {
                type: '6Month_Baseline',
                topic: '6-Month Trajectory',
                summary: `Monthly spend of ${money(analysis.summary.expenseMinor)} is ${Math.abs(deltaVs6MoAvg)}% ${deltaVs6MoAvg >= 0 ? 'above' : 'below'} your 6-month average of ${money(sixMoAvgMinor)}.`,
                transactionIds: expenses.slice(0, 10).map(t => t.id),
            };
        }

        const brandNewMerchants = Object.entries(curMerchantsMap)
            .filter(([name, cur]) => !past6MoMerchantsMap[name] && cur.totalMinor >= 15000)
            .sort((a, b) => b[1].totalMinor - a[1].totalMinor);

        const topCategoryEntry = Object.entries(curCategoriesMap)
            .map(([cat, cur]) => ({
                category: cat,
                totalMinor: cur.totalMinor,
                share: analysis.summary.expenseMinor > 0 ? Math.round((cur.totalMinor / analysis.summary.expenseMinor) * 100) : 0,
                ids: cur.ids,
            }))
            .sort((a, b) => b.totalMinor - a.totalMinor)[0];

        let candidate2;
        if (brandNewMerchants.length > 0) {
            const [name, info] = brandNewMerchants[0];
            candidate2 = {
                type: 'Unexpected_NewMerchant',
                topic: `New Merchant: ${name}`,
                summary: `Spent ${money(info.totalMinor)} at ${name} with zero prior spending recorded across the last 6 months.`,
                transactionIds: info.ids,
            };
        } else if (topCategoryEntry && topCategoryEntry.share >= 38) {
            candidate2 = {
                type: 'Unexpected_CategoryConcentration',
                topic: `${topCategoryEntry.category} Concentration`,
                summary: `${topCategoryEntry.category} absorbed ${topCategoryEntry.share}% of your total budget this month (${money(topCategoryEntry.totalMinor)}).`,
                transactionIds: topCategoryEntry.ids,
            };
        } else {
            const incMerchants = Object.entries(curMerchantsMap)
                .map(([name, cur]) => ({
                    name,
                    diffMinor: cur.totalMinor - (p1MerchantsMap[name]?.totalMinor || 0),
                    curTotal: cur.totalMinor,
                    ids: cur.ids,
                }))
                .filter(m => m.diffMinor > 2000)
                .sort((a, b) => b.diffMinor - a.diffMinor);

            if (incMerchants.length > 0) {
                candidate2 = {
                    type: 'Unexpected_MerchantShift',
                    topic: `${incMerchants[0].name} Surge`,
                    summary: `Spending at ${incMerchants[0].name} increased by ${money(incMerchants[0].diffMinor)} compared to last month (${money(incMerchants[0].curTotal)} total).`,
                    transactionIds: incMerchants[0].ids,
                };
            } else {
                candidate2 = {
                    type: 'Unexpected_BalancedPattern',
                    topic: 'Stable Expense Spread',
                    summary: `Expenses were evenly distributed across ${Object.keys(curCategoriesMap).length} categories with no unexpected merchant spikes.`,
                    transactionIds: expenses.slice(0, 5).map(t => t.id),
                };
            }
        }

        const diningMinor = curCategoriesMap['Dining']?.totalMinor || 0;
        const groceriesMinor = curCategoriesMap['Groceries']?.totalMinor || 0;
        const diningTxIds = curCategoriesMap['Dining']?.ids || [];
        const weekendShare = analysis.summary.expenseMinor > 0
            ? Math.round((weekendSum / analysis.summary.expenseMinor) * 100)
            : 0;
        const postPaydayShare = analysis.summary.expenseMinor > 0
            ? Math.round((postPaydaySumMinor / analysis.summary.expenseMinor) * 100)
            : 0;

        const sortedDays = Object.entries(dayTotals).sort((a, b) => b[1] - a[1]);
        const topDay = sortedDays[0];

        let candidate3;
        if (diningMinor > 0 && groceriesMinor > 0 && Math.abs(diningMinor - groceriesMinor) > 2000) {
            const ratio = (diningMinor / groceriesMinor).toFixed(1);
            if (Number(ratio) >= 1.4) {
                candidate3 = {
                    type: 'FunFact_FoodRatio',
                    funFactTopic: 'Dining Out vs Groceries',
                    details: `You spent $${ratio} on dining out for every $1.00 spent on groceries (${money(diningMinor)} vs ${money(groceriesMinor)}).`,
                    transactionIds: diningTxIds.slice(0, 10),
                };
            }
        }

        if (!candidate3 && weekendShare >= 42 && weekendIds.length >= 3) {
            candidate3 = {
                type: 'FunFact_WeekendRush',
                funFactTopic: 'Weekend Spending Momentum',
                details: `${weekendShare}% of your total monthly spending (${money(weekendSum)}) occurred on Saturdays & Sundays across ${weekendIds.length} purchases.`,
                transactionIds: weekendIds.slice(0, 10),
            };
        } else if (!candidate3 && postPaydayShare >= 45 && postPaydayTxs.length >= 3) {
            candidate3 = {
                type: 'FunFact_PaydayVelocity',
                funFactTopic: 'Post-Payday Sprint',
                details: `${postPaydayShare}% of your expenses (${money(postPaydaySumMinor)}) happened within 5 days of receiving your income.`,
                transactionIds: postPaydayTxs.map((t) => t.id).slice(0, 10),
            };
        } else if (!candidate3 && microTxs.length >= 5) {
            candidate3 = {
                type: 'FunFact_MicroPurchases',
                funFactTopic: 'Micro-purchases under $20',
                details: `${microTxs.length} small purchases under $20 quietly added up to ${money(microSumMinor)} (${Math.round((microSumMinor / (analysis.summary.expenseMinor || 1)) * 100)}% of total expenses).`,
                transactionIds: microTxs.map((t) => t.id).slice(0, 10),
            };
        } else if (!candidate3 && topDay && topDay[1] > 0 && dayCounts[topDay[0]] >= 2) {
            candidate3 = {
                type: 'FunFact_PeakDay',
                funFactTopic: `${topDay[0]} Peak Day`,
                details: `${topDay[0]}s were your highest spending day of the week, totaling ${money(topDay[1])} across ${dayCounts[topDay[0]]} purchases.`,
                transactionIds: sortedExpenses.filter((t) => dayOfWeekMap[new Date(t.Timestamp).getUTCDay()] === topDay[0]).map((t) => t.id).slice(0, 10),
            };
        } else if (!candidate3) {
            const daysInMonthSoFar = analysis.latestDay || 1;
            const hoursPerPurchase = Math.round(((daysInMonthSoFar * 24) / (expenses.length || 1)) * 10) / 10;
            candidate3 = {
                type: 'FunFact_PurchaseFrequency',
                funFactTopic: 'Purchase Rhythm',
                details: `You made ${expenses.length} purchases across ${daysInMonthSoFar} days — averaging one purchase every ${hoursPerPurchase} hours.`,
                transactionIds: expenses.slice(0, 10).map(t => t.id),
            };
        }

        const richData = {
            month,
            past6MonthsKeys: past6Months.map(m => m.month),
            Candidate1_SixMonthTrend: candidate1,
            Candidate2_UnexpectedPattern: candidate2,
            Candidate3_BehaviorDiscovery: candidate3,
            summary: {
                income: money(analysis.summary.incomeMinor),
                expenses: money(analysis.summary.expenseMinor),
                sixMonthAverageExpenses: money(sixMoAvgMinor),
                deltaVsSixMonthAvg: `${deltaVs6MoAvg > 0 ? '+' : ''}${deltaVs6MoAvg}%`,
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
                    metric: item.metric || '',
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
            console.warn('[Monthly AI brief] Gemini synthesis error; using ranking fallback:', error.message);
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
         ON CONFLICT(userId, month) DO UPDATE SET dataHash = excluded.dataHash, briefJson = excluded.briefJson, createdAt = excluded.createdAt`,
        [userId, month, dataHash, JSON.stringify(result), new Date().toISOString()]
    ).catch((err) => console.warn('[Monthly insights] DB persistence error:', err.message));

    return result;
}

module.exports = { buildMonthlyAnalysis, getMonthlyInsightBrief };
