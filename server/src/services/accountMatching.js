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

function normalizeAccountType(value) {
    const normalized = normalizeIdentity(value);
    if (normalized.includes('credit') || normalized.includes('visa') || normalized.includes('mastercard')) return 'creditcard';
    if (normalized.includes('chequ') || normalized.includes('check')) return 'chequing';
    if (normalized.includes('saving')) return 'savings';
    if (normalized.includes('tfsa')) return 'tfsa';
    return normalized;
}

function accountMatchScore(transaction, account, preferredAccountId, preferredConfidence) {
    if (preferredConfidence === 'HIGH' && Number(preferredAccountId) === Number(account.id)) return 1000;

    let score = 0;
    const transactionRef = normalizeIdentity(transaction.Account);
    const accountRef = normalizeIdentity(account.accountRef);
    const accountName = normalizeIdentity(account.name);
    const transactionDigits = String(transaction.Account || '').replace(/\D/g, '');
    const accountDigits = String(account.accountRef || '').replace(/\D/g, '');

    if (transactionRef && accountRef && transactionRef === accountRef) score += 120;
    else if (transactionDigits.length >= 4 && accountDigits.length >= 4 &&
        transactionDigits.slice(-4) === accountDigits.slice(-4)) score += 100;
    else if (transactionRef && accountName &&
        (transactionRef.includes(accountName) || accountName.includes(transactionRef))) score += 80;

    if (transaction.BankName && normalizeBank(transaction.BankName) === normalizeBank(account.institution)) score += 30;
    if (transaction.Type && normalizeAccountType(transaction.Type) === normalizeAccountType(account.accountType)) score += 20;
    return score;
}

function transactionBalanceDelta(transaction, account, amountMinor) {
    const isCreditCard = account.accountType === 'Credit Card';
    const accountFlow = String(transaction.AccountFlow || '').toUpperCase();
    if (accountFlow === 'IN') return isCreditCard ? -amountMinor : amountMinor;
    if (accountFlow === 'OUT') return isCreditCard ? amountMinor : -amountMinor;
    if (accountFlow === 'NONE') return null;
    if (transaction.Category === 'Expense') return isCreditCard ? amountMinor : -amountMinor;
    if (transaction.Category === 'Income') return isCreditCard ? -amountMinor : amountMinor;
    if (transaction.Category === 'Saving' && transaction.Label === 'Debt Payment') return -amountMinor;
    return null;
}

module.exports = { accountMatchScore, transactionBalanceDelta };
