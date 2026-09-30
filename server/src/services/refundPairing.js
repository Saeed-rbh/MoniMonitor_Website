const { refreshTransactionMonths } = require('../database/monthlySummaries');

function normalizeIdentity(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeBank(value) {
    const normalized = normalizeIdentity(value);
    if (normalized.includes('royalbank') || normalized.includes('rbc')) return 'rbc';
    if (normalized.includes('cibc')) return 'cibc';
    if (normalized.includes('wealthsimple')) return 'wealthsimple';
    return normalized;
}

function lastFourDigits(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * Normalizes merchant descriptions to extract a core merchant token for robust matching.
 * e.g.:
 *  "AMAZON.COM PMTS - CA" -> "amazon"
 *  "AMZN Mktp CA" -> "amazon"
 *  "WALMART.CA" -> "walmart"
 *  "Groceries - Walmart" -> "walmart"
 *  "GOOGLE *SERVICES" -> "google"
 *  "GOOGLE *TEMPORARY HOLD" -> "google"
 *  "SERVICE CHARGE DISCOUNT" -> "service charge"
 *  "Bank fee refund - CIBC Chequing" -> "service charge"
 */
function normalizeMerchantName(text) {
    if (!text) return '';
    let cleaned = String(text).trim();

    // Strip common transaction prefixes
    cleaned = cleaned.replace(/^(refund or credit|payment or purchase|groceries|digital service|home or utility expense|bank or card fee|bank fee refund|annual fee rebate)\s*[-:]\s*/i, '');
    cleaned = cleaned.replace(/^service charge discount/i, 'service charge');
    cleaned = cleaned.replace(/^service charge/i, 'service charge');

    // Known merchant acronym & pattern mapping
    if (/\b(amazon|amzn)\b/i.test(cleaned)) return 'amazon';
    if (/\bwalmart\b/i.test(cleaned)) return 'walmart';
    if (/\bgoogle\b/i.test(cleaned)) return 'google';
    if (/\buber(\s*eats)?\b/i.test(cleaned)) return 'uber';
    if (/\btemu\b/i.test(cleaned)) return 'temu';
    if (/\balibaba\b/i.test(cleaned)) return 'alibaba';
    if (/\bdanier\b/i.test(cleaned)) return 'danier';
    if (/\bapple\b/i.test(cleaned)) return 'apple';
    if (/\bservice charge\b/i.test(cleaned)) return 'service charge';

    // Strip common noise tokens and trailing locations
    cleaned = cleaned.toLowerCase()
        .replace(/\.ca\b|\.com\b/g, '')
        .replace(/\b(pmts|mktp|store|online|hold|services?|canada|inc|ltd|corp)\b/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return cleaned;
}

function areAccountsCompatible(purchase, refund) {
    if (purchase.BalanceAccountId && refund.BalanceAccountId) {
        return Number(purchase.BalanceAccountId) === Number(refund.BalanceAccountId);
    }
    const pLast4 = lastFourDigits(purchase.Account);
    const rLast4 = lastFourDigits(refund.Account);
    if (pLast4 && rLast4) return pLast4 === rLast4 && normalizeBank(purchase.BankName) === normalizeBank(refund.BankName);

    const pBank = normalizeBank(purchase.BankName);
    const rBank = normalizeBank(refund.BankName);
    if (pBank && rBank && pBank === rBank) {
        const pType = normalizeIdentity(purchase.Type);
        const rType = normalizeIdentity(refund.Type);
        if (pType && rType && pType === rType &&
            normalizeIdentity(purchase.Account) && normalizeIdentity(purchase.Account) === normalizeIdentity(refund.Account)) return true;
        // Credit card accounts within the same bank match
        if ((pType.includes('credit') || purchase.Account?.toLowerCase().includes('visa')) &&
            (rType.includes('credit') || refund.Account?.toLowerCase().includes('visa'))) {
            return false;
        }
    }
    return false;
}

function isRefundTransaction(transaction) {
    if (!transaction) return false;
    if (String(transaction.AccountFlow || '').toUpperCase() === 'OUT' || transaction.Category === 'Expense') return false;
    if (transaction.Category === 'Internal' || /^XFER-/i.test(String(transaction.ReferenceNumber || ''))) {
        return false;
    }
    if (transaction.Label === 'Employment Income' || transaction.Label === 'Personal Transfers Received') {
        return false;
    }
    if (transaction.Label === 'Refunds & Reversals') return true;

    const reason = String(transaction.Reason || '');
    if (/\b(refund|reversal|chargeback|annual fee rebate|service charge discount)\b/i.test(reason)) {
        return true;
    }
    if (transaction.AccountFlow === 'IN' && /\b(credit|rebate|return)\b/i.test(reason)) {
        return true;
    }
    return false;
}

/**
 * Finds the best matching purchase transaction for a given refund.
 */
async function findPurchaseCandidateForRefund(db, userId, refund, options = {}) {
    const lookbackDays = options.lookbackDays || 90;
    const forwardGraceHours = options.forwardGraceHours || 24;

    const refundTime = new Date(refund.Timestamp).getTime();
    if (!Number.isFinite(refundTime)) return null;

    const minTime = new Date(refundTime - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const maxTime = new Date(refundTime + forwardGraceHours * 60 * 60 * 1000).toISOString();

    const candidates = await db.all(
        `SELECT p.*,
                COALESCE((SELECT SUM(amountMinor) FROM refund_pairings rp WHERE rp.purchaseTransactionId = p.id), 0) AS totalRefundedMinor
         FROM transactions p
         WHERE p.userId = ?
           AND p.Category = 'Expense'
           AND p.id != ?
           AND p.Timestamp >= ?
           AND p.Timestamp <= ?
         ORDER BY p.Timestamp DESC`,
        [userId, refund.id, minTime, maxTime]
    );

    const refundMinor = Number(refund.AmountMinor);
    if (!Number.isSafeInteger(refundMinor) || refundMinor <= 0) return null;
    const refundMerchant = normalizeMerchantName(refund.Reason);

    let bestCandidate = null;
    let highestScore = -1;
    let ambiguous = false;

    for (const candidate of candidates) {
        if (!areAccountsCompatible(candidate, refund)) continue;
        if (String(candidate.Currency || 'CAD').toUpperCase() !== String(refund.Currency || 'CAD').toUpperCase()) continue;

        const availableMinor = candidate.AmountMinor - candidate.totalRefundedMinor;
        if (availableMinor < refundMinor) {
            // Not enough unrefunded balance
            continue;
        }

        let score = 0;
        const candidateMerchant = normalizeMerchantName(candidate.Reason);

        // 1. Amount match scoring
        const isExactAmount = candidate.AmountMinor === refundMinor;
        if (isExactAmount) {
            score += 50;
        } else if (availableMinor >= refundMinor) {
            score += 20; // Partial refund of larger purchase
        }

        // 2. Merchant match scoring
        if (refundMerchant && candidateMerchant) {
            if (refundMerchant === candidateMerchant) {
                score += 50;
            } else if (refundMerchant.includes(candidateMerchant) || candidateMerchant.includes(refundMerchant)) {
                score += 35;
            }
        } else continue;
        if (!refundMerchant || !candidateMerchant ||
            !(refundMerchant === candidateMerchant || refundMerchant.includes(candidateMerchant) || candidateMerchant.includes(refundMerchant))) continue;

        // 3. Temporal proximity scoring (closer in time is better)
        const pTime = new Date(candidate.Timestamp).getTime();
        const diffHours = Math.abs(refundTime - pTime) / (1000 * 60 * 60);
        if (diffHours <= 2) score += 20;
        else if (diffHours <= 24) score += 15;
        else if (diffHours <= 7 * 24) score += 10;
        else if (diffHours <= 30 * 24) score += 5;

        // Threshold of 70 ensures high confidence (e.g. exact amount + exact merchant = 100+)
        if (score >= 70 && score > highestScore) {
            ambiguous = false;
            highestScore = score;
            bestCandidate = {
                purchase: candidate,
                matchType: isExactAmount ? 'EXACT_AMOUNT' : 'PARTIAL_AMOUNT',
                confidence: score >= 90 ? 'HIGH' : 'MEDIUM',
                score,
            };
        } else if (score >= 70 && score === highestScore) {
            ambiguous = true;
        }
    }

    return ambiguous ? null : bestCandidate;
}

/**
 * Automatically pairs a refund transaction with its original purchase.
 */
async function pairRefundTransaction(db, userId, refund, options = {}) {
    if (!isRefundTransaction(refund)) return null;

    return db.withTransaction(async () => {
    // Check if already paired
    const existing = await db.get(
        'SELECT * FROM refund_pairings WHERE refundTransactionId = ?',
        [refund.id]
    );
    if (existing) return { status: 'already_paired', pairingId: existing.id };

    const match = await findPurchaseCandidateForRefund(db, userId, refund, options);
    if (!match) return { status: 'unmatched' };

    const { purchase, matchType, confidence } = match;
    const now = new Date().toISOString();

    let pairingId = null;
        const result = await db.run(
            `INSERT INTO refund_pairings
                (userId, refundTransactionId, purchaseTransactionId, amountMinor, matchType, confidence, pairedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, refund.id, purchase.id, refund.AmountMinor, matchType, confidence, now]
        );
        pairingId = result.lastID;

        // Establish linked reference number if refund doesn't have an external reference
        const refundRef = String(refund.ReferenceNumber || '').trim();
        const sharedRef = `REFUND-${purchase.id}-${refund.id}`;
        if (!refundRef || !refundRef.startsWith('REFUND-')) {
            await db.run(
                'UPDATE transactions SET ReferenceNumber = ? WHERE id = ? AND userId = ?',
                [refundRef || sharedRef, refund.id, userId]
            );
        }

        // Keep monthly summaries up to date
        await refreshTransactionMonths(db, [purchase, refund]);

    return {
        status: 'paired',
        pairingId,
        refundId: refund.id,
        purchaseId: purchase.id,
        amountMinor: refund.AmountMinor,
        matchType,
        confidence,
    };
    });
}

/**
 * Reconciles and pairs all unpaired historical refunds.
 */
async function reconcileRefundPairings(db, userId = null, options = {}) {
    const params = [];
    let query = `
        SELECT r.*
        FROM transactions r
        LEFT JOIN refund_pairings rp ON rp.refundTransactionId = r.id
        WHERE rp.id IS NULL
          AND r.Category = 'Income'
          AND (r.Label = 'Refunds & Reversals' OR r.Reason LIKE '%refund%' OR r.Reason LIKE '%reversal%' OR r.Reason LIKE '%discount%' OR r.Reason LIKE '%rebate%')
    `;
    if (userId) {
        query += ' AND r.userId = ?';
        params.push(userId);
    }
    query += ' ORDER BY r.Timestamp ASC';

    const unpairedRefunds = await db.all(query, params);
    const pairings = [];

    for (const refund of unpairedRefunds) {
        const result = await pairRefundTransaction(db, refund.userId, refund, options);
        if (result && result.status === 'paired') {
            pairings.push(result);
        }
    }

    return {
        scannedCount: unpairedRefunds.length,
        pairedCount: pairings.length,
        pairings,
    };
}

/**
 * Retrieves the pairing information for a given transaction (either purchase or refund).
 */
async function getRefundPairingForTransaction(db, userId, transactionId) {
    return await db.get(
        `SELECT rp.*,
                p.Reason AS purchaseReason, p.Amount AS purchaseAmount, p.Timestamp AS purchaseTimestamp,
                r.Reason AS refundReason, r.Amount AS refundAmount, r.Timestamp AS refundTimestamp
         FROM refund_pairings rp
         JOIN transactions p ON p.id = rp.purchaseTransactionId
         JOIN transactions r ON r.id = rp.refundTransactionId
         WHERE rp.userId = ? AND (rp.purchaseTransactionId = ? OR rp.refundTransactionId = ?)`,
        [userId, transactionId, transactionId]
    );
}

/**
 * Handles pairing for any newly ingested transaction (whether it is a refund or an expense).
 */
async function pairTransactionOnIngestion(db, userId, transaction, options = {}) {
    if (!transaction || !userId) return null;
    if (isRefundTransaction(transaction)) {
        return await pairRefundTransaction(db, userId, transaction, options);
    }
    if (transaction.Category === 'Expense') {
        // Look for any unpaired refund that could match this newly added expense
        const refundTimeWindow = new Date(new Date(transaction.Timestamp || new Date()).getTime() - 24 * 60 * 60 * 1000).toISOString();
        const unpairedRefunds = await db.all(
            `SELECT r.* FROM transactions r
             LEFT JOIN refund_pairings rp ON rp.refundTransactionId = r.id
             WHERE rp.id IS NULL
               AND r.userId = ?
               AND r.Category = 'Income'
               AND (r.Label = 'Refunds & Reversals' OR r.Reason LIKE '%refund%' OR r.Reason LIKE '%reversal%' OR r.Reason LIKE '%discount%' OR r.Reason LIKE '%rebate%' OR r.AccountFlow = 'IN')
               AND r.Timestamp >= ?
             ORDER BY r.Timestamp ASC`,
            [userId, refundTimeWindow]
        );
        for (const refund of unpairedRefunds) {
            const res = await pairRefundTransaction(db, userId, refund, options);
            if (res && res.status === 'paired') {
                return res;
            }
        }
    }
    return null;
}

module.exports = {
    normalizeMerchantName,
    isRefundTransaction,
    findPurchaseCandidateForRefund,
    pairRefundTransaction,
    pairTransactionOnIngestion,
    reconcileRefundPairings,
    getRefundPairingForTransaction,
};
