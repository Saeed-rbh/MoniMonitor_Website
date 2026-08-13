const { accountMatchScore } = require('./accountMatching');

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

function getAccountReference(transaction = {}) {
    const reference = String(transaction.PortfolioAccountNumber || transaction.Account || '').trim();
    return reference && normalizeIdentity(reference) ? reference : null;
}

function inferAccountType(transaction = {}) {
    const identity = normalizeIdentity([
        transaction.Type,
        transaction.Account,
        transaction.PortfolioAccountNumber,
        transaction.Label,
        transaction.Reason,
    ].filter(Boolean).join(' '));

    if (/credit|visa|mastercard|amex/.test(identity)) return 'Credit Card';
    if (identity.includes('tfsa')) return 'TFSA';
    if (identity.includes('rrsp')) return 'RRSP';
    if (identity.includes('401k')) return '401(k)';
    if (/(^|[^a-z])ira([^a-z]|$)/.test(String(transaction.Type || '').toLowerCase())) return 'IRA';
    if (/crypto|bitcoin|ethereum/.test(identity)) return 'Crypto';
    if (/broker|trading|investment/.test(identity) || ['BUY', 'SELL', 'STAKE', 'UNSTAKE', 'SWAP'].includes(transaction.PortfolioAction)) {
        return 'Brokerage';
    }
    if (/chequ|check/.test(identity)) return 'Chequing';
    if (/saving/.test(identity)) return 'Savings';
    return 'Other';
}

function compactInstitution(value) {
    const normalized = normalizeBank(value);
    if (normalized === 'rbc') return 'RBC';
    if (normalized === 'cibc') return 'CIBC';
    if (normalized === 'wealthsimple') return 'Wealthsimple';
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function maskedSuffix(reference) {
    const digits = String(reference || '').replace(/\D/g, '');
    return digits.length >= 4 ? ` •${digits.slice(-4)}` : '';
}

function buildAccountName(transaction, accountType, reference) {
    const institution = compactInstitution(transaction.BankName);
    const prefix = institution || 'New';
    const normalizedReference = normalizeIdentity(reference);
    const suffix = normalizedReference === normalizeIdentity(accountType) ? '' : maskedSuffix(reference);
    return `${prefix} ${accountType}${suffix}`.trim().slice(0, 120);
}

function resolveAccountCandidate(transaction, accounts = [], preferredAccountId = null, preferredConfidence = null) {
    if (preferredConfidence === 'HIGH' && preferredAccountId !== null && preferredAccountId !== undefined) {
        const preferred = accounts.find((account) => Number(account.id) === Number(preferredAccountId));
        if (preferred) return { account: preferred, confidence: 'HIGH', reason: 'explicit_id' };
    }

    const ranked = accounts
        .map((account) => ({ account, score: accountMatchScore(transaction, account, null, null) }))
        .sort((left, right) => right.score - left.score);
    if (ranked[0]?.score >= 80 && (!ranked[1] || ranked[0].score > ranked[1].score)) {
        return { account: ranked[0].account, confidence: 'HIGH', reason: 'identity_match' };
    }

    const inferredType = inferAccountType(transaction);
    const bank = normalizeBank(transaction.BankName);
    const unlinkedCandidates = accounts.filter((account) =>
        !normalizeIdentity(account.accountRef) &&
        bank && normalizeBank(account.institution) === bank &&
        account.accountType === inferredType
    );
    if (unlinkedCandidates.length === 1) {
        return { account: unlinkedCandidates[0], confidence: 'HIGH', reason: 'unique_unlinked_match' };
    }

    return null;
}

function describeDiscoveredAccount(transaction = {}) {
    const accountRef = getAccountReference(transaction);
    if (!accountRef) return null;
    const accountType = inferAccountType(transaction);
    return {
        name: buildAccountName(transaction, accountType, accountRef),
        institution: compactInstitution(transaction.BankName) || null,
        accountType,
        accountRef,
    };
}

module.exports = {
    buildAccountName,
    describeDiscoveredAccount,
    getAccountReference,
    inferAccountType,
    resolveAccountCandidate,
};
