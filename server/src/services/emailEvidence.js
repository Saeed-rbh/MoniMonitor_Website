const { accountMatchScore } = require('./accountMatching');
const { getAccountReference, inferAccountType } = require('./accountDiscovery');

// Read explicit event times from the source rather than asking a model to
// convert a named timezone. Receipt time remains separate for forwarded mail.
function sourceEventTimestamp(body = '') {
    const text = String(body).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
    const match = text.match(/Time:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:(AM|PM)\s*,?\s*)?(EDT|EST|UTC|GMT)/i);
    if (!match) return null;
    const offset = { EDT: '-04:00', EST: '-05:00', UTC: '+00:00', GMT: '+00:00' }[match[4].toUpperCase()];
    const parts=match[2].split(':').map(Number);
    if(parts[0]>(match[3]?12:23)||parts[1]>59||(parts[2]||0)>59||match[3]&&parts[0]<1)return null;
    if(match[3])parts[0]=parts[0]%12+(match[3].toUpperCase()==='PM'?12:0);
    const clock=parts.map(n=>String(n).padStart(2,'0')).join(':');
    const date = new Date(`${match[1]} ${clock} ${offset}`);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeEmailEvidence(transaction, body, accounts = []) {
    const result = { ...transaction };
    const text = String(body || '');
    const sourceText=text.replace(/https?:\/\/\S+/g,'').replace(/<[^>]*>/g,' ');
    const canadianAmount=/\bCA\$/.test(sourceText);
    if (!result.Currency && canadianAmount) result.Currency='CAD';
    if(/wealthsimple/i.test(result.BankName||'')&&/Subject:\s*You earned a dividend/im.test(sourceText)) {
        result.Category='Investment';result.Label='Dividends';result.PortfolioAction='DIVIDEND';result.AccountFlow='IN';
    }
    if(/rbc|royal bank/i.test(result.BankName||'')&&/From:[^\n]*catch@payments\.interac\.ca/i.test(text)&&
        /you sent|your transfer to/i.test(sourceText)&&!result.Account){
        const candidates=accounts.filter(a=>/rbc|royal bank/i.test(a.institution||'')&&a.accountType==='Chequing');
        if(candidates.length===1){result.Account=candidates[0].accountRef;result.BalanceAccountId=candidates[0].id;result.BalanceAccountConfidence='HIGH';result.AccountFlow='OUT';}
    }
    // Read both explicit endpoints. The amount belongs to the identified leg,
    // rather than the direction guessed by the model for the other endpoint.
    if (/wealthsimple/i.test(result.BankName||'') && /Subject:\s*You made a transfer/im.test(sourceText)) {
        // Ignore mail headers; only the transfer detail block is account proof.
        const details=sourceText.match(/Amount:\s*\$[\d,.]+\s*(?:CAD|USD)?\s*\nFrom:\s*([^\n]+)\nTo:\s*([^\n]+)/i) || sourceText.match(/Amount:\s*\$[\d,.]+\s*(?:CAD|USD)?\s+From:\s*(.+?)\s+To:\s*(.+?)(?=\s+(?:Track the|View activity|Learn more)|$)/i);
        if(details){
            const resolve=label=>{
                const words=label.replace(/\([^)]*\)/g,'').trim().toLowerCase();
                const ref=label.match(/[*•]+([A-Z0-9]{3,})(?:\))/i)?.[1]?.replace(/CAD$|USD$/i,'');
                const candidates=accounts.filter(a=>/wealthsimple/i.test(a.institution||'')&&
                    (ref?String(a.accountRef).toUpperCase().endsWith(ref.toUpperCase()):words&&String(a.name).toLowerCase().includes(words)));
                return candidates.length===1?candidates[0]:null;
            };
            const destination=resolve(details[2]);
            const origin=resolve(details[1]);
            if(destination){
                result.Category='Internal';result.Label='Internal Transfer';result.PortfolioAction='TRANSFER';
                result.AccountFlow='IN';result.Account=destination.accountRef;result.PortfolioAccountNumber=destination.accountRef;
                result.BalanceAccountId=result.PortfolioAccountId=destination.id;
                result.BalanceAccountConfidence=result.PortfolioConfidence='HIGH';
                result.Reason=`Internal transfer: ${details[1].trim()} -> ${details[2].trim()}`;
                if(origin&&origin.id!==destination.id&&origin.currency===destination.currency)
                    Object.defineProperty(result,'_internalTransfer',{value:{fromAccountId:origin.id,toAccountId:destination.id}});
            }
        }
    }
    if (/wealthsimple/i.test(result.BankName || '') && /Subject:\s*Direct deposit received/i.test(text)) {
        // These notifications identify chequing, but omit an account number.
        // Random digits in footer/tracking URLs are never account evidence.
        const explicit = text.replace(/https?:\/\/\S+/g,'').match(/(?:account|ending)\s*[:#]?\s*[*•x\s]*(\d{4,})\b/i);
        if(!explicit) {
            result.Account = null; result.PortfolioAccountNumber = null;
            result.BalanceAccountId = null; result.PortfolioAccountId = null;
            result.Type = 'Chequing';
            const candidates=accounts.filter(a=>/wealthsimple/i.test(a.institution || '') && a.accountType==='Chequing' && ['plaid','bank_ui'].includes(a.balanceSource));
            if(candidates.length===1) {
                result.Account=candidates[0].accountRef;result.BalanceAccountId=candidates[0].id;
                result.BalanceAccountConfidence='HIGH';
            } else {result.BalanceAccountConfidence='LOW';result.IngestionReviewReason='ambiguous_account';}
        }
    }
    // A security send is not an executed sale and must never debit cash.
    if (/wealthsimple/i.test(result.BankName || '') &&
        /(?:crypto\s+(?:transfer|send|withdrawal)|(?:sent|sending|received|recieved|receiving|transfer(?:red)?)\s+(?:of\s+)?[\d.,]+\s+(?:ETH|BTC|SOL)\b)/i.test(text) &&
        !/\b(?:sold|bought|order filled|trade confirmation)\b/i.test(text)) {
        result.Category = 'Investment'; result.Label = 'Asset Distribution';
        result.PortfolioAction = 'TRANSFER'; result.AccountFlow = 'NONE';
        result.PortfolioPrice = null;
        const candidates=accounts.filter(a=>/wealthsimple/i.test(a.institution||'')&&/crypto/i.test(a.accountType||'')&&(!result.Currency||a.currency===result.Currency));
        if(candidates.length===1){result.Account=candidates[0].accountRef;result.PortfolioAccountNumber=candidates[0].accountRef;result.BalanceAccountId=result.PortfolioAccountId=candidates[0].id;result.Currency ||= candidates[0].currency;}
    }
    if (!result.Currency) {
        const explicit = [...text.matchAll(/\b(CAD|USD|EUR|GBP)\b/gi)].map(m => m[1].toUpperCase());
        const currencies = [...new Set(explicit)];
        if (currencies.length === 1) result.Currency = currencies[0];
        else {
            const reference = getAccountReference(result);
            const candidates = reference ? accounts.filter(a => accountMatchScore({ ...result, Account: reference }, a) >= 80) : [];
            if (candidates.length === 1 && candidates[0].currency) result.Currency = candidates[0].currency;
            else { result.Currency = 'CAD'; result.IngestionReviewReason = 'unconfirmed_currency'; }
        }
    }
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
    else if (/From:[^\n]*rbcroyalbankalerts@alerts\.rbc\.com/i.test(String(body))) {
        // RBC alerts can arrive days after the event. Preserve the statement
        // date rather than using the email delivery time as the purchase date.
        const dateText = String(body).match(/Transaction Date:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i)?.[1];
        if (dateText) {
            const date = new Date(`${dateText} 12:00:00 GMT`);
            if (Number.isFinite(date.getTime())) result.Timestamp = date.toISOString();
        }
    }
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
