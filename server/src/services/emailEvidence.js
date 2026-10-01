const { accountMatchScore } = require('./accountMatching');
const { getAccountReference, inferAccountType } = require('./accountDiscovery');

// Read explicit event times from the source rather than asking a model to
// convert a named timezone. Receipt time remains separate for forwarded mail.
function sourceEventTimestamp(body = '') {
    const text = String(body).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
    const match = text.match(/Time:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(EDT|EST|UTC|GMT)/i);
    if (!match) return null;
    const offset = { EDT: '-04:00', EST: '-05:00', UTC: '+00:00', GMT: '+00:00' }[match[3].toUpperCase()];
    const date = new Date(`${match[1]} ${match[2]} ${offset}`);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeEmailEvidence(transaction, body, accounts) {
    const result = { ...transaction };
    if (result.Category === 'Income' && !result.PortfolioAction &&
        /From:[^\n]*rbcroyalbankalerts@alerts\.rbc\.com/i.test(String(body)) &&
        /Subject:\s*(?:Fw:\s*)?Deposit Notice\s*(?:\r?\n|$)/i.test(String(body)) &&
        !result.ReferenceNumber) {
        result.Label = 'Cash & Cheque Deposits';
        result.Reason = `Deposit to RBC Royal Bank Checking Account ${result.Account || ''}`.trim();
        result.Type = 'Checking Account';
        result.AccountFlow = 'IN';
    }
    const eventTime = sourceEventTimestamp(body);
    if (eventTime) result.Timestamp = eventTime;
    const accountType = String(body).match(/\bAccount:\s*(TFSA|RRSP|Brokerage)\b/i)?.[1];
    if (accountType && result.PortfolioAction) {
        result.Type = accountType.toUpperCase();
        if (!getAccountReference(result)) result.PortfolioAccountNumber = result.Type;
    }
    // Transfer emails can identify a portfolio destination while the balance
    // belongs to the source account. Do not conflate those two legs.
    if (result.Category === 'Internal' || !['BUY', 'SELL', 'DIVIDEND', 'INTEREST',
        'FEE', 'TAX', 'REIMBURSEMENT', 'REWARD'].includes(result.PortfolioAction)) return result;
    const reference = getAccountReference(result);
    const compatible = accounts.filter(a =>
        String(a.currency || 'CAD').toUpperCase() === String(result.Currency || 'CAD').toUpperCase() &&
        (!result.BankName || accountMatchScore({ BankName: result.BankName }, a) > 0) &&
        a.accountType === inferAccountType(result));
    const ranked = compatible.map(account => ({ account,
        score: accountMatchScore({ ...result, Account: reference }, account, null, null) }))
        .sort((a, b) => b.score - a.score);
    const explicit = reference && ranked[0]?.score >= 80 && ranked[0].score > (ranked[1]?.score || 0);
    const resolved = explicit ? ranked[0].account : compatible.length === 1 ? compatible[0] : null;
    if (resolved) {
        result.PortfolioAccountId = resolved.id;
        result.BalanceAccountId = resolved.id;
        result.PortfolioConfidence = result.BalanceAccountConfidence = 'HIGH';
    } else {
        result.PortfolioAccountId = result.BalanceAccountId = null;
        result.PortfolioConfidence = result.BalanceAccountConfidence = 'LOW';
        result.IngestionReviewReason = 'ambiguous_account';
    }
    return result;
}

function emailNotificationKind(body, transaction = {}) {
    if (/From:[^\n]*rbcroyalbankalerts@alerts\.rbc\.com/i.test(String(body)) &&
        /Subject:\s*(?:Fw:\s*)?Deposit Notice\s*(?:\r?\n|$)/i.test(String(body))) return 'deposit_notice';
    if (/Subject:[^\n]*Interac e-Transfer/i.test(String(body)) &&
        /automatically deposited|Funds Deposited/i.test(String(body))) return 'interac_deposit';
    return null;
}

module.exports = { sourceEventTimestamp, normalizeEmailEvidence, emailNotificationKind };
