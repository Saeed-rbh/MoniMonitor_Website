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
    let text = String(value || '').toLowerCase();
    text = text.replace(/\bcanadian union of public (employees|emplo|emp)?\b/g, 'cupe');
    text = text.replace(/\btoyota (financial services|financial|finance)\b/g, 'toyota finance');
    return new Set(text
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
    if (isInteracDeposit(transaction)) score += 50;
    if (transaction.ReceivedAt) score += 10;
    if (String(transaction.Reason || '').length > 0) score += Math.min(10, String(transaction.Reason).length / 20);
    return score;
}

function isDepositNotice(row) {
    return row.Category === 'Income' && !row.PortfolioAction &&
        /^(deposit(?: notice| to| -)?|bank deposit|rbc(?: royal bank)? deposit)/i.test(String(row.Reason || '')) &&
        !transactionReferences(row).size;
}

function isInteracDeposit(row) {
    return row.Category === 'Income' && !row.PortfolioAction && transactionDirection(row) === 'IN' &&
        /e[\s-]?transfer|interac/i.test(`${row.Type || ''} ${row.Reason || ''}`) &&
        transactionReferences(row).size > 0;
}

function isComplementaryDepositPair(left, right) {
    return (isDepositNotice(left) && isInteracDeposit(right)) ||
        (isDepositNotice(right) && isInteracDeposit(left));
}

const localDay = value => {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(time)) : null;
};

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
    if ((candidate.PortfolioAction || incoming.PortfolioAction) &&
        !matchesInvestmentIdentity(candidate, incoming)) return null;
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
    const candidateReferences = transactionReferences(candidate);
    const incomingReferences = transactionReferences(incoming);
    // Generated group IDs describe relationships, not provider event identities.
    const externalReferences = references => [...references].filter(ref => !/^(XFER|REFUND)/.test(ref));
    if (!referenceMatch && externalReferences(candidateReferences).length &&
        externalReferences(incomingReferences).length) return null;
    // Explicit account identities and flow override coincidental text/reference matches.
    if (candidate.BalanceAccountId && incoming.BalanceAccountId &&
        Number(candidate.BalanceAccountId) !== Number(incoming.BalanceAccountId)) return null;
    if (candidateAccount && incomingAccount && !sameAccount) return null;
    if (normalizeBank(candidate.BankName) && normalizeBank(incoming.BankName) && !sameBank) return null;
    if (transactionDirection(candidate) && transactionDirection(incoming) && !sameDirection) return null;
    const investmentSources = (candidate.SourceEmailKey &&
        (incoming.hasPlaidInvestmentSource || options.incomingProvider === 'plaid_investments')) ||
        (incoming.SourceEmailKey && candidate.hasPlaidInvestmentSource);
    if (investmentSources && candidate.PortfolioAction && incoming.PortfolioAction && sameBank &&
        candidate.PortfolioSymbol && incoming.PortfolioSymbol &&
        !(candidate.SourceEmailKey && incoming.SourceEmailKey && candidate.SourceEmailKey !== incoming.SourceEmailKey)) {
        return { score: 75 + (sameDay ? 10 : 0) + (sameAccount ? 5 : 0),
            referenceMatch: false, overlapCount: overlap.length };
    }

    // These are two distinct notifications for one deposit, not two copies of
    // the same email. Limit automatic linking to RBC and a short notification
    // window. Ambiguous candidates are held by findTransactionMatchResult.
    if (isComplementaryDepositPair(candidate, incoming) && sameBank &&
        normalizeBank(candidate.BankName) === 'rbc' && sameAccount && sameDirection &&
        localDay(candidate.Timestamp) === localDay(incoming.Timestamp)) {
        const receiptDistance = Math.abs(new Date(candidate.ReceivedAt).getTime() -
            new Date(incoming.ReceivedAt).getTime());
        if (distanceDays * 86400000 <= 30 * 60000 ||
            (candidate.ReceivedAt && incoming.ReceivedAt && receiptDistance <= 30 * 60000)) {
            return { score: 80, referenceMatch: false, overlapCount: overlap.length, depositNoticeMatch: true };
        }
    }

    if (referenceMatch) {
        // A shared transfer reference is authoritative only when the money is
        // moving in the same direction. This protects the two legs of an
        // internal transfer, which can legitimately share a reference.
        if (!sameDirection) return null;
        return {
            score: 100 + (categoryCompatible(candidate, incoming) ? 10 : 0) +
                (sameBank ? 5 : 0) + (sameAccount ? 5 : 0),
            referenceMatch: true,
            overlapCount: overlap.length,
        };
    }

    if (candidate.SourceEmailKey && incoming.SourceEmailKey &&
        candidate.SourceEmailKey !== incoming.SourceEmailKey && !complementaryBankSources) return null;

    // Internal transfers have two legitimate legs with the same amount, date,
    // and description. Never collapse them without a shared unique reference.
    if (candidate.Category === 'Internal' || incoming.Category === 'Internal') {
        // Link a provider copy to the same account leg even after the email leg
        // was reclassified and its original description/reference was replaced.
        if (!complementaryBankSources || !sameDirection || !sameBank ||
            !sameAccount || distanceDays > 3) return null;
        return { score: 60 + (sameDay ? 10 : 0), referenceMatch: false, overlapCount: overlap.length };
    }

    // Without a reference, require a same-day match plus enough independent
    // identity evidence. A complementary email/Plaid pair may have a shortened
    // merchant description (for example, "Uber Holdings C" versus "Uber").
    // Permit one shared merchant word only when bank and direction also agree;
    // amount alone is intentionally never sufficient.
    const hasStrongDescriptionMatch = overlap.length >= 2 ||
        (sameAccount && overlap.length >= 1) ||
        (complementaryBankSources && sameBank && sameDirection && overlap.length >= 1);
    if ((!sameDay && !(complementaryBankSources && sameAccount && sameBank && sameDirection)) ||
        !hasStrongDescriptionMatch) return null;

    return {
        score: 20 + overlap.length * 5 + (sameDirection ? 5 : 0) +
            (sameBank ? 4 : 0) + (sameAccount ? 8 : 0) +
            (complementaryBankSources ? 6 : 0),
        referenceMatch: false,
        overlapCount: overlap.length,
    };
}

function matchesInvestmentIdentity(candidate, incoming) {
    if (candidate.PortfolioAction !== incoming.PortfolioAction) return false;
    if (String(candidate.Currency || 'CAD').toUpperCase() !== String(incoming.Currency || 'CAD').toUpperCase()) return false;
    if (normalizeBank(candidate.BankName) && normalizeBank(incoming.BankName) &&
        normalizeBank(candidate.BankName) !== normalizeBank(incoming.BankName)) return false;
    if (transactionDirection(candidate) && transactionDirection(incoming) &&
        transactionDirection(candidate) !== transactionDirection(incoming)) return false;
    const symbol = value => String(value || '').toUpperCase().replace(/XF$/, '');
    if (incoming.PortfolioSymbol &&
        symbol(candidate.PortfolioSymbol) !== symbol(incoming.PortfolioSymbol)) return false;
    if (candidate.PortfolioAccountId && incoming.PortfolioAccountId &&
        Number(candidate.PortfolioAccountId) !== Number(incoming.PortfolioAccountId)) return false;
    if (['BUY', 'SELL'].includes(incoming.PortfolioAction) &&
        incoming.PortfolioQuantity !== null && incoming.PortfolioQuantity !== undefined &&
        candidate.PortfolioQuantity !== null && candidate.PortfolioQuantity !== undefined &&
        Math.abs(Number(candidate.PortfolioQuantity) - Number(incoming.PortfolioQuantity)) > 0.0005) return false;
    return true;
}

async function findTransactionMatchResult(db, userId, incoming, options = {}) {
    const timestamp = new Date(incoming.Timestamp).getTime();
    if (!Number.isFinite(timestamp)) return { match: null, reviewIds: [] };
    const from = new Date(timestamp - 3 * 86400000).toISOString();
    const to = new Date(timestamp + 3 * 86400000).toISOString();
    const amountMinor = Number.isSafeInteger(incoming.AmountMinor)
        ? incoming.AmountMinor
        : toMinorUnits(incoming.Amount);
    if (amountMinor === null) return { match: null, reviewIds: [] };

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

    const depositCandidates = candidates.filter(candidate =>
        candidate.SourceEmailKey && incoming.SourceEmailKey && candidate.SourceEmailKey !== incoming.SourceEmailKey &&
        isComplementaryDepositPair(candidate, incoming) &&
        normalizeBank(candidate.BankName) === 'rbc' && normalizeBank(incoming.BankName) === 'rbc' &&
        lastFour(candidate.Account) && lastFour(candidate.Account) === lastFour(incoming.Account) &&
        localDay(candidate.Timestamp) === localDay(incoming.Timestamp) &&
        (!candidate.BalanceAccountId || !incoming.BalanceAccountId ||
            Number(candidate.BalanceAccountId) === Number(incoming.BalanceAccountId)));
    // Never pick the closest of several equal deposits: receipt order is not
    // proof of event identity. A source already paired is also not reusable.
    if (depositCandidates.length) {
        let consumed = false;
        for (const candidate of depositCandidates) {
            const sources = await db.all(`SELECT contextPayloadJson FROM transaction_sources
                WHERE transactionId = ? AND provider = 'email'`, [candidate.id]);
            const kinds = new Set(sources.map(s => {
                try { return JSON.parse(s.contextPayloadJson || '{}').notificationKind; } catch { return null; }
            }));
            if (kinds.has('deposit_notice') && kinds.has('interac_deposit')) consumed = true;
        }
        if (depositCandidates.length > 1 || consumed || !ranked.some(r => r.match.depositNoticeMatch)) {
            return { match: null, reviewIds: depositCandidates.map(row => row.id) };
        }
    }
    if (!ranked.length) return { match: null, reviewIds: [] };
    if (!ranked[0].match.referenceMatch && ranked[1] &&
        ranked[0].match.score === ranked[1].match.score) return { match: null,
            reviewIds: ranked.filter(r => r.match.score === ranked[0].match.score).map(r => r.candidate.id) };
    return { match: ranked[0].candidate, reviewIds: [] };
}

async function findTransactionMatch(db, userId, incoming, options = {}) {
    return (await findTransactionMatchResult(db, userId, incoming, options)).match;
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

    // Pairings must survive removal of a provider duplicate (FK cascades would
    // otherwise erase the refund's relationship to the original purchase).
    const hasRefundPairings = await db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'refund_pairings'");
    if (hasRefundPairings) {
        await db.run(`DELETE FROM refund_pairings WHERE refundTransactionId = ?
            AND EXISTS (SELECT 1 FROM refund_pairings WHERE refundTransactionId = ?)`, [duplicate.id, canonical.id]);
        await db.run('UPDATE refund_pairings SET refundTransactionId = ? WHERE refundTransactionId = ?', [canonical.id, duplicate.id]);
        await db.run('UPDATE refund_pairings SET purchaseTransactionId = ? WHERE purchaseTransactionId = ?', [canonical.id, duplicate.id]);
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
                if (table === 'account_balance_events') {
                    const account = await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?',
                        [row.accountId, duplicate.userId]);
                    if (account?.balanceSource !== 'plaid' &&
                        Number(row.balanceRevision) === Number(account?.balanceRevision)) {
                        const restored = Number(account.cashMinor) - Number(row.deltaMinor);
                        if (!Number.isSafeInteger(restored)) throw new Error('Duplicate balance cannot be safely reversed');
                        await db.run('UPDATE investment_accounts SET cashMinor = ?, updatedAt = ? WHERE id = ?',
                            [restored, new Date().toISOString(), account.id]);
                    }
                } else if (!row.reversedAt) {
                    const account = await db.get('SELECT * FROM investment_accounts WHERE id = ?', [row.accountId]);
                    if (account && (account.balanceSource !== 'plaid' || account.holdingsSource !== 'plaid')) {
                        throw new Error('Duplicate applied portfolio activity requires an audited reversal before merging');
                    }
                }
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

    // Sent notification receipts still reference the ledger through a
    // restrictive FK. Preserve them on the surviving transaction as well.
    const hasOutbox = await db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'telegram_outbox'");
    if (hasOutbox) await db.run('UPDATE telegram_outbox SET transactionId = ? WHERE transactionId = ?',
        [canonical.id, duplicate.id]);
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
        const runReconciliation = async () => {
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
            };
        if (!dryRun) {
            await db.withTransaction(runReconciliation);
        } else {
            await runReconciliation();
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
    findTransactionMatchResult,
    matchesInvestmentIdentity,
    isDepositNotice,
    isInteracDeposit,
    mergeTransactionRows,
    reconcileTransactionDuplicates,
};
