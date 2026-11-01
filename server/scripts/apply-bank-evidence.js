// Reviewed bank evidence only. Preview by default; --apply requires a backup
// made with VACUUM INTO. No API workers or startup migrations are invoked.
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { protectConnection } = require('../src/database/transactionConnection');
const { mergeTransactionRows } = require('../src/services/transactionDeduplication');
const { lockFields, relinkSources, applyAccountReviews } = require('../src/services/bankEvidenceReview');
const { refreshMonthlySummary } = require('../src/database/monthlySummaries');
async function repair(db, plan, userId) {
    const changes = [], months = new Set(), now = new Date().toISOString();
    const get = async id => {
        const row = await db.get('SELECT * FROM transactions WHERE id=? AND userId=?', [id,userId]);
        if (!row) throw new Error(`Missing reviewed transaction ${id}`);
        months.add(row.Timestamp.slice(0,7)); return row;
    };
    for (const change of plan.updates) {
        const before = await get(change.id);
        if (Object.entries(change.fields).every(([k,v]) => String(before[k]) === String(v))) continue;
        for (const [k,v] of Object.entries(change.expected)) if (String(before[k]) !== String(v)) throw new Error(`Evidence changed: ${change.id} ${k}`);
        if (change.reverseAbsorbedPortfolio) {
            const events = await db.all('SELECT e.*, a.balanceSource, a.balanceAsOf, a.balanceRevision AS currentRevision, a.holdingsSource, a.holdingsAsOf FROM account_balance_events e JOIN investment_accounts a ON a.id=e.accountId WHERE e.sourceTransactionId=? AND e.userId=?',[before.id,userId]);
            if (!events.length || events.some(e => e.balanceSource !== 'plaid' || e.holdingsSource !== 'plaid' || e.balanceAsOf <= before.Timestamp || e.holdingsAsOf <= before.Timestamp || e.currentRevision <= e.balanceRevision)) throw new Error('Security transfer requires a verified later balance/holdings baseline');
            await db.run('UPDATE portfolio_transactions SET reversedAt=?, reversalReason=? WHERE sourceTransactionId=? AND userId=? AND reversedAt IS NULL',[now,'Bank CSV confirms security transfer; preserve later provider cash/holdings snapshot',before.id,userId]);
            await db.run('DELETE FROM account_balance_events WHERE sourceTransactionId=? AND userId=?',[before.id,userId]);
        } else if (change.fields.Currency && change.fields.Currency !== before.Currency) {
            const conflict = await db.get(`SELECT e.id FROM account_balance_events e JOIN investment_accounts a ON a.id=e.accountId WHERE e.sourceTransactionId=? AND a.currency<>?
                UNION ALL SELECT id FROM portfolio_transactions WHERE sourceTransactionId=? AND reversedAt IS NULL LIMIT 1`,[before.id,change.fields.Currency,before.id]);
            if (conflict) throw new Error('Currency repair requires posting reversal');
        }
        if (change.fields.AmountMinor !== undefined && !change.reverseAbsorbedPortfolio) {
            const events = await db.all('SELECT e.*,a.balanceRevision AS currentRevision,a.balanceSource FROM account_balance_events e JOIN investment_accounts a ON a.id=e.accountId WHERE e.sourceTransactionId=? AND e.userId=?',[before.id,userId]);
            for(const event of events) {
                const delta = Math.sign(event.deltaMinor) * Number(change.fields.AmountMinor);
                if(event.balanceSource !== 'plaid' && event.balanceRevision === event.currentRevision) {
                    await db.run('UPDATE investment_accounts SET cashMinor=cashMinor+?,updatedAt=? WHERE id=? AND userId=?',[delta-event.deltaMinor,now,event.accountId,userId]);
                }
                await db.run('UPDATE account_balance_events SET deltaMinor=? WHERE id=?',[delta,event.id]);
            }
        }
        if(change.fields.Timestamp) {
            if(!/^\d{4}-\d{2}-\d{2}$/.test(change.fields.Timestamp)) throw new Error('Reviewed statement date required');
            for(const table of ['account_balance_events','portfolio_transactions']) await db.run(`UPDATE ${table} SET occurredAt=? WHERE sourceTransactionId=? AND userId=?`,[change.fields.Timestamp,before.id,userId]);
        }
        if (change.fields.PostingStatus && change.fields.PostingStatus !== 'posted') {
            const events=await db.all('SELECT e.*,a.balanceSource,a.balanceAsOf,a.balanceRevision AS currentRevision FROM account_balance_events e JOIN investment_accounts a ON a.id=e.accountId WHERE e.sourceTransactionId=? AND e.userId=?',[before.id,userId]);
            for (const event of events) {
                const covered=['bank_ui','plaid'].includes(event.balanceSource) && Date.parse(event.occurredAt)<=Date.parse(event.balanceAsOf);
                if (!covered) throw new Error('Non-posted repair requires a verified later balance baseline');
            }
            await db.run('DELETE FROM account_balance_events WHERE sourceTransactionId=? AND userId=?',[before.id,userId]);
            const pairings=await db.all('SELECT * FROM refund_pairings WHERE userId=? AND (refundTransactionId=? OR purchaseTransactionId=?)',[userId,before.id,before.id]);
            await db.run('DELETE FROM refund_pairings WHERE userId=? AND (refundTransactionId=? OR purchaseTransactionId=?)',[userId,before.id,before.id]);
            if (pairings.length) changes.push({removedNonPostedPairings:pairings,evidence:change.evidence});
        }
        const allowed = new Set(['Currency','Amount','AmountMinor','Category','Label','Reason','PortfolioAction','PortfolioSymbol','PortfolioQuantity','PortfolioPrice','AccountFlow','Timestamp','ReferenceNumber','Account','PostingStatus']);
        if (Object.keys(change.fields).some(k => !allowed.has(k))) throw new Error('Unsupported repair field');
        await db.run(`UPDATE transactions SET ${Object.keys(change.fields).map(k=>`${k}=?`).join(',')} WHERE id=? AND userId=?`,[...Object.values(change.fields),before.id,userId]);
        if (change.fields.PostingStatus && !['posted','pending','unposted'].includes(change.fields.PostingStatus)) throw new Error('Invalid posting status');
        await lockFields(db,userId,before.id,change.fields,change.evidence,now);
        changes.push({before,after:await get(before.id),evidence:change.evidence});
    }
    for (const pair of plan.merges) {
        const duplicate=await db.get('SELECT * FROM transactions WHERE id=? AND userId=?',[pair.remove,userId]);
        if (!duplicate) continue;
        for (const [k,v] of Object.entries(pair.expected)) if(String(duplicate[k])!==String(v)) throw new Error(`Duplicate changed ${duplicate.id} ${k}`);
        const canonical=await get(pair.keep); months.add(duplicate.Timestamp.slice(0,7));
        // Never replay a duplicate notification after it has been merged.
        await db.run("UPDATE telegram_outbox SET status='dead',lastError='Superseded by reviewed bank evidence merge',nextAttemptAt=NULL WHERE transactionId=? AND status IN ('pending','retry')",[duplicate.id]);
        await mergeTransactionRows(db,canonical,duplicate);
        changes.push({merged:duplicate,canonicalId:canonical.id,evidence:pair.evidence});
    }
    for (const entry of plan.imports || []) {
        if(await db.get("SELECT 1 FROM transaction_sources WHERE provider='bank_csv' AND externalId=?",[entry.key])) continue;
        const fields=entry.fields;
        if(fields.userId !== userId || !Number.isSafeInteger(fields.AmountMinor) || fields.AmountMinor<=0 || !/^[A-Z]{3}$/.test(fields.Currency)) throw new Error('Invalid bank import');
        const duplicate=await db.get(`SELECT id FROM transactions WHERE userId=? AND substr(Timestamp,1,10)=? AND AmountMinor=? AND BankName=? AND Account=? AND COALESCE(PortfolioSymbol,'')=? AND COALESCE(ReferenceNumber,'')=? AND COALESCE(AccountFlow,'')=?`,[userId,fields.Timestamp.slice(0,10),fields.AmountMinor,fields.BankName,fields.Account,fields.PortfolioSymbol||'',fields.ReferenceNumber||'',fields.AccountFlow||'']);
        if(duplicate) throw new Error(`Import requires renewed matching: ${duplicate.id}`);
        const columns=Object.keys(fields);
        if(columns.some(k=>!['userId','Amount','AmountMinor','Currency','Category','Label','Reason','Timestamp','Type','Account','BankName','AccountFlow','BalanceAccountId','BalanceAccountConfidence','PortfolioAction','PortfolioSymbol','PortfolioQuantity','PortfolioPrice','PortfolioAccountId','PortfolioConfidence','ReferenceNumber','SourceEmailKey'].includes(k))) throw new Error('Invalid import field');
        const result=await db.run(`INSERT INTO transactions(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,Object.values(fields));
        await db.run(`INSERT INTO transaction_sources(provider,externalId,userId,transactionId,ownsTransaction,createdAt,updatedAt,rawPayloadJson,contextPayloadJson,capturedAt) VALUES('bank_csv',?,?,?,1,?,?,?,?,?)`,[entry.key,userId,result.lastID,now,now,JSON.stringify(entry.evidence),JSON.stringify({reviewed:true,posting:'history_only_preserve_balance_baseline'}),now]);
        await relinkSources(db,userId,result.lastID,entry.relinkSources,now);
        const {userId: ignoredUser, ...locked}=fields;
        await lockFields(db,userId,result.lastID,locked,entry.evidence,now);
        await db.run('UPDATE investment_accounts SET balanceReviewReason=? WHERE id=? AND userId=?',['Bank history updated; verify the current balance against the bank before relying on it',fields.BalanceAccountId,userId]);
        months.add(fields.Timestamp.slice(0,7));changes.push({importedId:result.lastID,evidence:entry.evidence});
    }
    for (const item of plan.reviewResolutions || []) {
        await get(item.id);
        const review = await db.get('SELECT * FROM transaction_ingestion_reviews WHERE transactionId=?',[item.id]);
        if (!review || review.reason !== item.expectedReason || !item.evidence) throw new Error('Reviewed ingestion flag changed');
        if (review.resolvedAt) continue;
        await db.run('UPDATE transaction_ingestion_reviews SET resolvedAt=? WHERE transactionId=?',[now,item.id]);
        changes.push({reviewResolved:item.id,reason:review.reason,evidence:item.evidence});
    }
    changes.push(...await applyAccountReviews(db,plan,userId,now));
    for (const month of months) await refreshMonthlySummary(db,userId,month);
    if(changes.length) await db.run("INSERT INTO agent_audit_log(userId,action,status,details,createdAt) VALUES(?,'bank_evidence_repair','success',?,?)",[userId,JSON.stringify(changes),now]);
    return changes;
}
async function main() {
    const [filename,planPath,userId] = process.argv.slice(2).filter(a=>a!=='--apply');
    if(!filename||!planPath||!userId) throw new Error('Usage: node apply-bank-evidence.js DB PLAN USER [--apply]');
    const apply=process.argv.includes('--apply');
    const db=await open({filename,driver:sqlite3.Database});db.configure('busyTimeout',10000);protectConnection(db);
    try {
        if(apply) { const backup=path.resolve(`${filename}.before-bank-evidence-${Date.now()}.sqlite`);await db.exec(`VACUUM INTO '${backup.replace(/'/g,"''")}'`);console.log('Backup:',backup); }
        await db.exec('PRAGMA foreign_keys=ON');
        let changes;
        try { await db.withTransaction(async()=>{ changes=await repair(db,JSON.parse(fs.readFileSync(planPath,'utf8')),userId); if(!apply) throw new Error('PREVIEW_ROLLBACK'); }); }
        catch(e){if(e.message!=='PREVIEW_ROLLBACK')throw e;}
        console.log(JSON.stringify({applied:apply,updates:changes.filter(c=>c.after).length,merges:changes.filter(c=>c.merged).length,imports:changes.filter(c=>c.importedId).length,accountReviews:changes.filter(c=>c.balanceBefore||c.accountMerged||c.holdingsBefore||c.accountCreated).length}));
        console.log('Integrity:',await db.get('PRAGMA integrity_check'));
        const foreign=await db.all('PRAGMA foreign_key_check');if(foreign.length)throw new Error('Foreign key check failed');
    } finally {await db.close();}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={repair};
