const { ALL_LABELS } = require('./transactionCategories');
const VERSION = 'source-evidence-v4';
const text = { type: ['string', 'null'] };
const numeric = { type: ['number', 'null'] };
const fields = {
    Currency: text, Amount: { type:'string', pattern:'^[0-9]+(?:\\.[0-9]+)?$' },
    Category: { type:'string', enum:['Expense','Income','Internal','Investment','Saving'] },
    Label: { type:'string', enum:ALL_LABELS }, Reason: { type:'string' }, CounterpartyName:{...text,description:'For e-Transfers only: full sender (incoming) or recipient (outgoing) person/business name supported by the email; no transaction prefix or references, no guessed expansion of initials. Otherwise null.'}, Timestamp:text, CashDate:text,
    Type:text, Account:text, BankName:text, ReferenceNumber:text,
    BalanceAccountId:numeric, BalanceAccountConfidence:text, PortfolioAction:text, PortfolioAccountId:numeric, PortfolioConfidence:text,
    PortfolioSymbol:text, PortfolioQuantity:numeric,
    PortfolioPrice:{...numeric,description:'Execution unit price stated in a filled BUY or SELL order only. Return null for TRANSFER, DIVIDEND and every non-trade action. Never calculate a unit price from asset valuation or quantity.'}, PortfolioAccountNumber:text,
    PortfolioToSymbol:text, PortfolioToQuantity:numeric, AccountFlow:{type:['string','null'],enum:['IN','OUT','NONE',null]},
};
const EVIDENCE_FIELDS = ['CounterpartyName','Amount','Currency','Account','ReferenceNumber','Timestamp','CashDate','PortfolioAction','PortfolioSymbol','PortfolioQuantity','PortfolioPrice','PortfolioToSymbol','PortfolioToQuantity','AccountFlow','FromAccount','ToAccount'];
const evidenceDescription={
    AccountFlow:'Exact SOURCE WORDS establishing direction, e.g. "was debited", "purchase", "received" or "Total cost". Never the output enum IN, OUT or NONE unless those exact words occur in the email.',
    PortfolioAction:'Exact source wording establishing the action, e.g. "Type: Fractional Buy". Preserve the source capitalization; do not replace the wording with the normalized action.',
    Timestamp:'Exact source date/time wording, preserving timezone and AM/PM. Null if absent.',
    CashDate:'Exact source wording explicitly identifying settlement date. Null when settlement is not stated.',
    FromAccount:'Exact wording identifying the owned origin account, not the sender email header.',
    ToAccount:'Exact wording identifying the owned destination account, not the recipient email header.',
};
const evidenceSchema = {type:'object',properties:Object.fromEntries(EVIDENCE_FIELDS.map(key=>[key,{...text,description:evidenceDescription[key] || `Exact contiguous quote from Email Text supporting ${key}, preserving spelling and capitalization, or null when absent. Never quote account context or examples.`}])),required:EVIDENCE_FIELDS,additionalProperties:false};
const RESPONSE_SCHEMA = { anyOf: [
    {type:'object',properties:{...fields,Evidence:evidenceSchema},required:[...Object.keys(fields),'Evidence'],additionalProperties:false},
    {type:'object',properties:{error:{type:'string'}},required:['error'],additionalProperties:false},
] };
const norm = value => String(value ?? '').replace(/[^a-z0-9]/gi,'').toLowerCase();
function numbers(quote) { return [...quote.matchAll(/(?<![A-Za-z0-9.])\d[\d,]*(?:\.\d+)?(?![A-Za-z0-9.])/g)].map(m=>Number(m[0].replace(/,/g,''))); }
function validateEvidence(transaction, body, accounts = []) {
    if (transaction.error) return transaction;
    const evidence = transaction.Evidence;
    const fail = field => { const error=new Error(`Unsupported extraction field: ${field}`);error.code='AI_SOURCE_EVIDENCE';throw error; };
    if (!evidence || !/^\d+(?:\.\d+)?$/.test(transaction.Amount) || !Number.isFinite(Number(transaction.Amount)) || Number(transaction.Amount)<0) fail('Amount');
    for (const [field,quote] of Object.entries(evidence)) {
        if (!EVIDENCE_FIELDS.includes(field) || quote!==null && (typeof quote!=='string' || !quote.trim() || quote.length>500 || !body.includes(quote))) fail(field);
    }
    if(transaction.CounterpartyName){
        const names=require('../../../shared/transactionNames.cjs');
        if(!evidence.CounterpartyName || !names.nameKey(evidence.CounterpartyName).includes(names.nameKey(transaction.CounterpartyName)) ||
            !names.isETransfer(transaction) || !names.normalizeName(transaction.CounterpartyName))fail('CounterpartyName');
    }
    for (const field of ['Amount','PortfolioQuantity','PortfolioPrice','PortfolioToQuantity']) {
        if (transaction[field]!=null && (!evidence[field] || !numbers(evidence[field]).some(n=>Math.abs(n-Number(transaction[field]))<1e-10))) fail(field);
    }
    for (const field of ['Currency','PortfolioSymbol','PortfolioToSymbol','ReferenceNumber']) {
        if (transaction[field]!=null && (!evidence[field] || !norm(evidence[field]).includes(norm(transaction[field])))) {
            if (!(field==='Currency' && transaction.Currency==='CAD' && evidence.Currency?.includes('CA$'))) fail(field);
        }
    }
    // Model ids are hints only: prove that a unique supplied account is named in the source.
    const ids=[transaction.BalanceAccountId,transaction.PortfolioAccountId].filter(v=>v!=null);
    if (ids.length || transaction.Account || transaction.PortfolioAccountNumber) {
        if (!evidence.Account) fail('Account');
        const masked=evidence.Account.match(/[*•x]{2,}([A-Za-z0-9]{4,})/i)?.[1];
        const matches=accounts.filter(a=>[a.accountRef,a.name].some(v=>norm(v).length>=4 && norm(evidence.Account).includes(norm(v))) || masked && norm(a.accountRef).endsWith(norm(masked)));
        if (ids.some(id=>matches.length!==1 || Number(matches[0].id)!==Number(id))) fail('Account');
        for(const field of ['Account','PortfolioAccountNumber'])if(transaction[field] && !norm(evidence.Account).includes(norm(transaction[field])) && !matches.some(a=>a.accountRef===transaction[field]))fail(field);
    }
    for (const field of ['Timestamp','CashDate']) if(transaction[field]) {
        const quote=evidence[field];
        if(!quote) fail(field);
        const source = field==='Timestamp' ? require('./emailEvidence').sourceEventTimestamp(`Time: ${quote}`) : null;
        const day=quote.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || (()=>{const m=quote.match(/[A-Za-z]+\s+\d{1,2},\s*\d{4}/);if(!m)return null;const d=new Date(`${m[0]} 12:00:00 GMT`);return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null;})();
        if(source ? transaction[field]!==source : !day || String(transaction[field]).slice(0,10)!==day) fail(field);
    }
    const expectedFlow={BUY:'OUT',SELL:'IN',DIVIDEND:'IN',INTEREST:'IN',FEE:'OUT',TAX:'OUT'}[transaction.PortfolioAction] || (transaction.Category==='Expense'?'OUT':transaction.Category==='Income'?'IN':null);
    if(expectedFlow && transaction.AccountFlow!==expectedFlow)fail('AccountFlow');
    if(['BUY','SELL'].includes(transaction.PortfolioAction) && (!transaction.PortfolioSymbol || !(transaction.PortfolioQuantity>0) || !(transaction.PortfolioPrice>0)))fail('trade details');
    if(transaction.PortfolioAction) {
        const actions={BUY:/\b(buy|bought|purchase)\b/i,SELL:/\b(sell|sold|sale)\b/i,DIVIDEND:/\bdividend\b/i,TRANSFER:/\b(transfer|sent|received|recieved)\b/i};
        if(!evidence.PortfolioAction || !(actions[transaction.PortfolioAction] || new RegExp(transaction.PortfolioAction,'i')).test(evidence.PortfolioAction)) fail('PortfolioAction');
    }
    if(transaction.Category==='Internal' && !/\b(?:credit[ -]?card|card)\s+payment|payment\s+(?:made|received)/i.test(body)) {
        const resolve=quote=>accounts.filter(a=>quote && [a.accountRef,a.name].some(v=>norm(v).length>=4 && norm(quote).includes(norm(v))));
        const from=resolve(evidence.FromAccount),to=resolve(evidence.ToAccount);
        if(from.length!==1 || to.length!==1 || from[0].id===to[0].id)fail('owned transfer endpoints');
    }
    if(transaction.AccountFlow && transaction.AccountFlow!=='NONE') {
        const direction=transaction.AccountFlow==='IN'?/\b(received|deposit(?:ed)?|credit(?:ed)?|sell|sold|dividend|interest)\b/i:/\b(withdrawal|withdrawn|debited|deducted|purchase|buy|bought|sent|payment|cost)\b|\b(?:accepted your transfer|your transfer to)\b/i;
        if(!evidence.AccountFlow || !direction.test(evidence.AccountFlow)) fail('AccountFlow');
    }
    return transaction;
}
module.exports={VERSION,RESPONSE_SCHEMA,EVIDENCE_FIELDS,validateEvidence};
