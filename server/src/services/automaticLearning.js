const crypto = require('node:crypto');
const { inferAccountType, getAccountReference } = require('./accountDiscovery');
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const norm = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const bankKey = value => /rbc|royalbank/.test(norm(value)) ? 'rbc' : /wealthsimple/.test(norm(value)) ? 'wealthsimple' : norm(value);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const service = () => require('../database/dbService');

function mappingScope(transaction, body) {
    const text = String(body || '').replace(/https?:\/\/\S+/g,'').replace(/<[^>]*>/g,' ');
    const label = text.match(/^Account:\s*([^\n]+)/im)?.[1]?.trim() ||
        (/Subject:\s*Direct deposit received\s*$/im.test(text) ? 'Direct deposit received' : null);
    if (!label || label.length > 100 || !transaction.BankName || !transaction.Currency) return null;
    // Cash transfers identify two different roles. A single Account label cannot establish both.
    if (transaction.Category === 'Internal' || transaction.PortfolioAction === 'TRANSFER') return null;
    const role = transaction.Category === 'Investment' || transaction.PortfolioAction ? 'portfolio' : 'balance';
    const symbol = role === 'portfolio'
        ? (text.match(/^(?:Symbol|Cryptocurrency):\s*([A-Z0-9.\-]{1,15})\s*$/im)?.[1]?.toUpperCase() || '') : '';
    const scope = { bank:bankKey(transaction.BankName), alias:norm(label), currency:transaction.Currency,
        role, symbol, label };
    return { ...scope, key: hash([scope.bank,scope.alias,scope.currency,scope.role,scope.symbol]) };
}

async function learnAccountMappings(userId) {
    const db = await service().getDb();
    const rows = await db.all(`SELECT s.*,t.Currency,t.AmountMinor,t.Category,t.PortfolioAction,t.PortfolioQuantity,t.BankName,t.BalanceAccountId,t.PortfolioAccountId,t.Timestamp
        FROM transaction_sources s JOIN transactions t ON t.id=s.transactionId AND t.userId=s.userId
        WHERE s.userId=? AND s.provider IN ('plaid','plaid_investments')
        AND EXISTS(SELECT 1 FROM transaction_sources e WHERE e.userId=s.userId AND e.transactionId=s.transactionId AND e.provider='email')`,[userId]);
    const active = [], scopes = new Map();
    for (const row of rows) {
        const raw = parse(row.rawPayloadJson), context = parse(row.contextPayloadJson);
        const accountId = context.account?.appAccountId;
        const currency = raw.iso_currency_code || raw.unofficial_currency_code;
        const account = accountId && await db.get('SELECT * FROM investment_accounts WHERE id=? AND userId=?',[accountId,userId]);
        if ((row.BalanceAccountId && Number(row.BalanceAccountId)!==Number(accountId)) || (row.PortfolioAccountId && Number(row.PortfolioAccountId)!==Number(accountId))) continue;
        if (!account || context.providerRemoved || context.matchStatus === 'currency_review' || raw.pending ||
            currency !== row.Currency || account.currency !== currency || !Number.isFinite(raw.amount) ||
            Math.round(Math.abs(raw.amount)*100) !== row.AmountMinor || bankKey(account.institution)!==bankKey(row.BankName)) continue;
        if (row.PortfolioAction && Number.isFinite(row.PortfolioQuantity) &&
            (!Number.isFinite(raw.quantity) || Math.abs(Math.abs(raw.quantity)-row.PortfolioQuantity)>1e-8)) continue;
        const sources = await service().getTransactionSourcesForUser(row.transactionId,userId);
        for (const email of sources.filter(s => s.provider==='email' && s.transactionId===row.transactionId)) {
            const scope = mappingScope(row,email.rawPayload?.rawBody);
            if (!scope) continue;
            scopes.set(scope.key,scope);
            active.push({scope,accountId,transactionId:row.transactionId,sourceKey:`${row.provider}:${row.externalId}`,eventFingerprint:hash([scope.key,raw.date || String(row.Timestamp).slice(0,10),row.AmountMinor,row.PortfolioQuantity||null,raw.payment_meta?.reference_number||null])});
        }
    }
    await db.withTransaction(async()=>{
        const now=new Date().toISOString();
        // Retain old evidence as inactive, including provider removals and changed assignments.
        await db.run('UPDATE account_learning_evidence SET active=0 WHERE userId=?',[userId]);
        for (const evidence of active) await db.run(`INSERT INTO account_learning_evidence
            (userId,ruleKey,sourceKey,transactionId,accountId,eventFingerprint,active,createdAt,updatedAt) VALUES (?,?,?,?,?,?,1,?,?)
            ON CONFLICT(userId,ruleKey,sourceKey,accountId) DO UPDATE SET active=1,eventFingerprint=excluded.eventFingerprint,updatedAt=excluded.updatedAt`,
            [userId,evidence.scope.key,evidence.sourceKey,evidence.transactionId,evidence.accountId,evidence.eventFingerprint,now,now]);
        const existing = await db.all('SELECT * FROM learned_account_rules WHERE userId=?',[userId]);
        for (const rule of existing) if (!scopes.has(rule.ruleKey)) scopes.set(rule.ruleKey,parse(rule.ruleJson));
        for (const [key,scope] of scopes) {
            const counts=await db.all(`SELECT accountId,COUNT(DISTINCT eventFingerprint) count FROM account_learning_evidence
                WHERE userId=? AND ruleKey=? AND active=1 GROUP BY accountId`,[userId,key]);
            const status=counts.length>1?'conflict':counts[0]?.count>=2?'active':'learning';
            await db.run(`INSERT INTO learned_account_rules VALUES (?,?,?,?,?,?,?) ON CONFLICT(userId,ruleKey)
                DO UPDATE SET ruleJson=excluded.ruleJson,accountId=excluded.accountId,evidenceCount=excluded.evidenceCount,status=excluded.status,updatedAt=excluded.updatedAt`,
                [userId,key,JSON.stringify(scope),counts.length===1?counts[0].accountId:null,counts.reduce((n,c)=>n+c.count,0),status,now]);
        }
    });
    return (await db.all('SELECT status,COUNT(*) count FROM learned_account_rules WHERE userId=? GROUP BY status',[userId]))
        .reduce((out,row)=>({...out,[row.status]:row.count}),{});
}

async function applyLearnedAccount(userId,transaction,body) {
    const scope=mappingScope(transaction,body);
    if(!scope) return transaction;
    const db=await service().getDb();
    const rule=await db.get(`SELECT r.*,a.accountRef,a.institution,a.accountType,a.currency FROM learned_account_rules r
        JOIN investment_accounts a ON a.id=r.accountId AND a.userId=r.userId
        WHERE r.userId=? AND r.ruleKey=? AND r.status='active'`,[userId,scope.key]);
    if(!rule || rule.evidenceCount<2 || bankKey(rule.institution)!==scope.bank || rule.currency!==transaction.Currency) return transaction;
    const reference=getAccountReference(transaction);
    // Concrete account evidence always outranks a generic learned alias.
    if(reference && norm(reference)!==scope.alias && norm(reference)!==norm(rule.accountRef)) return transaction;
    const portfolio=scope.role==='portfolio';
    const expectedType=inferAccountType(transaction);
    if(portfolio && expectedType!=='Other' && expectedType!=='Brokerage' && rule.accountType!==expectedType) return transaction;
    return {...transaction,...(['ambiguous_account','unconfirmed_currency'].includes(transaction.IngestionReviewReason)?{IngestionReviewReason:null}:{}),Account:rule.accountRef || transaction.Account,BalanceAccountId:rule.accountId,BalanceAccountConfidence:'HIGH',
        ...(portfolio?{PortfolioAccountId:rule.accountId,PortfolioAccountNumber:rule.accountRef,PortfolioConfidence:'HIGH'}:{})};
}

function merchantKey(transaction, sources=[]) {
    const active=sources.filter(s=>s.provider==='plaid' && !parse(s.contextPayloadJson).providerRemoved);
    const names=[...new Set(active.map(s=>parse(s.rawPayloadJson).merchant_name).filter(Boolean).map(norm))];
    return names.length===1 ? names[0] : norm(transaction.Reason);
}
const flowOf = tx => tx.AccountFlow || (tx.Category==='Income'?'IN':tx.Category==='Expense'?'OUT':null);
async function rememberMerchantPreference(userId,transaction,{reviewedAt=new Date().toISOString()}={}) {
    if(!transaction || !['Expense','Income'].includes(transaction.Category) || transaction.PortfolioAction || !transaction.Label || !transaction.Currency) return;
    const flow=flowOf(transaction), db=await service().getDb();
    if(!['IN','OUT'].includes(flow) || flow!==(transaction.Category==='Expense'?'OUT':'IN')) return;
    const sources=await db.all('SELECT * FROM transaction_sources WHERE userId=? AND transactionId=?',[userId,transaction.id]);
    const key=merchantKey(transaction,sources);
    if(key.length<3 || ['deposit','withdrawal','transfer','bankdeposit','other','payment'].includes(key)) return;
    await db.run(`INSERT INTO merchant_preferences VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(userId,merchantKey,currency,flow)
        DO UPDATE SET category=excluded.category,label=excluded.label,transactionId=excluded.transactionId,updatedAt=excluded.updatedAt WHERE merchant_preferences.updatedAt<=excluded.updatedAt`,
        [userId,key,transaction.Currency,flow,transaction.Category,transaction.Label,transaction.id,reviewedAt]);
}
async function learnReviewedPreferences(userId) {
    const db=await service().getDb();
    const rows=await db.all(`SELECT t.*,o.fieldsJson,o.updatedAt reviewedAt FROM transaction_overrides o
        JOIN transactions t ON t.id=o.transactionId AND t.userId=o.userId
        WHERE o.userId=? AND o.evidence='User reviewed correction' ORDER BY o.updatedAt`,[userId]);
    for(const row of rows) {
        const fields=parse(row.fieldsJson);
        if((fields.Category||fields.Label) && Number.isFinite(Date.parse(row.reviewedAt))) await rememberMerchantPreference(userId,row,{reviewedAt:row.reviewedAt});
    }
    return rows.length;
}
async function personalizeTransaction(userId,transaction,raw = null) {
    if(!transaction || transaction.PortfolioAction || !['Expense','Income'].includes(transaction.Category)) return transaction;
    const db=await service().getDb(), key=raw?.merchant_name?norm(raw.merchant_name):norm(transaction.Reason);
    const rule=await db.get('SELECT * FROM merchant_preferences WHERE userId=? AND merchantKey=? AND currency=? AND flow=?',
        [userId,key,transaction.Currency,flowOf(transaction)]);
    if(!rule) return transaction;
    return Object.defineProperty({...transaction,Category:rule.category,Label:rule.label},'_personalized',{value:true});
}
module.exports={learnReviewedPreferences,mappingScope,learnAccountMappings,applyLearnedAccount,rememberMerchantPreference,personalizeTransaction,merchantKey,bankKey,hash,parse};
