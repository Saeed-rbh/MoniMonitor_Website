function normalizeIdentity(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getUsernameParts(username) {
    const normalizedUsername = normalizeIdentity(username);
    return {
        normalizedUsername,
        // Bank descriptions often shorten a username to the given-name part
        // (for example, "saeed@wealthsimple"). Keep this conservative: a
        // minimum of four characters is required before using the prefix.
        usernamePrefix: normalizedUsername.length >= 4
            ? normalizedUsername.slice(0, Math.min(5, normalizedUsername.length))
            : '',
    };
}

/**
 * Detect an e-transfer whose description names the authenticated account
 * owner. This deliberately requires transfer language plus either the full
 * username, an email local-part matching the username prefix, or a short
 * owner-name token in an Interac description.
 */
function isExplicitSelfTransferDescription(reason, username) {
    const text = String(reason || '').trim();
    if (!text || !/(?:e[\s-]?transfer|interac|transfer)/i.test(text)) return false;

    const { normalizedUsername, usernamePrefix } = getUsernameParts(username);
    if (!normalizedUsername) return false;

    const normalizedText = normalizeIdentity(text);
    if (normalizedText.includes(normalizedUsername)) return true;

    const localPart = text.match(/\b([a-z0-9][a-z0-9._-]{2,})@/i)?.[1];
    if (localPart && usernamePrefix &&
        normalizeIdentity(localPart).startsWith(usernamePrefix)) {
        return true;
    }

    if (usernamePrefix && /(?:e[\s-]?transfer|interac)/i.test(text)) {
        const ownerToken = new RegExp(`\\b${usernamePrefix}\\b`, 'i');
        if (ownerToken.test(text)) return true;
    }

    return false;
}

function getTransactionDirection(transaction) {
    const flow = String(transaction?.AccountFlow || '').toUpperCase();
    if (flow === 'IN' || flow === 'OUT') return flow;
    if (transaction?.Category === 'Income') return 'IN';
    if (transaction?.Category === 'Expense') return 'OUT';
    return null;
}

module.exports = {
    getTransactionDirection,
    isExplicitSelfTransferDescription,
    normalizeIdentity,
};
