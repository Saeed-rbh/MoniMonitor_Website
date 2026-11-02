const cleanText = value => String(value || '').normalize('NFKC')
    .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&(?:rsquo|apos);|&#39;/gi,"'")
    .replace(/&quot;|&#34;/gi,'"').replace(/[\u200b-\u200f\ufeff]/g,'').replace(/\s+/g,' ').trim();
const nameKey = value => cleanText(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function normalizeName(value) {
    if(typeof value!=='string')return null;
    let name=cleanText(value).replace(/^(?:interac\s+)?e[ -]?transfer\s*[-:–—]\s*/i,'').replace(/^(?:received from|sent to|from|to)\s+/i,'').replace(/^[\s:–—-]+|[\s:–—-]+$/g,'').replace(/[®™]/g,'').trim();
    name=name.replace(/\s*(?:\[(?:XFER|REF|INTERAC)[^\]]*\]|\b(?:reference|confirmation)(?:\s+(?:number|no\.?))?\s*[:#].*)$/i,'').trim();
    if(/\b(?:received in|sent from|chequing account|checking account|account ending|sender unavailable|recipient unavailable)\b/i.test(name))return null;
    if(/\b(?:interac|e[ -]?transfer)\b/i.test(name))return null;
    if(!name || name.length>160 || !/\p{L}/u.test(name) || /https?:|@|\$|[<>\r\n]/i.test(name) ||
        /^(?:e[ -]?transfer|interac|unknown|sender unavailable|recipient unavailable|not provided|n\/?a|personal transfers?(?: received)?|deposit|withdrawal|bank transfer|electronic transfer|transfer in|transfer out|payment received|payment sent|credit|debit)$/i.test(name))return null;
    if(!/\p{Ll}/u.test(name)||!/\p{Lu}/u.test(name)){
        const acronyms=new Set(['RBC','TD','BMO','CIBC','CUPE','YMCA','LLC','LLP','CPA']);
        name=name.split(' ').map(word=>acronyms.has(word)?word:word.toLocaleLowerCase().replace(/(^|[-'’])\p{L}/gu,letter=>letter.toLocaleUpperCase())).join(' ');
    }
    return name;
}
function isETransfer(transaction={}) {
    const reason=cleanText(transaction.Reason);
    // Interac also operates debit terminals. Personal Transfers includes other
    // payment rails; neither is sufficient evidence of an e-transfer.
    if(transaction.Category==='Internal' || /\binternal transfer\b/i.test(reason) ||
        /\b(?:reclaim fee|expired interac e[ -]?transfer credit|retail purchase|point of sale|contactless|misc payment|online banking transfer|deposit online transfer|money transfer into the account)\b/i.test(reason) ||
        /^(?:transfer in|transfer out)$/i.test(reason))return false;
    if(/\be[ -]?transfer\b/i.test(reason))return true;
    if(/\be[ -]?transfer\b/i.test(String(transaction.Type||'')))return true;
    // Retain support for legacy rows containing just a person's name.
    return /^personal transfers?(?: received)?$/i.test(String(transaction.Label||'')) &&
        !!normalizeName(reason) && !/\b(?:payment|transfer|deposit|withdrawal|interac)\b/i.test(reason);
}
function counterpartyFromReason(reason, transaction={}) {
    const text=cleanText(reason);
    if(!isETransfer({...transaction,Reason:text}))return null;
    const patterns=[
        /^(?:internet banking\s+)?(?:interac\s+)?e[ -]?transfer(?:®)?\s+\d{6,32}\s+(.+)$/i,
        /^(?:interac\s+)?e[ -]?transfer(?:®)?\s*(?:[-:–—]\s*)?(?:sent|received|autodeposit|cancel(?:led)?)\s+(.+?)(?:\s+(?=[A-Z0-9]{6,32}$)(?=[A-Z0-9]*\d)[A-Z0-9]+)?$/i,
        /^(?:.*?\b)?(?:interac\s+)?e[ -]?transfer\s*[-:–—]\s*(.+)$/i,
        /^(.+?)\s*[-–—]\s*(?:interac\s+)?e[ -]?transfer(?:®|\s.*)?$/i,
        /\b(?:e[ -]?transfer\s+)?(?:received from|sent to|from|to)\s+(.+?)(?=\s+(?:has been|was|and it|received in|sent from)\b|$)/i,
    ];
    for(const pattern of patterns){const m=text.match(pattern);if(m){const name=normalizeName(m[1]);if(name)return name;}}
    if(!/\b(?:interac|e[ -]?transfer|sent|received|deposit|withdrawal)\b/i.test(text))return normalizeName(text);
    return null;
}
function bankDescription(raw) {
    if(Array.isArray(raw))return typeof raw[1]==='string'?cleanText(raw[1]):null; // CIBC native CSV
    if(!raw || typeof raw!=='object')return null;
    if(typeof raw['Description 1']==='string')return cleanText([raw['Description 1'],raw['Description 2']].filter(Boolean).join(' '));
    const description=raw.description||raw.original_description;
    return typeof description==='string'?cleanText(description):null;
}
function counterpartyFromEmail(body, transaction={}) {
    const subject=String(body||'').match(/^Subject:\s*(.+)$/im)?.[1];
    if(!subject || !/interac|e[ -]?transfer|payment from/i.test(subject))return null;
    const text=cleanText(subject).replace(/^(?:(?:fw|fwd|re):\s*)+/i,'');
    const patterns=[
        /(?:you['’]ve received|you received)\s+(?:\$[\d,.]+\s+(?:CAD\s+)?)?from\s+(.+?)(?=\s+and (?:it|the)|\s+has (?:been|sent)|$)/i,
        /your\s+\$[\d,.]+\s+transfer to\s+(.+?)(?=\s+has been|\s+was|$)/i,
        /(?:interac\s+e[ -]?transfer:\s*)?(.+?)\s+has accepted your transfer\b/i,
        /^payment from\s+(.+?)\s+was successfully completed/i,
    ];
    for(const pattern of patterns){const m=text.match(pattern);if(m){const name=normalizeName(m[1]);if(name)return{name,quote:m[1],kind:'email_subject'};}}
    const content=String(body||'').split(/\r?\n\r?\n/).slice(1).join('\n\n');
    const incoming=transaction.AccountFlow==='IN'||/you['’]ve received|you received|funds deposited/i.test(text);
    const outgoing=transaction.AccountFlow==='OUT'||/your.*transfer|accepted your transfer/i.test(text);
    const pattern=incoming?/^(?:Sender(?: name)?|From):\s*([^\r\n]+)/im:outgoing?/^(?:Recipient(?: name)?|To):\s*([^\r\n]+)/im:null;
    const match=pattern&&content.match(pattern);
    if(match){const name=normalizeName(match[1]);if(name)return{name,quote:match[1],kind:'email_counterparty_field'};}
    return null;
}
function displayReason(transaction={}) {
    const reason=cleanText(transaction.Reason),label=cleanText(transaction.Label);
    if(isETransfer(transaction))return normalizeName(transaction.CounterpartyName)||counterpartyFromReason(reason,transaction)||'E-Transfer';
    if(!reason)return 'No reason provided';
    for(const separator of [' - ',' – ',' — ',': ']){
        if(label && reason.toLocaleLowerCase().startsWith((label+separator).toLocaleLowerCase()))return reason.slice(label.length+separator.length).trim()||reason;
    }
    return reason;
}
module.exports={cleanText,nameKey,normalizeName,isETransfer,counterpartyFromReason,counterpartyFromEmail,displayReason,bankDescription};
