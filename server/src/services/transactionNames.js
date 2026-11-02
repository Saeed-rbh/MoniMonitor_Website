const names=require('../../../shared/transactionNames.cjs');
const {decryptString}=require('./encryptionService');
const service=()=>require('../database/dbService');
const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
function bankName(raw,transaction) {
    const meta=raw.payment_meta||{};
    const explicit=transaction.AccountFlow==='IN' ? meta.payer||meta.by_order_of : transaction.AccountFlow==='OUT'?meta.payee:null;
    const people=(raw.counterparties||[]).filter(c=>['person','merchant'].includes(c.type)&&c.name);
    return names.normalizeName(explicit) || (people.length===1?names.normalizeName(people[0].name):null);
}
async function enrichCounterpartyNames(userId) {
    const db=await service().getDb();
    const rows=(await db.all('SELECT id,userId,Reason,Label,Type,AccountFlow,CounterpartyName FROM transactions WHERE userId=?',[userId])).filter(names.isETransfer);
    const byId=new Map(rows.map(t=>[t.id,{transaction:t,candidates:[]} ]));
    for(const entry of byId.values()){
        const name=names.counterpartyFromReason(entry.transaction.Reason,entry.transaction);
        if(name)entry.candidates.push({name,provider:'retained_description',priority:1});
        if(entry.transaction.CounterpartyName)entry.candidates.push({name:entry.transaction.CounterpartyName,provider:'retained_name',priority:1});
    }
    const sources=await db.all(`SELECT transactionId,provider,externalId,rawPayloadJson FROM transaction_sources
        WHERE userId=? AND provider IN ('email','plaid','bank_csv')`,[userId]);
    for(const source of sources){
        const entry=byId.get(source.transactionId);if(!entry)continue;
        let raw;
        try{raw=parse(source.provider==='email'?decryptString(source.rawPayloadJson,'EMAIL_SOURCE_ENCRYPTION_KEY'):source.rawPayloadJson);}catch{continue;}
        if(source.provider==='email'){
            const extracted=names.counterpartyFromEmail(raw.rawBody,entry.transaction);
            if(extracted)entry.candidates.push({...extracted,provider:source.provider,externalId:source.externalId,priority:3});
        }else{
            const name=bankName(raw,entry.transaction);
            if(name)entry.candidates.push({name,provider:source.provider,externalId:source.externalId,priority:2});
        }
    }
    // Exact character agreement only: normalize spacing/casing, never expand initials or fuzzy-match people.
    const canonical=new Map();
    for(const entry of byId.values())for(const candidate of entry.candidates){
        const key=names.nameKey(candidate.name),previous=canonical.get(key);
        if(!previous || candidate.name.split(' ').length>previous.split(' ').length)canonical.set(key,candidate.name);
    }
    let updated=0,conflicts=0;
    await db.withTransaction(async()=>{
        for(const {transaction,candidates} of byId.values()){
            const best=candidates.sort((a,b)=>b.priority-a.priority)[0];if(!best)continue;
            const peers=candidates.filter(c=>c.priority===best.priority);
            if(new Set(peers.map(c=>names.nameKey(c.name))).size>1){conflicts++;continue;}
            const name=canonical.get(names.nameKey(best.name))||best.name;
            if(name===transaction.CounterpartyName)continue;
            const result=await db.run(`UPDATE transactions SET CounterpartyName=? WHERE userId=? AND id=?
                AND CounterpartyName IS ?`,[name,userId,transaction.id,transaction.CounterpartyName]);
            if(result.changes){
                await service().writeAgentAudit(userId,'counterparty_display_name','success',{transactionId:transaction.id,
                    previousName:transaction.CounterpartyName,name,provider:best.provider,externalId:best.externalId||null});
                updated++;
            }
        }
    });
    return{checked:rows.length,updated,conflicts};
}
module.exports={enrichCounterpartyNames,bankName};
