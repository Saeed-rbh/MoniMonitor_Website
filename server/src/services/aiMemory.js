const { createHash } = require('node:crypto');
const { encryptString, decryptString } = require('./encryptionService');
const { VERSION } = require('./extractionEvidence');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const inflight = new Map();
async function cachedExtraction(db, userId, input, extract) {
    if(!userId) return extract();
    const key=hash([VERSION,input]);
    const row=await db.get('SELECT resultEncrypted FROM ai_extractions WHERE userId=? AND inputHash=?',[userId,key]);
    if(row) return JSON.parse(decryptString(row.resultEncrypted,'EMAIL_SOURCE_ENCRYPTION_KEY'));
    const jobKey=hash([userId,key]);
    if(inflight.has(jobKey))return inflight.get(jobKey);
    const job=(async()=>{
        const result=await extract();
        if(result && !result.error) await db.run(`INSERT OR IGNORE INTO ai_extractions(userId,inputHash,version,provider,resultEncrypted,createdAt)
            VALUES(?,?,?,?,?,?)`,[userId,key,VERSION,input.provider,encryptString(JSON.stringify(result),'EMAIL_SOURCE_ENCRYPTION_KEY'),new Date().toISOString()]);
        return result;
    })();
    inflight.set(jobKey,job);
    try{return await job;}finally{inflight.delete(jobKey);}
}
async function verifiedExamples(db,userId,body,before=new Date().toISOString()) {
    if(!userId || !Number.isFinite(Date.parse(before))) return [];
    const rows=await db.all(`SELECT v.transactionId,v.factsJson,v.verifiedAt FROM verified_history_entries v
        JOIN transactions t ON t.id=v.transactionId AND t.userId=v.userId
        WHERE v.userId=? AND v.verifiedAt<? AND t.Timestamp<?
        AND EXISTS(SELECT 1 FROM transaction_sources s WHERE s.userId=v.userId AND s.transactionId=v.transactionId AND s.provider='email')
        ORDER BY v.verifiedAt DESC,v.transactionId DESC LIMIT 80`,[userId,before,before]);
    const subject=body.match(/^Subject:\s*([^\r\n]+)/im)?.[1] || '';
    const examples=[];
    for(const row of rows) {
        const sources=await require('../database/dbService').getTransactionSourcesForUser(row.transactionId,userId);
        const email=sources.find(s=>s.provider==='email'&&s.rawPayload?.rawBody?.match(/^Subject:\s*([^\r\n]+)/im)?.[1]===subject);
        if(!email) continue;
        const fact=JSON.parse(row.factsJson);
        // Exclude any verified record subsequently corrected/reassigned; retrieve final bank facts only.
        const current=await db.get('SELECT * FROM transactions WHERE id=? AND userId=?',[row.transactionId,userId]);
        const keys=require('./verifiedHistory').protectedFields;
        if(keys.some(k=>Object.hasOwn(fact,k)&&fact[k]!==current[k])) continue;
        examples.push({transactionId:row.transactionId,verifiedAt:row.verifiedAt,
            source:require('./aiService').minimizeEmailForAI(email.rawPayload.rawBody),
            expected:Object.fromEntries(keys.filter(k=>fact[k]!=null).map(k=>[k,fact[k]]))});
        if(examples.length===3) break;
    }
    return examples;
}
module.exports={hash,cachedExtraction,verifiedExamples};
