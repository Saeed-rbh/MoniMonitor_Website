const learning=require('./automaticLearning');
const {createItemSyncCoordinator}=require('./itemSyncCoordinator');
const {notifyBankAction,enqueueAttentionNotice}=require('./attentionNotices');
const {workersPaused}=require('./workerLifecycle');
const parse=learning.parse;
const SIX_HOURS=6*60*60*1000;
const coordinator=createItemSyncCoordinator((item,options)=>performCare(item.itemId,options),async item=>item);
const service=()=>require('../database/dbService');

async function recordCheckpoint(userId,accountId,kind,evidence) {
    const db=await service().getDb();
    if(!await db.get('SELECT id FROM investment_accounts WHERE id=? AND userId=?',[accountId,userId])) return;
    const fingerprint=learning.hash(evidence),now=new Date().toISOString();
    await db.run(`INSERT INTO financial_checkpoints(userId,accountId,kind,fingerprint,evidenceJson,capturedAt,lastSeenAt)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(userId,accountId,kind,fingerprint) DO UPDATE SET lastSeenAt=excluded.lastSeenAt`,
        [userId,accountId,kind,fingerprint,JSON.stringify(evidence),now,now]);
}

async function resolveLearnedReviews(userId) {
    const db=await service().getDb();
    const rows=await db.all(`SELECT t.* FROM transactions t JOIN transaction_ingestion_reviews r ON r.transactionId=t.id
        WHERE t.userId=? AND r.resolvedAt IS NULL AND r.reason IN ('ambiguous_account','unconfirmed_currency')`,[userId]);
    let repaired=0;
    for(const tx of rows) {
        const sources=await service().getTransactionSourcesForUser(tx.id,userId);
        const emails=sources.filter(s=>s.provider==='email'&&s.transactionId===tx.id&&s.rawPayload?.rawBody);
        const proposals=[];
        for(const source of emails) {
            const proposed=await learning.applyLearnedAccount(userId,tx,source.rawPayload.rawBody);
            if(proposed!==tx) proposals.push(proposed);
        }
        if(!proposals.length || new Set(proposals.map(p=>p.PortfolioAccountId||p.BalanceAccountId)).size!==1) continue;
        const proposed=proposals[0],accountId=proposed.PortfolioAccountId||proposed.BalanceAccountId;
        const posting=await db.get('SELECT accountId FROM account_balance_events WHERE userId=? AND sourceTransactionId=?',[userId,tx.id]);
        const portfolio=await db.get('SELECT accountId FROM portfolio_transactions WHERE userId=? AND sourceTransactionId=? AND reversedAt IS NULL',[userId,tx.id]);
        if((posting && posting.accountId!==accountId)||(portfolio && portfolio.accountId!==accountId)) continue;
        try {
            await db.withTransaction(async()=>{
                const fields={BalanceAccountId:proposed.BalanceAccountId,BalanceAccountConfidence:'HIGH',Account:proposed.Account};
                if(proposed.PortfolioAccountId) Object.assign(fields,{PortfolioAccountId:proposed.PortfolioAccountId,PortfolioConfidence:'HIGH',PortfolioAccountNumber:proposed.PortfolioAccountNumber});
                await service().updateTransactionForUser(tx.id,userId,fields);
                const current=await service().getTransactionById(tx.id,userId);
                if(current.BalanceAccountId!==accountId || (fields.PortfolioAccountId && current.PortfolioAccountId!==accountId)) return;
                await db.run('UPDATE transaction_ingestion_reviews SET resolvedAt=? WHERE transactionId=?',[new Date().toISOString(),tx.id]);
                const result=await service().syncTransactionAccountBalance(userId,tx.id,{accountId,confidence:'HIGH'});
                if(['ambiguous_account','unmatched_account','review_required'].includes(result.status)) throw new Error('Learned account posting still requires evidence');
                await service().writeAgentAudit(userId,'learned_account_assignment','success',{transactionId:tx.id,accountId});
                repaired++;
            });
        } catch(error) {
            await service().writeAgentAudit(userId,'learned_account_assignment','deferred',{transactionId:tx.id,error:error.message});
        }
    }
    return repaired;
}

async function reconcileExistingSources(userId) {
    const db=await service().getDb(),plaid=require('./plaidService');
    const rows=await db.all(`SELECT s.*,t.* FROM transaction_sources s JOIN transactions t ON t.id=s.transactionId AND t.userId=s.userId
        WHERE s.userId=? AND s.provider IN ('plaid','plaid_investments') AND t.SourceEmailKey IS NULL AND t.PostingStatus='posted'`,[userId]);
    let matched=0;
    for(const source of rows) {
        const context=parse(source.contextPayloadJson),raw=parse(source.rawPayloadJson);
        if(context.providerRemoved || raw.pending || !context.account?.appAccountId) continue;
        const incoming=source.provider==='plaid'?plaid.toAppTransaction(raw,context.account,context.institutionName):
            plaid.toAppInvestmentTransaction(raw,context.account,context.security||{},context.institutionName);
        if(!incoming || incoming.Currency!==source.Currency) continue;
        if(await db.get('SELECT transactionId FROM transaction_overrides WHERE transactionId=? AND userId=?',[source.transactionId,userId]) ||
            await db.get('SELECT id FROM portfolio_transactions WHERE sourceTransactionId=? AND userId=? AND reversedAt IS NULL',[source.transactionId,userId])) continue;
        const result=await require('./transactionDeduplication').findTransactionMatchResult(db,userId,incoming,{
            excludeTransactionId:source.transactionId,incomingProvider:source.provider,mode:source.provider==='plaid'?'bank':'investment'});
        const canonical=result.match;
        if(!canonical?.SourceEmailKey) continue;
        const sameAccount=Number(canonical.PortfolioAccountId||canonical.BalanceAccountId)===Number(incoming.PortfolioAccountId||incoming.BalanceAccountId);
        const sameReference=incoming.ReferenceNumber && canonical.ReferenceNumber===incoming.ReferenceNumber;
        const sameTrade=source.provider==='plaid_investments' && sameAccount && ['BUY','SELL'].includes(incoming.PortfolioAction) &&
            incoming.PortfolioSymbol===canonical.PortfolioSymbol && incoming.PortfolioAction===canonical.PortfolioAction &&
            Math.abs(Number(incoming.PortfolioQuantity)-Number(canonical.PortfolioQuantity))<1e-8 &&
            String(incoming.Timestamp).slice(0,10)===String(canonical.Timestamp).slice(0,10);
        if(!sameAccount || !(sameReference||sameTrade)) continue;
        const other=await db.all('SELECT * FROM transaction_sources WHERE userId=? AND transactionId=? AND provider=?',[userId,canonical.id,source.provider]);
        if(other.some(s=>!parse(s.contextPayloadJson).providerRemoved)) continue;
        await db.withTransaction(async()=>{
            // Preserve the duplicate row and its old source assignment in the source-history trigger.
            await service().updateTransactionForUser(canonical.id,userId,plaid.plaidCanonicalUpdates(canonical,incoming));
            await service().upsertTransactionSource({userId,provider:source.provider,externalId:source.externalId,transactionId:canonical.id,
                itemId:source.itemId,ownsTransaction:false,rawPayload:raw,contextPayload:{...context,previousTransactionId:source.transactionId}});
            await service().updateTransactionForUser(source.transactionId,userId,{PostingStatus:'unposted'});
            await service().syncTransactionAccountBalance(userId,source.transactionId);
            await service().syncTransactionAccountBalance(userId,canonical.id,{accountId:incoming.BalanceAccountId,confidence:'HIGH'});
            await service().writeAgentAudit(userId,'automatic_source_match','success',{
                canonicalId:canonical.id,retainedTransactionId:source.transactionId,provider:source.provider,externalId:source.externalId});
            matched++;
        });
    }
    return matched;
}

async function reuseReviewedCorrections(userId) {
    const db=await service().getDb();
    const rows=await db.all(`SELECT t.*,o.fieldsJson,o.evidence,o.updatedAt reviewedAt FROM transaction_overrides o
        JOIN transactions t ON t.id=o.transactionId AND t.userId=o.userId WHERE o.userId=?`,[userId]);
    let reused=0;
    for(const row of rows) {
        const sources=await db.all('SELECT * FROM transaction_sources WHERE userId=? AND transactionId=?',[userId,row.id]);
        const fields=parse(row.fieldsJson),fingerprint=require('./reliabilityReview').fingerprint(row,sources);
        const assessment=require('./financialReliability').assessTransaction(row,sources,{fieldsJson:row.fieldsJson});
        for(const issue of assessment.issues) {
            const alreadyChosen=issue.kind==='currency_conflict' && fields.Currency===row.Currency ||
                issue.kind==='amount_conflict' && (fields.AmountMinor===row.AmountMinor || fields.Amount!=null && Math.round(Number(fields.Amount)*100)===row.AmountMinor) ||
                ['direction_conflict','refund_direction'].includes(issue.kind) && fields.AccountFlow===row.AccountFlow ||
                issue.kind==='credit_as_expense' && fields.Category===row.Category;
            if(!alreadyChosen) continue;
            const result=await db.run('INSERT OR IGNORE INTO reliability_reviews VALUES (?,?,?,?,?)',
                [userId,issue.key,fingerprint,'existing-reviewed-correction',row.reviewedAt]);
            reused+=result.changes;
        }
    }
    return reused;
}

async function consistencyChecks(userId) {
    const db=await service().getDb(),checks=[];
    const accounts=await db.all('SELECT * FROM investment_accounts WHERE userId=?',[userId]);
    for(const account of accounts) {
        for(const kind of ['cash','holdings']) {
            const checkpoint=await db.get(`SELECT * FROM financial_checkpoints WHERE userId=? AND accountId=? AND kind=?
                ORDER BY lastSeenAt DESC,id DESC LIMIT 1`,[userId,account.id,kind]);
            if(!checkpoint) continue;
            const expected=parse(checkpoint.evidenceJson);
            if(kind==='cash') {
                if(expected.currency!==account.currency || !Number.isSafeInteger(expected.cashMinor)) continue;
                checks.push({key:`cash:${account.id}`,accountId:account.id,kind:'cash_snapshot',status:expected.cashMinor===account.cashMinor?'agrees':'conflict',
                    expectedMinor:expected.cashMinor,actualMinor:account.cashMinor,basis:'Provider snapshot comparison; not statement-cutoff reconciliation'});
            } else {
                const actual=await db.all('SELECT symbol,currency,quantity FROM investment_holdings WHERE userId=? AND accountId=?',[userId,account.id]);
                const keys=new Set([...actual,...(expected.positions||[])].map(h=>`${h.symbol}:${h.currency}`));
                const differences=[];
                for(const key of keys) {
                    const row=actual.find(h=>`${h.symbol}:${h.currency}`===key),gold=expected.positions.find(h=>`${h.symbol}:${h.currency}`===key);
                    const difference=Number(row?.quantity||0)-Number(gold?.quantity||0);
                    if(Math.abs(difference)>1e-8) differences.push({security:key,difference});
                }
                checks.push({key:`holdings:${account.id}`,accountId:account.id,kind:'holdings_snapshot',status:differences.length?'conflict':'agrees',differences});
            }
        }
    }
    const duplicates=await db.all(`SELECT e.sourceTransactionId,e.accountId FROM account_balance_events e
        JOIN investment_accounts a ON a.id=e.accountId AND a.userId=e.userId
        JOIN portfolio_transactions p ON p.sourceTransactionId=e.sourceTransactionId AND p.userId=e.userId AND p.accountId=e.accountId
        WHERE e.userId=? AND e.balanceRevision=a.balanceRevision AND p.reversedAt IS NULL AND e.deltaMinor<>0 AND p.amountMinor<>0`,[userId]);
    for(const row of duplicates) checks.push({key:`effects:${row.sourceTransactionId}`,kind:'duplicate_financial_effect',status:'conflict',transactionId:row.sourceTransactionId,accountId:row.accountId});
    const transfers=await db.all(`SELECT ReferenceNumber,Currency,COUNT(*) legs,
        SUM(CASE AccountFlow WHEN 'IN' THEN AmountMinor WHEN 'OUT' THEN -AmountMinor ELSE 0 END) differenceMinor
        FROM transactions WHERE userId=? AND Category='Internal' AND PostingStatus='posted' AND ReferenceNumber LIKE 'XFER-%'
        GROUP BY ReferenceNumber,Currency`,[userId]);
    for(const row of transfers) checks.push({key:`transfer:${row.ReferenceNumber}:${row.Currency}`,kind:'transfer_cash',status:row.legs>=2&&row.differenceMinor===0?'agrees':'incomplete',legs:row.legs,differenceMinor:row.differenceMinor});
    return checks;
}

async function scheduleRecovery(userId,now=Date.now(),{kick=true}={}) {
    if(workersPaused()) return 0;
    const plaid=require('./plaidService');
    if(!plaid.isConfigured()) return 0;
    const db=await service().getDb(),items=await db.all('SELECT * FROM plaid_items WHERE userId=?',[userId]);
    let queued=0;
    for(const item of items) {
        await notifyBankAction(userId,item);
        if(['login_required','attention_required'].includes(item.status)) continue;
        const stale=!Number.isFinite(Date.parse(item.lastSyncedAt)) || now-Date.parse(item.lastSyncedAt)>SIX_HOURS;
        const unfinished=['error','pending'].includes(item.holdingsStatus)||['error','pending'].includes(item.investmentTransactionsStatus);
        if(!stale && item.status!=='sync_error' && !unfinished) continue;
        if(await db.get("SELECT id FROM plaid_webhook_events WHERE itemId=? AND status IN ('pending','retry','processing') LIMIT 1",[item.itemId])) continue;
        await plaid.enqueueImmediateReconciliation(db,item.itemId,{backfillSources:false,forceHoldings:unfinished});queued++;
    }
    if(queued && kick) plaid.kickPlaidWebhookWorker();
    return queued;
}

async function performCare(userId,{force=false}={}) {
    const db=await service().getDb();
    const previous=await db.get('SELECT * FROM automatic_care_runs WHERE userId=?',[userId]);
    if(!force && previous && !previous.lastError && Date.now()-Date.parse(previous.checkedAt)<15*60000) return parse(previous.reportJson);
    try {
        const reviewedPreferences=await learning.learnReviewedPreferences(userId);
        const storedSources=await require('./plaidService').refreshStoredPlaidSourceDetails(userId,{includeLinked:true});
        let learned=await learning.learnAccountMappings(userId);
        let assigned=await resolveLearnedReviews(userId);
        const sourceMatches=await reconcileExistingSources(userId);
        if(sourceMatches) { learned=await learning.learnAccountMappings(userId); assigned+=await resolveLearnedReviews(userId); }
        const reusedReviews=await reuseReviewedCorrections(userId);
        const checks=await consistencyChecks(userId);
        const recoveryQueued=await scheduleRecovery(userId);
        const report={checkedAt:new Date().toISOString(),learned,assigned,sourceMatches,storedSources,reviewedPreferences,reusedReviews,checks,recoveryQueued};
        await db.run(`INSERT INTO automatic_care_runs VALUES (?,?,?,NULL) ON CONFLICT(userId)
            DO UPDATE SET checkedAt=excluded.checkedAt,reportJson=excluded.reportJson,lastError=NULL`,[userId,report.checkedAt,JSON.stringify(report)]);
        await require('./financialReliability').checkFinancialReliability(userId,{force:true});
        for(const check of checks.filter(c=>c.kind==='duplicate_financial_effect')) {
            await enqueueAttentionNotice(userId,check.key,check,'A transaction has conflicting cash postings. Your records have been retained; open Transactions to review the account posting.');
        }
        return report;
    } catch(error) {
        await db.run(`INSERT INTO automatic_care_runs VALUES (?,?,?,?) ON CONFLICT(userId)
            DO UPDATE SET checkedAt=excluded.checkedAt,lastError=excluded.lastError`,[userId,new Date().toISOString(),previous?.reportJson||'{}',error.message]);
        throw error;
    }
}
function runAutomaticCare(userId,options={}) { return coordinator.sync({itemId:String(userId)},options,Boolean(options.force)); }
module.exports={reuseReviewedCorrections,reconcileExistingSources,recordCheckpoint,resolveLearnedReviews,consistencyChecks,scheduleRecovery,runAutomaticCare};
