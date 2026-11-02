const normalize = (value) => String(value || '').trim().toLowerCase();

function toMinorUnits(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error('Amount must be a finite number');
    const [mantissa, exponentText = '0'] = String(numeric).toLowerCase().split('e');
    const negative = mantissa.startsWith('-');
    const unsigned = mantissa.replace(/^[+-]/, '');
    const [whole, fraction = ''] = unsigned.split('.');
    const digits = BigInt(whole + fraction);
    const power = Number(exponentText) + 2 - fraction.length;
    const denominator = power < 0 ? 10n ** BigInt(-power) : 1n;
    const numerator = power >= 0 ? digits * 10n ** BigInt(power) : digits;
    const rounded = (numerator + denominator / 2n) / denominator;
    const result = Number(negative ? -rounded : rounded);
    if (!Number.isSafeInteger(result)) throw new Error('Amount exceeds safe integer cents');
    return result;
}

function amountMinorOf(transaction = {}) {
    if (Number.isSafeInteger(transaction.AmountMinor)) return Math.max(0, transaction.AmountMinor);
    try { return Math.max(0, toMinorUnits(transaction.Amount ?? 0)); }
    catch { return 0; }
}

function isInternalTransfer(transaction = {}) {
    return ['internal', 'transfer'].includes(normalize(transaction.Category)) ||
        normalize(transaction.Label) === 'internal transfer' || /^internal transfer:/i.test(String(transaction.Reason || '').trim());
}

function isRefundMarker(transaction = {}) {
    return ['refunds & reversals', 'refund', 'reversal', 'chargeback'].includes(normalize(transaction.Label)) ||
        ['refund', 'reversal', 'chargeback'].includes(normalize(transaction.Type)) ||
        /^(refund|reversal|chargeback)\b/i.test(String(transaction.Reason || '').trim());
}

function isPosted(transaction = {}) {
    return !transaction.PostingStatus || transaction.PostingStatus === 'posted';
}

function isInvestmentCashIncome(transaction = {}) {
    return isPosted(transaction) && !isInternalTransfer(transaction) &&
        normalize(transaction.Category) === 'investment' &&
        ['interest', 'dividend'].includes(normalize(transaction.PortfolioAction)) &&
        normalize(transaction.AccountFlow) === 'in' && amountMinorOf(transaction) > 0;
}

function isInvestmentActivity(transaction = {}) {
    if (!isPosted(transaction) || isInternalTransfer(transaction) || isIncome(transaction)) return false;
    const category = normalize(transaction.Category), action = normalize(transaction.PortfolioAction);
    // Funding idle account cash is a principal movement, not stock/crypto activity.
    if (['deposit','contribution','withdrawal','interest','dividend'].includes(action)) return false;
    if (action === 'transfer' && normalize(transaction.AccountFlow) !== 'none') return false;
    if (category === 'investment') return true;
    // Preserve access to older explicitly labelled asset purchases without including cash savings.
    return ['saving','save&invest'].includes(category) &&
        ['stocks','etfs','crypto','cryptocurrency','etf & stock purchase','etf & stock sale','crypto purchase','crypto sale','crypto swap','crypto staking'].includes(normalize(transaction.Label));
}

function investmentActivityMinor(transaction = {}) {
    return isInvestmentActivity(transaction) ? amountMinorOf(transaction) : 0;
}

function matchesReportingCategory(transaction = {}, category) {
    return category === 'Income' ? isIncome(transaction) : ['Invest','Save&Invest'].includes(category) ? isInvestmentActivity(transaction) : transaction.Category === category;
}

function isIncome(transaction = {}) {
    if (!isPosted(transaction)) return false;
    if (isInternalTransfer(transaction)) return false;
    const category = normalize(transaction.Category);
    if (category) return category === 'income' || isInvestmentCashIncome(transaction);
    return ['income', 'credit'].includes(normalize(transaction.Type)) || transaction.AccountFlow === 'IN';
}

function isExpense(transaction = {}) {
    if (!isPosted(transaction)) return false;
    if (isInternalTransfer(transaction) || isRefundMarker(transaction)) return false;
    const description = String(transaction.Reason || '').trim();
    if (/credit[ -]?card payment/i.test(description)) return false;
    const category = normalize(transaction.Category);
    if (category) return ['expense', 'dining', 'shopping'].includes(category);
    return ['expense', 'debit'].includes(normalize(transaction.Type)) || transaction.AccountFlow === 'OUT';
}

function normalizeAccountName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseInternalTransfer(reason) {
    const match = String(reason || '').match(
        /^Internal transfer:\s*(.*?)\s*->\s*(.*?)(?:\s*\[|$)/i
    );
    return match ? { source: match[1], destination: match[2] } : null;
}

function getSavingEffectMinor(transaction) {
    if (!isPosted(transaction)) return 0;
    const amountMinor = amountMinorOf(transaction);
    if (['income', 'expense'].includes(normalize(transaction?.Category))) return 0;

    if (transaction?.Category === 'SavingWithdrawal') return -amountMinor;

    const label = String(transaction?.Label || '').toLowerCase();
    if (['savings contributions', 'crypto funding'].includes(label)) return amountMinor;
    if (label === 'tfsa withdrawal') return -amountMinor;
    if (label === 'tfsa contribution') return amountMinor;

    const account = normalizeAccountName(transaction?.Account);
    if (transaction?.Category === 'Investment' &&
        transaction?.PortfolioAction === 'WITHDRAWAL' && account.includes('tfsa')) {
        return -amountMinor;
    }

    if (!['Saving', 'Save&Invest'].includes(transaction?.Category)) return 0;

    const transfer = parseInternalTransfer(transaction?.Reason);
    if (!transfer) return 0;

    if (!account.includes('tfsa')) return 0;

    const source = normalizeAccountName(transfer.source);
    const destination = normalizeAccountName(transfer.destination);
    if (source.includes('tfsa') && destination.includes('tfsa')) return 0;
    if (destination.includes('tfsa')) return amountMinor;
    if (source.includes('tfsa')) return -amountMinor;
    return 0;
}

module.exports = { isInvestmentActivity, investmentActivityMinor, isInvestmentCashIncome, matchesReportingCategory, isPosted, getSavingEffectMinor, parseInternalTransfer, toMinorUnits, amountMinorOf, isIncome, isExpense, isInternalTransfer };
