// Apply an explicitly reviewed native-bank description plan. This operation
// cannot change monetary values, posting status, classifications or account links.
const {createHash}=require('node:crypto');
const names=require('../../../shared/transactionNames.cjs');
const {lockFields}=require('./bankEvidenceReview');
const semantics=require('../../../shared/financialSemantics.cjs');
const reportingMeaning=row=>['isIncome','isExpense','isInternalTransfer','getSavingEffectMinor','investmentActivityMinor'].map(key=>semantics[key](row));
const identityFields=['Reason','AmountMinor','Currency','Timestamp','Category','Label','AccountFlow','PostingStatus','BalanceAccountId','PortfolioAccountId'];
async function repairBankDescriptions(db,userId,entries) {
    let updated=0,addedEvidence=0,preservedFinancialMeaning=0;
    const now=new Date().toISOString();
    await db.withTransaction(async()=>{
        for(const entry of entries){
            const row=await db.get('SELECT * FROM transactions WHERE id=? AND userId=?',[entry.transactionId,userId]);
            const proof=entry.bank;
            if(!row || !proof || !/^[a-f0-9]{64}$/.test(proof.fileSha256||'') || !proof.key ||
                !proof.file || !Number.isInteger(proof.rowIndex) || proof.rowIndex<0 ||
                !names.bankDescription(proof.raw) || names.bankDescription(proof.raw)!==names.cleanText(proof.description))throw Error('Invalid reviewed bank description evidence');
            const reason=names.cleanText(proof.description);
            for(const field of identityFields){
                if(!Object.hasOwn(entry.expected||{},field))throw Error('Incomplete reviewed transaction identity');
                const expected=field==='Reason' && row.Reason===reason?reason:entry.expected[field];
                if(row[field]!==expected)throw Error(`Reviewed bank description identity changed: ${row.id} ${field}`);
            }
            const externalId='description:'+createHash('sha256').update(proof.fileSha256+':'+proof.rowIndex).digest('hex');
            const existing=await db.get("SELECT * FROM transaction_sources WHERE provider='bank_csv' AND externalId=?",[externalId]);
            const payload=JSON.stringify({...proof.raw,description:reason,bankEvidence:proof});
            if(existing && (existing.userId!==userId || existing.transactionId!==row.id || existing.rawPayloadJson!==payload))throw Error('Reviewed bank evidence already has a different identity');
            if(!existing){
                await db.run(`INSERT INTO transaction_sources(provider,externalId,userId,transactionId,ownsTransaction,rawPayloadJson,contextPayloadJson,capturedAt,createdAt,updatedAt)
                    VALUES('bank_csv',?,?,?,0,?,?,?,?,?)`,[externalId,userId,row.id,payload,JSON.stringify({reviewed:true,descriptionOnly:true}),now,now,now]);
                addedEvidence++;
            }
            if(row.Reason===reason)continue;
            // Legacy reporting can encode an internal transfer in Reason.
            // Retain that verified meaning when the bank's wording is generic.
            if(JSON.stringify(reportingMeaning(row))!==JSON.stringify(reportingMeaning({...row,Reason:reason}))){
                preservedFinancialMeaning++;continue;
            }
            const verified=await db.get('SELECT * FROM verified_history_entries WHERE userId=? AND transactionId=?',[userId,row.id]);
            await db.run('UPDATE transactions SET Reason=? WHERE id=? AND userId=?',[reason,row.id,userId]);
            await lockFields(db,userId,row.id,{Reason:reason},proof,now);
            // A recovery of this row must retain the reviewed bank wording too.
            if(verified){
                const facts={...JSON.parse(verified.factsJson),Reason:reason};
                const basis={...JSON.parse(verified.basisJson),descriptionReview:{externalId,reviewedAt:now}};
                await db.run('UPDATE verified_history_entries SET factsJson=?,basisJson=? WHERE userId=? AND transactionId=?',[JSON.stringify(facts),JSON.stringify(basis),userId,row.id]);
            }
            await db.run(`INSERT INTO agent_audit_log(userId,action,status,details,createdAt) VALUES(?,'bank_description_repair','success',?,?)`,
                [userId,JSON.stringify({transactionId:row.id,beforeReason:row.Reason,afterReason:reason,previousCounterpartyName:row.CounterpartyName,previousVerified:verified||null,evidence:proof}),now]);
            updated++;
        }
    });
    return {updated,addedEvidence,preservedFinancialMeaning};
}
module.exports={repairBankDescriptions,identityFields,reportingMeaning};
