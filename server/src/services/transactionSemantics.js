function isCreditCardPayment(transaction = {}) {
    const reason = String(transaction.Reason || '').trim();
    const type = String(transaction.Type || '').trim();
    const isCreditCardAccount = /\bcredit[\s-]?card\b/i.test(type);
    const isPayment = /\b(?:credit[\s-]?card|card)\s+payment\b|\bpayment\s+(?:received|posted)\b/i.test(reason);
    return isCreditCardAccount && isPayment;
}

function isOutgoingEmailTransfer(transaction = {}) {
    const reason = String(transaction.Reason || '').trim();
    const type = String(transaction.Type || '').trim();
    const isTransfer = /\b(?:e[\s-]?transfer|interac)\b/i.test(`${reason} ${type}`);
    const isExplicitlyOutgoing = transaction.AccountFlow === 'OUT' || transaction.Category === 'Expense';
    const hasOutgoingLanguage = /\b(?:sent|withdrawal|transfer\s+out)\b/i.test(reason);
    return isTransfer && isExplicitlyOutgoing && hasOutgoingLanguage;
}

/**
 * Correct provider/AI direction semantics before account balance posting.
 * A payment received by a credit-card account reduces its debt, so it is an
 * inflow to that account even though the funding chequing account has an outflow.
 */
function normalizeTransactionSemantics(transaction = {}) {
    if (!isCreditCardPayment(transaction)) return transaction;
    return {
        ...transaction,
        Category: 'Internal',
        Label: 'Internal Transfer',
        AccountFlow: 'IN',
    };
}

module.exports = {
    isCreditCardPayment,
    isOutgoingEmailTransfer,
    normalizeTransactionSemantics,
};
