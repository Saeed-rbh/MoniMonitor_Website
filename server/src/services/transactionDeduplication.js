const PLAID_PROVIDERS = new Set(['plaid', 'plaid_investments']);
const { refreshTransactionMonths } = require('../database/monthlySummaries');

const GENERIC_WORDS = new Set([
    'the', 'and', 'for', 'from', 'into', 'with', 'transfer', 'transfers',
    'etransfer', 'e-transfer', 'sent', 'received', 'payment', 'transaction',
    'purchase', 'sale', 'bank', 'account', 'card', 'cash', 'deposit',
    'withdrawal', 'chequing', 'checking', 'cibc', 'rbc', 'interac',
]);

function toMinorUnits(amount) {
    const numericAmount = Number(amount);
    return Number.isFinite(numericAmount) ? Math.round(numericAmount * 100) : null;
}

function normalizeIdentity(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeBank(value) {
    const normalized = normalizeIdentity(value);
    if (normalized.includes('cibc')) return 'cibc';
    if (normalized.includes('royalbank') || normalized === 'rbc' || normalized.includes('rbc')) return 'rbc';
    if (normalized.includes('wealthsimple')) return 'wealthsimple';
    return normalized;
}

function lastFour(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : null;
}

function transactionDirection(transaction = {}) {
    const flow = String(transaction.AccountFlow || '').toUpperCase();
    if (flow === 'IN' || flow === 'OUT') return flow;
    if (transaction.Category === 'Income') return 'IN';
    if (transaction.Category === 'Expense') return 'OUT';
    return null;
}

function normalizeWords(value) {
    return new Set(String(value || '').toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 2 && !GENERIC_WORDS.has(word)));
}

function reasonOverlap(left, right) {
    const a = normalizeWords(left);
    const b = normalizeWords(right);
    return [...a].filter((word) => b.has(word));
}

function compactReference(value) {
    const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /\d/.test(compact) && compact.length >= 6 ? compact : null;
}

function referenceTokens(value) {
    const text = String(value || '');
    const result = new Set();
    const whole = compactReference(text);
    if (whole && whole.length <= 40) result.add(whole);

    for (const token of text.toUpperCase().match(/[A-Z0-9]{6,}/g) || []) {
        if (/\d/.test(token)) result.add(token);
    }
    return result;
}

function referenceNumberTokens(value) {
    const reference = compactReference(value);
    return reference ? new Set([reference]) : new Set();
}

function reasonReferenceTokens(value) {
    const text = String(value || '');
    const result = new Set();
    let textWithoutBracketedReferences = text;
    for (const bracketed of text.matchAll(/\[([^\]]+)\]/g)) {
        const reference = compactReference(bracketed[1]);
        if (reference) result.add(reference);
        textWithoutBracketedReferences = textWithoutBracketedReferences.replace(bracketed[0], ' ');
    }

    // Bank descriptions commonly put the transfer number immediately after
    // "E-TRANSFER". Do not treat every account/security token in a reason as
    // a reference; e.g. HQ656S0K7CAD is an account identifier, not a unique
    // transaction ID.
    for (const match of text.matchAll(/\be[\s-]?transfer\b[^A-Z0-9]+([A-Z0-9]{6,})/ig)) {
        result.add(match[1].toUpperCase());
    }
    for (const token of textWithoutBracketedReferences.match(/\b\d{8,}\b/g) || []) result.add(token);
    return result;
}

function transactionReferences(transaction = {}) {
    return new Set([
        ...referenceNumberTokens(transaction.ReferenceNumber),
        ...reasonReferenceTokens(transaction.Reason),
    ]);
}

function hasReferenceMatch(left, right) {
    const leftRefs = transactionReferences(left);
    const rightRefs = transactionReferences(right);
    return [...leftRefs].some((reference) => rightRefs.has(reference));
}

function categoryCompatible(left, right) {
    if (left.Category === right.Category) return true;
    const leftDirection = transactionDirection(left);
    const rightDirection = transactionDirection(right);
    if (!leftDirection || leftDirection !== rightDirection) return false;
    return left.Category === 'Internal' || right.Category === 'Internal';
}

function sourcePriority(transaction = {}) {
    let score = 0;
    if (transaction.SourceEmailKey) score += 100;
    if (!transaction.hasPlaidSource && !transaction.hasPlaidInvestmentSource) score += 40;
    if (transaction.ReferenceNumber) score += 20;
    if (transaction.ReceivedAt) score += 10;
    if (String(transaction.Reason || '').length > 0) score += Math.min(10, String(transaction.Reason).length / 20);
    return score;
}

function compareCanonicalRows(left, right) {
    const priorityDifference = sourcePriority(left) - sourcePriority(right);
    if (priorityDifference !== 0) return priorityDifference;
    return Number(right.id || 0) - Number(left.id || 0);
}

function areComplementaryBankSources(candidate, incoming, options = {}) {
    const incomingProvider = String(options.incomingProvider || '').toLowerCase();
    const candidateHasEmail = Boolean(candidate.SourceEmailKey);
    const incomingHasEmail = Boolean(incoming.SourceEmailKey) || incomingProvider === 'email';
    const candidateHasPlaid = Boolean(candidate.hasPlaidSource);
    const incomingHasPlaid = Boolean(incoming.hasPlaidSource) || incomingProvider === 'plaid';
    return (candidateHasEmail && incomingHasPlaid) ||
        (incomingHasEmail && candidateHasPlaid);
}

function scoreTransactionMatch(candidate, incoming, options = {}) {
    const incomingAmount = Number.isSafeInteger(incoming.AmountMinor)
        ? incoming.AmountMinor
        : toMinorUnits(incoming.Amount);
    const candidateAmount = Number.isSafeInteger(candidate.AmountMinor)
        ? candidate.AmountMinor
        : toMinorUnits(candidate.Amount);
    if (incomingAmount === null || candidateAmount === null || incomingAmount !== candidateAmount) return null;

    const incomingCurrency = String(incoming.Currency || 'CAD').toUpperCase();
    const candidateCurrency = String(candidate.Currency || 'CAD').toUpperCase();
    if (incomingCurrency !== candidateCurrency) return null;
    if (!categoryCompatible(candidate, incoming)) return null;

    const incomingTime = new Date(incoming.Timestamp).getTime();
    const candidateTime = new Date(candidate.Timestamp).getTime();
    if (!Number.isFinite(incomingTime) || !Number.isFinite(candidateTime)) return null;
    const distanceDays = Math.abs(incomingTime - candidateTime) / 86400000;
    if (distanceDays > 3) return null;

    const sameDay = String(candidate.Timestamp).slice(0, 10) === String(incoming.Timestamp).slice(0, 10);
    const sameDirection = transactionDirection(candidate) &&
        transactionDirection(candidate) === transactionDirection(incoming);
    const sameBank = normalizeBank(candidate.BankName) &&
        normalizeBank(candidate.BankName) === normalizeBank(incoming.BankName);
    const candidateAccount = lastFour(candidate.Account);
    const incomingAccount = lastFour(incoming.Account);
    const sameAccount = candidateAccount && incomingAccount && candidateAccount === incomingAccount;
    const overlap = reasonOverlap(candidate.Reason, incoming.Reason);
    const referenceMatch = hasReferenceMatch(candidate, incoming);
    const complementaryBankSources = areComplementaryBankSources(candidate, incoming, options);

    if (referenceMatch) {
        // A shared transfer reference is authoritative only when the money is
        // moving in the same direction. This protects the two legs of an
        // internal transfer, which can legitimately share a reference.
        if (!sameDirection || !sameDay) return null;
        return {
            score: 100 + (categoryCompatible(candidate, incoming) ? 10 : 0) +
                (sameBank ? 5 : 0) + (sameAccount ? 5 : 0),
            referenceMatch: true,
            overlapCount: overlap.length,
        };
    }

    // Internal transfers have two legitimate legs with the same amount, date,
    // and description. Never collapse them without a shared unique reference.
    if (candidate.Category === 'Internal' || incoming.Category === 'Internal') return null;

    // Without a reference, require a same-day match plus enough independent
    // identity evidence. A complementary email/Plaid pair may have a shortened
    // merchant description (for example, "Uber Holdings C" versus "Uber").
    // Permit one shared merchant word only when bank and direction also agree;
    // amount alone is intentionally never sufficient.
    const hasStrongDescriptionMatch = overlap.length >= 2 ||
        (sameAccount && overlap.length >= 1) ||
        (complementaryBankSources && sameBank && sameDirection && overlap.length >= 1);
    if (!sameDay || !hasStrongDescriptionMatch) return null;

    return {
        score: 20 + overlap.length * 5 + (sameDirection ? 5 : 0) +
            (sameBank ? 4 : 0) + (sameAccount ? 8 : 0) +
            (complementaryBankSources ? 6 : 0),
        referenceMatch: false,
        overlapCount: overlap.length,
    };
}

function matchesInvestmentIdentity(candidate, incoming) {
    if (incoming.PortfolioAction && candidate.PortfolioAction !== incoming.PortfolioAction) return false;
    if (incoming.PortfolioSymbol && candidate.PortfolioSymbol !== incoming.PortfolioSymbol) return false;
    if (incoming.PortfolioQuantity !== null && incoming.PortfolioQuantity !== undefined &&
        candidate.PortfolioQuantity !== null && candidate.PortfolioQuantity !== undefined &&
        Math.abs(Number(candidate.PortfolioQuantity) - Number(incoming.PortfolioQuantity)) > 1e-8) return false;
    return true;
}

async function findTransactionMatch(db, userId, incoming, options = {}) {
    const timestamp = new Date(incoming.Timestamp).getTime();
    if (!Number.isFinite(timestamp)) return null;
    const from = new Date(timestamp - 3 * 86400000).toISOString();
    const to = new Date(timestamp + 3 * 86400000).toISOString();
    const amountMinor = Number.isSafeInteger(incoming.AmountMinor)
        ? incoming.AmountMinor
        : toMinorUnits(incoming.Amount);
    if (amountMinor === null) return null;

    const candidates = await db.all(
        `SELECT t.*,
                EXISTS (SELECT 1 FROM transaction_sources s
                        WHERE s.transactionId = t.id AND s.provider = 'plaid') AS hasPlaidSource,
                EXISTS (SELECT 1 FROM transaction_sources s
                        WHERE s.transactionId = t.id AND s.provider = 'plaid_investments') AS hasPlaidInvestmentSource
         FROM transactions t
         WHERE t.userId = ? AND t.id != ? AND t.AmountMinor = ?
           AND (t.Currency = ? OR t.Currency IS NULL)
           AND t.Timestamp BETWEEN ? AND ?`,
        [userId, options.excludeTransactionId || -1, amountMinor,
            String(incoming.Currency || 'CAD').toUpperCase(), from, to]
    );

    const ranked = candidates
        .filter((candidate) => options.mode !== 'investment' || matchesInvestmentIdentity(candidate, incoming))
        .map((candidate) => ({
            candidate,
            match: scoreTransactionMatch(candidate, incoming, options),
        }))
        .filter(({ match }) => match)
        .sort((left, right) => {
            if (right.match.score !== left.match.score) return right.match.score - left.match.score;
            return compareCanonicalRows(right.candidate, left.candidate);
        });

    if (!ranked.length) return null;
    if (!ranked[0].match.referenceMatch && ranked[1] &&
        ranked[0].match.score === ranked[1].match.score) return null;
    return ranked[0].candidate;
}

async function mergeTransactionRows(db, canonical, duplicate) {
    const sourceRows = await db.all(
        'SELECT * FROM transaction_sources WHERE transactionId = ? ORDER BY provider, externalId',
        [duplicate.id]
    );

    // Preserve the richer row while filling any missing metadata from the
    // duplicate. The canonical row remains the source of truth for category,
    // amount, and timestamp.
    const fillableColumns = [
        'ReceivedAt', 'Type', 'Account', 'BankName', 'ReferenceNumber',
        'AccountFlow', 'PortfolioAction', 'PortfolioAccountId', 'PortfolioConfidence',
        'PortfolioSymbol', 'PortfolioQuantity', 'PortfolioPrice', 'BalanceAccountId',
        'BalanceAccountConfidence', 'PortfolioAccountNumber', 'PortfolioToSymbol',
        'PortfolioToQuantity',
    ];
    const updates = [];
    const values = [];
    for (const column of fillableColumns) {
        if ((canonical[column] === null || canonical[column] === undefined || canonical[column] === '') &&
            duplicate[column] !== null && duplicate[column] !== undefined && duplicate[column] !== '') {
            updates.push(`${column} = ?`);
            values.push(duplicate[column]);
        }
    }
    if (!canonical.SourceEmailKey && duplicate.SourceEmailKey) {
        updates.push('SourceEmailKey = ?');
        values.push(duplicate.SourceEmailKey);
    }
    if (canonical.SourceEmailKey && sourceRows.some((source) => source.provider === 'plaid') &&
        duplicate.Timestamp && canonical.Timestamp !== duplicate.Timestamp) {
        // Historical reconciliation should make the same date choice as live
        // Plaid matching: the bank transaction date wins over email receipt time.
        updates.push('Timestamp = ?');
        values.push(duplicate.Timestamp);
    }
    if (updates.length) {
        values.push(canonical.id);
        await db.run(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    // Keep one balance event and one portfolio event for the real transaction.
    // The current account cash is an authoritative balance after Plaid sync;
    // removing the duplicate event prevents it from being counted again on a
    // later rebuild without subtracting the already-authoritative cash anchor.
    for (const table of ['account_balance_events', 'portfolio_transactions']) {
        const rows = await db.all(
            `SELECT * FROM ${table} WHERE sourceTransactionId = ? ORDER BY id`,
            [duplicate.id]
        );
        for (const row of rows) {
            const canonicalRow = await db.get(
                `SELECT id FROM ${table} WHERE sourceTransactionId = ?`,
                [canonical.id]
            );
            if (canonicalRow) {
                await db.run(`DELETE FROM ${table} WHERE id = ?`, [row.id]);
            } else {
                await db.run(
                    `UPDATE ${table} SET sourceTransactionId = ? WHERE id = ?`,
                    [canonical.id, row.id]
                );
            }
        }
    }

    for (const source of sourceRows) {
        const conflict = await db.get(
            `SELECT 1 FROM transaction_sources
             WHERE provider = ? AND externalId = ?
               AND transactionId NOT IN (?, ?)`,
            [source.provider, source.externalId, canonical.id, duplicate.id]
        );
        if (conflict) {
            await db.run(
                'DELETE FROM transaction_sources WHERE provider = ? AND externalId = ? AND transactionId = ?',
                [source.provider, source.externalId, duplicate.id]
            );
        } else {
            await db.run(
                `UPDATE transaction_sources
                 SET transactionId = ?, ownsTransaction = 0, updatedAt = ?
                 WHERE provider = ? AND externalId = ?`,
                [canonical.id, new Date().toISOString(), source.provider, source.externalId]
            );
        }
    }

    await db.run('DELETE FROM transactions WHERE id = ?', [duplicate.id]);
    const updatedCanonical = await db.get('SELECT * FROM transactions WHERE id = ?', [canonical.id]);
    await refreshTransactionMonths(db, [canonical, duplicate, updatedCanonical]);
    return { canonicalId: canonical.id, removedId: duplicate.id, linkedSources: sourceRows.length };
}

async function loadDedupRows(db, userId) {
    return db.all(
        `SELECT t.*,
                EXISTS (SELECT 1 FROM transaction_sources s
                        WHERE s.transactionId = t.id AND s.provider = 'plaid') AS hasPlaidSource,
                EXISTS (SELECT 1 FROM transaction_sources s
                        WHERE s.transactionId = t.id AND s.provider = 'plaid_investments') AS hasPlaidInvestmentSource
         FROM transactions t
         WHERE t.userId = ? ORDER BY t.Timestamp ASC, t.id ASC`,
        [userId]
    );
}

async function reconcileTransactionDuplicates(db, userId = null, options = {}) {
    const users = userId
        ? [{ id: userId }]
        : await db.all('SELECT id FROM users ORDER BY id');
    const summary = { users: users.length, merged: 0, removedTransactionIds: [], linkedSources: 0 };
    const dryRun = Boolean(options.dryRun);
    const dryRunPairs = new Set();

    for (const user of users) {
        const rows = await loadDedupRows(db, user.id);
        const sourceRows = rows.filter((row) => row.SourceEmailKey ||
            row.hasPlaidSource || row.hasPlaidInvestmentSource);
        if (!dryRun) await db.run('BEGIN IMMEDIATE');
        try {
            for (const sourceRow of sourceRows) {
                const current = await db.get(
                    `SELECT t.*,
                            EXISTS (SELECT 1 FROM transaction_sources s
                                    WHERE s.transactionId = t.id AND s.provider = 'plaid') AS hasPlaidSource,
                            EXISTS (SELECT 1 FROM transaction_sources s
                                    WHERE s.transactionId = t.id AND s.provider = 'plaid_investments') AS hasPlaidInvestmentSource
                     FROM transactions t WHERE t.id = ? AND t.userId = ?`,
                    [sourceRow.id, user.id]
                );
                if (!current) continue;
                const match = await findTransactionMatch(db, user.id, current, {
                    excludeTransactionId: current.id,
                    mode: current.hasPlaidInvestmentSource ? 'investment' : 'bank',
                });
                if (!match) continue;

                const canonical = compareCanonicalRows(current, match) >= 0 ? current : match;
                const duplicate = canonical.id === current.id ? match : current;
                if (dryRun) {
                    const pairKey = [canonical.id, duplicate.id].sort((a, b) => a - b).join(':');
                    if (dryRunPairs.has(pairKey)) continue;
                    dryRunPairs.add(pairKey);
                    summary.merged += 1;
                    summary.removedTransactionIds.push(duplicate.id);
                    continue;
                }
                const result = await mergeTransactionRows(db, canonical, duplicate);
                summary.merged += 1;
                summary.removedTransactionIds.push(result.removedId);
                summary.linkedSources += result.linkedSources;
            }
            if (!dryRun) await db.run('COMMIT');
        } catch (error) {
            if (!dryRun) await db.run('ROLLBACK');
            throw error;
        }
    }
    return summary;
}

module.exports = {
    PLAID_PROVIDERS,
    normalizeWords,
    reasonOverlap,
    referenceTokens,
    hasReferenceMatch,
    scoreTransactionMatch,
    findTransactionMatch,
    mergeTransactionRows,
    reconcileTransactionDuplicates,
};
