// Deliberately narrow templates; a changed template falls through to evidence-checked AI.
const {sourceEventTimestamp}=require('./emailEvidence');
const { CREDIT_CARD_PAYMENT_LABEL } = require('./transactionCategories');
function parseKnownEmail(body) {
    const raw=String(body||'');
    const from=raw.match(/^From:\s*([^\r\n]+)/im)?.[1]||'';
    const subject=raw.match(/^Subject:\s*([^\r\n]+)/im)?.[1]?.trim()||'';
    const base={Amount:null,Currency:null,Category:'Expense',Label:'Other Expense',Reason:subject,
        Timestamp:null,CashDate:null,Type:null,Account:null,BankName:null,ReferenceNumber:null,
        BalanceAccountId:null,PortfolioAccountId:null,PortfolioAction:null,AccountFlow:null,
        PortfolioSymbol:null,PortfolioQuantity:null,PortfolioPrice:null,PortfolioAccountNumber:null,
        Evidence:{},ExtractionVersion:'templates-v1'};
    const field=(name,pattern)=>{const m=raw.match(pattern);if(!m)return null;base.Evidence[name]=m[0];return m[1].trim();};
    if(/<rbcroyalbankalerts@alerts\.rbc\.com>/i.test(from) && /^(You made a purchase\.|You received a credit\.|Withdrawal Warning|Deposit Notice|Payment Made)$/.test(subject)) {
        const kind=/purchase/i.test(subject)?'Purchase':/credit/i.test(subject)?'Credit':/withdrawal/i.test(subject)?'Withdrawal':/deposit/i.test(subject)?'Deposit':'Payment';
        base.Amount=field('Amount',new RegExp(`${kind} Amount:\\s*\\$([\\d,]+\\.\\d{2})`,'i'))?.replace(/,/g,'');
        if(kind==='Credit'&&!base.Amount)base.Amount=field('Amount',/credited for \$([\d,]+\.\d{2})\b/i)?.replace(/,/g,'');
        base.Account=field('Account',/\bAccount:\s*([*•x]+\d{4})/i);
        const day=field('Timestamp',/Transaction Date:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
        if(!base.Amount||!base.Account||!day) return null;
        const date=new Date(`${day} 12:00:00 GMT`);if(!Number.isFinite(date.getTime()))return null;
        base.Timestamp=date.toISOString();base.BankName='RBC Royal Bank';
        base.Type=['Purchase','Credit','Payment'].includes(kind)?'Credit Card':'Checking Account';
        base.Reason=field('Reason',/Transaction Description:\s*([^\r\n]+)/i)||subject;
        base.AccountFlow=['Credit','Deposit','Payment'].includes(kind)?'IN':'OUT';
        base.Evidence.AccountFlow=`Subject: ${subject}`;
        if(['Credit','Deposit'].includes(kind)){base.Category='Income';base.Label=kind==='Credit'?'Refunds & Reversals':'Cash & Cheque Deposits';}
        if(kind==='Payment'){base.Category='Internal';base.Label=CREDIT_CARD_PAYMENT_LABEL;}
        if(['Purchase','Credit','Payment'].includes(kind))base.PostingStatus='pending';
        return base;
    }
    if(/<notifications@o\.wealthsimple\.com>/i.test(from) && ['Direct deposit received','You made a transfer'].includes(subject)) {
        const match=raw.match(/Amount:\s*\$([\d,]+\.\d{2})(?:\s+(CAD|USD))?/i);
        if(!match)return null;
        base.Amount=match[1].replace(/,/g,'');base.Currency=match[2]||null;base.Evidence.Amount=match[0];base.Evidence.Currency=match[2]||null;
        base.BankName='Wealthsimple';base.AccountFlow='IN';
        if(subject==='Direct deposit received'){
            const sender=raw.match(/Amount:[^\n]+\nFrom:\s*([^\r\n]+)/i);
            if(!sender||!/available in your chequing account/i.test(raw))return null;
            base.Category='Income';base.Label='Employment Income';base.Type='Chequing';base.Reason=`Direct deposit: ${sender[1].trim()}`;
        }else{
            const block=raw.match(/Amount:\s*\$[\d,.]+\s*(?:CAD|USD)?\s+From:\s*(.+?)\s+To:\s*(.+?)(?=\s+(?:Track the|View activity|Learn more)|$)/i);
            if(!block)return null;
            base.Category='Internal';base.Label='Internal Transfer';base.PortfolioAction='TRANSFER';
            base.Evidence.FromAccount=block[1];base.Evidence.ToAccount=block[2];base.Evidence.PortfolioAction=`Subject: ${subject}`;
            base.Reason=`Internal transfer: ${block[1]} -> ${block[2]}`;
        }
        return base;
    }
    if(/<notifications@o\.wealthsimple\.com>/i.test(from) && ['Your order has been filled','You earned a dividend'].includes(subject)) {
        base.BankName='Wealthsimple';base.Category='Investment';
        base.Account=field('Account',/^Account:\s*([^\r\n]+)/im);
        base.PortfolioSymbol=field('PortfolioSymbol',/^(?:Symbol|Cryptocurrency):\s*([A-Z0-9.\-]{1,15})\s*$/m);
        base.Type=base.Account;
        if(subject==='Your order has been filled'){
            const action=field('PortfolioAction',/^Type:\s*((?:Fractional |Market |Limit )?(?:Buy|Sell))\s*$/im);
            if(!action)return null;
            base.PortfolioAction=/buy/i.test(action)?'BUY':'SELL';
            base.Label=/^Crypto$/i.test(base.Account)?(base.PortfolioAction==='BUY'?'Crypto Purchase':'Crypto Sale'):(base.PortfolioAction==='BUY'?'ETF & Stock Purchase':'ETF & Stock Sale');
            base.AccountFlow=base.PortfolioAction==='BUY'?'OUT':'IN';
            base.Amount=field('Amount',/^Total (?:cost|proceeds|value):\s*\$([\d,]+\.\d{2})\s*(?:CAD|USD)?\s*$/im)?.replace(/,/g,'');
            const qty=field('PortfolioQuantity',/^(?:Shares|Quantity):\s*([\d,.]+)\s*$/im);
            const price=field('PortfolioPrice',/^(?:Average price|Filled price):\s*\$([\d,.]+)\s*(?:CAD|USD)?\s*$/im);
            if(!qty||!price)return null;
            base.PortfolioQuantity=Number(qty.replace(/,/g,''));base.PortfolioPrice=Number(price.replace(/,/g,''));
            base.Timestamp=sourceEventTimestamp(raw);base.Evidence.Timestamp=raw.match(/Time:\s*([^\r\n]+)/i)?.[1]||null;
        } else {
            base.PortfolioAction='DIVIDEND';base.Label='Dividends';base.AccountFlow='IN';
            base.Amount=field('Amount',/^Amount:\s*\$([\d,]+\.\d{2})\s+(?:CAD|USD)\s*$/im)?.replace(/,/g,'');
            base.Evidence.PortfolioAction=`Subject: ${subject}`;
        }
        base.Evidence.AccountFlow=base.Evidence.PortfolioAction;
        const currency=raw.match(/^(?:Amount|Total (?:cost|proceeds|value)|Average price):[^\r\n]*\b(CAD|USD)\b/im);
        if(currency){base.Currency=currency[1].toUpperCase();base.Evidence.Currency=currency[0];}
        if(!base.Amount||!base.Account||!base.PortfolioSymbol)return null;
        base.Reason=`${base.PortfolioAction} ${base.PortfolioSymbol}`;
        return base;
    }
    return null;
}
module.exports={parseKnownEmail};
