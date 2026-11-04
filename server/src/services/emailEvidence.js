const { accountMatchScore } = require('./accountMatching');
const identity = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function financialText(body) {
    return String(body || '').replace(/https?:\/\/\S+/g, '').replace(/<[^>]*>/g, ' ')
        .replace(/&[^;]+;/g, ' ').replace(/[\u034f\u200b-\u200f]/g, '');
}
function field(text, name) {
    return text.match(new RegExp(`^${name}:\\s*([^\\n]+)`, 'im'))?.[1]?.trim() || null;
}
function resolveAccount(label, institution, accounts, aliases = []) {
    if (!label) return null;
    const bank = identity(institution);
    const eligible = accounts.filter(a => identity(a.institution).includes(bank));
    // Only explicit, reviewed mappings may disambiguate a repeated name such as TFSA.
    const mapped = aliases.filter(a => identity(a.institution) === bank && identity(a.label) === identity(label));
    const ids = [...new Set(mapped.map(a => Number(a.accountId)))];
    if (ids.length === 1) return eligible.find(a => a.id === ids[0]) || null;
    const ref = identity(label.replace(/\b(?:CAD|USD)\b/gi, '').replace(/(CAD|USD)$/i, ''));
    const baseLabel = identity(label.replace(/\([^)]*\)/g, ''));
    const candidates = eligible.filter(a => {
        const ar = identity(a.accountRef);
        const suffix = label.replace(/(CAD|USD)\)?$/i, '').match(/[*•]{2,}([a-z0-9]{3,})/i)?.[1];
        return (ar && ref === ar) || (suffix && ar.endsWith(identity(suffix))) ||
            identity(a.name) === identity(label) || identity(a.accountType) === identity(label) ||
            identity(a.name).startsWith(identity(label) + 'chequing') ||
            (baseLabel.length >= 4 && !['tfsa','rrsp','savings','chequing'].includes(baseLabel) && identity(a.name).includes(baseLabel));
    });
    return candidates.length === 1 ? candidates[0] : null;
}
function sourceTimestamp(text) {
    const m = text.match(/Time:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(AM|PM)?\s*,?\s*(EDT|EST|UTC|GMT)/i);
    if (!m) return null;
    const d = new Date(`${m[1]} ${m[2]} ${m[3] || ''} ${{EDT:'-0400',EST:'-0500',UTC:'+0000',GMT:'+0000'}[m[4].toUpperCase()]}`);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function normalizeEmailEvidence(transaction, body, accounts = [], aliases = []) {
    const result = { ...transaction, PostingStatus: 'posted' };
    const text = financialText(body);
    const subject = field(text, 'Subject') || '';
    const ws = /From:[^\n]*<notifications@o\.wealthsimple\.com>/i.test(body);
    const rbc = /From:[^\n]*<rbcroyalbankalerts@alerts\.rbc\.com>/i.test(body);
    result.NotificationKind = rbc && /Deposit Notice/i.test(subject) ? 'bank_deposit' :
        rbc && /Withdrawal Warning/i.test(subject) ? 'bank_withdrawal' :
        /Interac e-Transfer:/i.test(subject) && /@payments\.interac\.ca/i.test(body) ? 'interac' : null;
    if (rbc) {
        const account = field(text, 'Account');
        if (account) {
            result.Account = account;
            result.BankName = 'RBC Royal Bank';
            const matches = accounts.filter(a => /rbc|royalbank/.test(identity(a.institution)) &&
                accountMatchScore({ ...result, Account: account }, a) >= 80);
            result.BalanceAccountId = matches.length === 1 ? matches[0].id : null;
            result.BalanceAccountConfidence = matches.length === 1 ? 'HIGH' : 'LOW';
            if (matches.length !== 1) result.IngestionReviewReason = 'RBC account identity is ambiguous';
        }
        if (/refund|credit (?:was|has been)|credited to your (?:credit card|card)/i.test(text)) {
            result.Category = 'Income'; result.Label = 'Other Income'; result.PortfolioAction = null;
        }
    }
    if (ws) {
        result.BankName = 'Wealthsimple';
        const label = field(text, 'Account');
        const account = resolveAccount(label, 'Wealthsimple', accounts, aliases);
        if (label) {
            // Explicit source account evidence replaces a model's unrelated account guess.
            result.Account = account?.accountRef || label;
            result.PortfolioAccountId = result.BalanceAccountId = account?.id || null;
            result.PortfolioConfidence = result.BalanceAccountConfidence = account ? 'HIGH' : 'LOW';
            if (account) result.IngestionReviewReason = null;
        }
        if (!label && /^Direct deposit received$/i.test(subject)) {
            const direct = resolveAccount(subject, 'Wealthsimple', accounts, aliases);
            if (direct) {
                result.Account = direct.accountRef; result.BalanceAccountId = direct.id;
                result.BalanceAccountConfidence = 'HIGH'; result.Currency = direct.currency;
                result.IngestionReviewReason = null;
            }
        }
        const amount = field(text, '(?:Total cost|Total value|Amount)')?.match(/([\d,]+\.\d{2})/);
        if (amount) result.Amount = amount[1].replace(/,/g, '');
        const currencies = [...new Set([...text.matchAll(/\b(CAD|USD|EUR|GBP)\b/gi)].map(m => m[1].toUpperCase()))];
        if (currencies.length === 1) result.Currency = currencies[0];
        else if (account) result.Currency = account.currency;
        if (/^Your order has been filled$/i.test(subject)) {
            const type = field(text, 'Type');
            const action = /\bbuy\b/i.test(type || '') ? 'BUY' : /\bsell\b/i.test(type || '') ? 'SELL' : null;
            result.PortfolioAction = action;
            result.PortfolioSymbol = field(text, '(?:Symbol|Cryptocurrency)');
            result.PortfolioQuantity = Number(field(text, '(?:Shares|Quantity)')) || null;
            result.PortfolioPrice = Number((field(text, '(?:Average price|Filled price)') || '').replace(/[$,]/g, '')) || null;
            result.IngestionReviewReason = !action ? 'Unrecognized filled-order direction' : null;
        } else if (/crypto from another wallet|crypto (?:sent|received)|sent crypto/i.test(subject)) {
            const inbound = /receiv/i.test(subject);
            result.PortfolioAction = inbound ? 'ASSET_TRANSFER_IN' : 'ASSET_TRANSFER_OUT';
            result.PortfolioSymbol = field(text, '(?:Symbol|Cryptocurrency)');
            const units = text.match(/(?:rec[ei]+ved|sent)\s+([\d.]+)\s+([A-Z]{2,10})\b/i);
            result.PortfolioQuantity = units ? Number(units[1]) : null;
            result.PortfolioPrice = null;
            // The displayed dollar value is an asset valuation, never cash deposited.
            result.Amount = '0';
        } else if (/^You earned a dividend$/i.test(subject)) {
            result.PortfolioAction = 'DIVIDEND';
        } else if (/^You made a transfer$/i.test(subject)) {
            const fromLabel = [...text.matchAll(/^From:\s*([^\n]+)/gim)].map(m => m[1].trim()).filter(x => !x.includes('@')).at(-1);
            const toLabel = [...text.matchAll(/^To:\s*([^\n]+)/gim)].map(m => m[1].trim()).filter(x => !x.includes('@')).at(-1);
            const from = resolveAccount(fromLabel, 'Wealthsimple', accounts, aliases);
            const to = resolveAccount(toLabel, 'Wealthsimple', accounts, aliases);
            result.PortfolioAction = 'TRANSFER';
            result.TransferFromAccountId = from?.id || null;
            result.TransferToAccountId = to?.id || null;
            result.TransferConfidence = from && to && from.id !== to.id ? 'HIGH' : 'LOW';
        } else if (/order.*(?:placed|cancelled|rejected|pending)/i.test(subject)) {
            return { error: 'Unexecuted order; no financial posting' };
        }
        const time = sourceTimestamp(text);
        if (time) result.Timestamp = time;
    }
    if (!result.Currency) {
        const matches = accounts.filter(a => accountMatchScore(result, a) >= 80);
        if (matches.length === 1) result.Currency = matches[0].currency;
        else {
            const bankKey = value => /rbc|royalbank/.test(identity(value)) ? 'rbc' : identity(value);
            const currencies = [...new Set(accounts.filter(a => bankKey(a.institution) === bankKey(result.BankName)).map(a => a.currency))];
            if (currencies.length === 1) result.Currency = currencies[0];
        }
        if (!result.Currency) result.IngestionReviewReason = 'Unconfirmed transaction currency';
    }
    if (result.PortfolioAction) {
        result.Category = 'Saving';
        result.Label = ['BUY','SELL','CONTRIBUTION','DIVIDEND','ASSET_TRANSFER_IN','ASSET_TRANSFER_OUT'].includes(result.PortfolioAction) ? 'Investment' : 'Savings';
    }
    return result;
}
function parseStructuredEmail(body, accounts, aliases, receivedAt) {
    if (!/From:[^\n]*<notifications@o\.wealthsimple\.com>/i.test(body)) return null;
    const subject = field(financialText(body), 'Subject') || '';
    if (!/^(?:Your order has been filled|You earned a dividend|You made a transfer|Direct deposit received|You[’']ve received crypto from another wallet!|Your order has been (?:cancelled|placed|rejected|pending))$/i.test(subject)) return null;
    const result = normalizeEmailEvidence({
        Amount: '0', Currency: null, Category: /^Direct deposit received$/i.test(subject) ? 'Income' : 'Saving',
        Label: /^Direct deposit received$/i.test(subject) ? 'Bank Deposit' : 'Investment',
        Reason: subject, Timestamp: receivedAt, Type: 'Investment', Account: null, BankName: 'Wealthsimple',
        PortfolioAction: null, PortfolioAccountId: null, BalanceAccountId: null,
    }, body, accounts, aliases);
    if (result.error) return result;
    if (!result.PortfolioAction?.startsWith('ASSET_TRANSFER') && !(Number(result.Amount) > 0)) {
        result.IngestionReviewReason = 'Structured email lacks an explicit positive cash amount';
    }
    return result;
}
module.exports = { normalizeEmailEvidence, parseStructuredEmail, resolveAccount, sourceTimestamp };
