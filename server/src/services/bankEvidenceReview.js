// Operations for an explicitly reviewed repair plan. No inference or network IO.
async function lockFields(db, userId, id, fields, evidence, now) {
    const previous = await db.get('SELECT fieldsJson FROM transaction_overrides WHERE transactionId=? AND userId=?',[id,userId]);
    const locked = {...JSON.parse(previous?.fieldsJson || '{}'),...fields};
    // A later bank confirmation must be able to settle an authorization.
    if (fields.PostingStatus && fields.PostingStatus !== 'posted') delete locked.PostingStatus;
    await db.run(`INSERT INTO transaction_overrides(transactionId,userId,fieldsJson,evidence,updatedAt) VALUES(?,?,?,?,?)
        ON CONFLICT(transactionId) DO UPDATE SET fieldsJson=excluded.fieldsJson,evidence=excluded.evidence,updatedAt=excluded.updatedAt`,
        [id,userId,JSON.stringify(locked),JSON.stringify(evidence),now]);
}
async function relinkSources(db, userId, transactionId, sources, now) {
    for (const source of sources || []) {
        const before=await db.get('SELECT * FROM transaction_sources WHERE provider=? AND externalId=? AND userId=?',[source.provider,source.externalId,userId]);
        if (!before || ![source.expectedTransactionId,transactionId].includes(before.transactionId)) throw new Error('Reviewed source mapping changed');
        await db.run('UPDATE transaction_sources SET transactionId=?,ownsTransaction=0,updatedAt=? WHERE provider=? AND externalId=? AND userId=?',[transactionId,now,source.provider,source.externalId,userId]);
    }
}
async function applyAccountReviews(db, plan, userId, now) {
    const changes=[];
    for(const merge of plan.accountMerges || []) {
        const source=await db.get('SELECT * FROM investment_accounts WHERE id=? AND userId=?',[merge.from,userId]);
        if(!source) continue;
        const target=await db.get('SELECT * FROM investment_accounts WHERE id=? AND userId=?',[merge.to,userId]);
        if(!target || source.accountRef!==merge.expectedRef || source.currency!==target.currency || source.accountType!==target.accountType || source.cashMinor!==merge.expectedCashMinor) throw new Error('Reviewed duplicate account changed');
        if(await db.get('SELECT 1 FROM investment_holdings WHERE accountId=? UNION ALL SELECT 1 FROM plaid_accounts WHERE appAccountId=? LIMIT 1',[source.id,source.id])) throw new Error('Duplicate account has holdings or a bank connection');
        const rows=await db.all('SELECT * FROM transactions WHERE userId=? AND (BalanceAccountId=? OR PortfolioAccountId=?)',[userId,source.id,source.id]);
        if(JSON.stringify(rows.map(r=>r.id).sort())!==JSON.stringify([...merge.expectedTransactionIds].sort())) throw new Error('Duplicate account activity changed');
        for(const row of rows) {
            const fields={ Account:target.accountRef, ...(row.BalanceAccountId===source.id?{BalanceAccountId:target.id}:{}), ...(row.PortfolioAccountId===source.id?{PortfolioAccountId:target.id}:{}) };
            await db.run(`UPDATE transactions SET ${Object.keys(fields).map(k=>`${k}=?`).join(',')} WHERE id=? AND userId=?`,[...Object.values(fields),row.id,userId]);
            await lockFields(db,userId,row.id,fields,merge.evidence,now);
        }
        await db.run('UPDATE account_balance_events SET accountId=?,balanceRevision=? WHERE accountId=? AND userId=?',[target.id,target.balanceRevision,source.id,userId]);
        await db.run('UPDATE portfolio_transactions SET accountId=? WHERE accountId=? AND userId=?',[target.id,source.id,userId]);
        await db.run('UPDATE portfolio_transactions SET relatedAccountId=? WHERE relatedAccountId=? AND userId=?',[target.id,source.id,userId]);
        await db.run('UPDATE balance_snapshots SET accountId=? WHERE accountId=? AND userId=?',[target.id,source.id,userId]);
        await db.run('DELETE FROM investment_accounts WHERE id=? AND userId=?',[source.id,userId]);
        changes.push({accountMerged:source,into:target.id,transactions:rows,evidence:merge.evidence});
    }
    for(const item of plan.accountCreations || []) {
        const f=item.fields;
        if(!['Savings','Chequing','TFSA','FHSA','Brokerage'].includes(f.accountType) || !/^[A-Z]{3}$/.test(f.currency) || !f.accountRef || !Number.isSafeInteger(f.cashMinor) || !f.name || !f.institution) throw new Error('Invalid verified account');
        const existing=await db.all('SELECT * FROM investment_accounts WHERE userId=? AND institution=? AND accountRef=?',[userId,f.institution,f.accountRef]);
        if(existing.length>1) throw new Error('Account identity is ambiguous');
        if(existing.length===1) {
            if(await db.get("SELECT 1 FROM balance_snapshots WHERE userId=? AND accountId=? AND source='bank_ui' AND asOf=?",[userId,existing[0].id,item.asOf])) continue;
            throw new Error('Verified account already exists; review its baseline');
        }
        const result=await db.run(`INSERT INTO investment_accounts(userId,name,institution,accountType,currency,accountRef,cashMinor,createdAt,updatedAt,balanceSource,balanceRevision,balanceAsOf,holdingsSource,holdingsAsOf)
            VALUES(?,?,?,?,?,?,?,?,?,'bank_ui',1,?,'bank_ui',?)`,[userId,f.name,f.institution,f.accountType,f.currency,f.accountRef,f.cashMinor,now,now,item.asOf,item.asOf]);
        await db.run("INSERT INTO balance_snapshots(userId,accountId,cashMinor,currency,source,asOf,createdAt) VALUES(?,?,?,?,'bank_ui',?,?)",[userId,result.lastID,f.cashMinor,f.currency,item.asOf,now]);
        changes.push({accountCreated:result.lastID,fields:f,evidence:item.evidence});
    }
    for(const item of plan.transactionAccountAssignments || []) {
        const candidates=await db.all('SELECT * FROM investment_accounts WHERE userId=? AND '+(item.accountId?'id=?':'accountRef=? AND institution=?'),item.accountId?[userId,item.accountId]:[userId,item.accountRef,item.institution]);
        const account=candidates.length===1?candidates[0]:null;
        const row=await db.get('SELECT * FROM transactions WHERE id=? AND userId=?',[item.transactionId,userId]);
        const normalize=value=>String(value||'').replace(/[^a-z0-9]/gi,'').toUpperCase();
        const bankRef=normalize(item.bankAccountRef),accountRef=normalize(account?.accountRef);
        if(!row || !account || !accountRef || (!bankRef.endsWith(accountRef) && !bankRef.replace(/(?:CAD|USD)$/,'').endsWith(accountRef)) || bankRef.length<accountRef.length ||
            account.institution!==item.institution || row.Currency!==account.currency ||
            !item.evidence || !account.balanceAsOf || !(new Date(row.Timestamp).getTime()<=new Date(account.balanceAsOf).getTime())) {
            throw new Error('Reviewed historical account assignment lacks a verified identity/baseline');
        }
        const fields={Account:account.accountRef,PortfolioAccountNumber:item.bankAccountRef,Currency:account.currency};
        if(item.balance) {fields.BalanceAccountId=account.id;fields.BalanceAccountConfidence='HIGH';}
        if(item.portfolio) {fields.PortfolioAccountId=account.id;fields.PortfolioConfidence='HIGH';}
        if(!item.balance && !item.portfolio) throw new Error('Account assignment has no ledger target');
        if(Object.entries(fields).every(([key,value])=>String(row[key])===String(value))) continue;
        for(const[key,value]of Object.entries(item.expected||{})) if(String(row[key])!==String(value)) throw new Error('Reviewed account assignment changed');
        // Historical postings are already included in the independently verified bank
        // baseline. Reassign their provenance without replaying cash or holdings.
        for(const table of [...(item.balance?['account_balance_events']:[]),...(item.portfolio?['portfolio_transactions']:[])]) {
            const events=await db.all(`SELECT * FROM ${table} WHERE sourceTransactionId=? AND userId=?`,[row.id,userId]);
            for(const event of events) {
                if(event.accountId===account.id) continue;
                const old=await db.get('SELECT * FROM investment_accounts WHERE id=? AND userId=?',[event.accountId,userId]);
                if(!old?.balanceAsOf || !(new Date(event.occurredAt).getTime()<=new Date(old.balanceAsOf).getTime())) throw new Error('Account assignment would move an unabsorbed posting');
                await db.run(`UPDATE ${table} SET accountId=?${table==='account_balance_events'?',balanceRevision=?':''} WHERE id=?`,
                    table==='account_balance_events'?[account.id,account.balanceRevision,event.id]:[account.id,event.id]);
            }
        }
        await db.run(`UPDATE transactions SET ${Object.keys(fields).map(key=>`${key}=?`).join(',')} WHERE id=? AND userId=?`,[...Object.values(fields),row.id,userId]);
        await lockFields(db,userId,row.id,fields,item.evidence,now);
        if(item.resolveReviewReason) {
            if(!['ambiguous_account','provider_currency_conflict'].includes(item.resolveReviewReason)) throw new Error('Unsupported reviewed account flag');
            const review=await db.get('SELECT reason,resolvedAt FROM transaction_ingestion_reviews WHERE transactionId=?',[row.id]);
            if(!review || review.reason!==item.resolveReviewReason) throw new Error('Reviewed ingestion flag changed');
            await db.run('UPDATE transaction_ingestion_reviews SET resolvedAt=? WHERE transactionId=?',[now,row.id]);
        }
        changes.push({accountAssignmentBefore:row,accountId:account.id,fields,evidence:item.evidence});
    }
    for(const item of plan.holdingSnapshots || []) {
        const account=await db.get('SELECT * FROM investment_accounts WHERE id=? AND userId=?',[item.accountId,userId]);
        if(!account) throw new Error('Holding account missing');
        const rows=await db.all('SELECT * FROM investment_holdings WHERE accountId=? AND userId=? ORDER BY id',[item.accountId,userId]);
        if(rows.length!==item.holdings.length) throw new Error('Holding set changed');
        if(account.holdingsSource==='bank_ui' && account.holdingsAsOf===item.asOf && item.holdings.every(h=>rows.some(r=>r.id===h.id && r.symbol===h.symbol && r.quantity===h.quantity && r.priceMicros===h.priceMicros && r.averageCostMicros===h.averageCostMicros))) continue;
        for(const h of item.holdings) {
            const old=rows.find(r=>r.id===h.id);
            if(!old || old.currency!==h.currency || !Number.isFinite(h.quantity) || h.quantity<0 || !Number.isSafeInteger(h.priceMicros) || h.priceMicros<0 || !Number.isSafeInteger(h.averageCostMicros) || h.averageCostMicros<0) throw new Error('Invalid verified holding');
            if(old.symbol===h.symbol && old.quantity===h.quantity && old.priceMicros===h.priceMicros && old.averageCostMicros===h.averageCostMicros) continue;
            if(old.symbol!==h.expected.symbol || old.quantity!==h.expected.quantity) throw new Error('Holding changed after preview');
            await db.run('UPDATE investment_holdings SET symbol=?,quantity=?,priceMicros=?,priceMinor=?,averageCostMicros=?,averageCostMinor=?,updatedAt=? WHERE id=? AND userId=?',[h.symbol,h.quantity,h.priceMicros,Math.round(h.priceMicros/10000),h.averageCostMicros,Math.round(h.averageCostMicros/10000),item.asOf,h.id,userId]);
        }
        await db.run("UPDATE investment_accounts SET holdingsSource='bank_ui',holdingsAsOf=?,holdingsReviewReason=NULL WHERE id=? AND userId=?",[item.asOf,item.accountId,userId]);
        changes.push({holdingsBefore:rows,holdingsAfter:item.holdings,accountId:item.accountId,evidence:item.evidence});
    }
    for(const item of plan.accountSnapshots || []) {
        if(await db.get("SELECT 1 FROM balance_snapshots WHERE userId=? AND accountId=? AND source='bank_ui' AND asOf=?",[userId,item.id,item.asOf])) continue;
        const before=await db.get('SELECT * FROM investment_accounts WHERE id=? AND userId=?',[item.id,userId]);
        if(!before || before.accountRef!==item.expectedRef || before.cashMinor!==item.expectedCashMinor || before.currency!==item.currency || !Number.isSafeInteger(item.cashMinor)) throw new Error('Reviewed balance changed');
        await db.run("UPDATE investment_accounts SET cashMinor=?,balanceRevision=balanceRevision+1,balanceSource='bank_ui',balanceAsOf=?,balanceReviewReason=NULL,updatedAt=? WHERE id=? AND userId=?",[item.cashMinor,item.asOf,now,item.id,userId]);
        await db.run("INSERT INTO balance_snapshots(userId,accountId,cashMinor,currency,source,asOf,createdAt) VALUES(?,?,?,?,'bank_ui',?,?)",[userId,item.id,item.cashMinor,item.currency,item.asOf,now]);
        changes.push({balanceBefore:before,balanceAfter:item.cashMinor,evidence:item.evidence});
    }
    return changes;
}
module.exports={lockFields,relinkSources,applyAccountReviews};
