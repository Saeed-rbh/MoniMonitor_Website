// Reconnection identity is anchored in retained bank proof, never amount alone.
const parse=v=>{try{return JSON.parse(v||'{}')}catch{return {}}};
const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function nativeIdentity(raw,context,provider){
 return JSON.stringify([provider,Number(context.account?.appAccountId),raw.date,raw.iso_currency_code||raw.unofficial_currency_code,
  raw.amount,raw.type||'',raw.subtype||'',norm(raw.original_description||raw.name),context.security?.ticker_symbol||'',raw.quantity||0]);
}
async function findRetainedSourceMatch(db,userId,provider,raw,context,{excludeTransactionId=-1}={}){
 const accountId=context.account?.appAccountId,currency=raw.iso_currency_code||raw.unofficial_currency_code;
 if(!accountId||!currency||!Number.isFinite(raw.amount)||raw.pending)return null;
 const minor=Math.round(Math.abs(raw.amount)*100),day=raw.date;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day||''))return null;
 const rows=await db.all(`SELECT s.*,t.* FROM transaction_sources s JOIN transactions t ON t.id=s.transactionId AND t.userId=s.userId
  WHERE s.userId=? AND t.id<>? AND t.PostingStatus='posted' AND t.AmountMinor=? AND t.Currency=?
  AND COALESCE(t.BalanceAccountId,t.PortfolioAccountId)=? AND ABS(julianday(substr(t.Timestamp,1,10))-julianday(?))<=3
  AND s.provider IN (?, 'bank_csv')`,[userId,excludeTransactionId,minor,currency,accountId,day,provider]);
 const matches=new Map();let alreadyClaimed=false;
 for(const row of rows){const old=parse(row.rawPayloadJson),ctx=parse(row.contextPayloadJson);
  if(row.provider===provider){
   if(old.account_id===raw.account_id&&!ctx.providerRemoved&&nativeIdentity(old,ctx,provider)===nativeIdentity(raw,context,provider)){
    alreadyClaimed=true;continue;
   }
   const verified=await db.get('SELECT accountId FROM verified_history_entries WHERE userId=? AND transactionId=?',[userId,row.id]);
   const priorContext=verified?.accountId===Number(accountId)&&norm(ctx.account?.mask)===norm(context.account?.mask)
     ? {...ctx,account:{...ctx.account,appAccountId:accountId}}:ctx;
   if(Number(priorContext.account?.appAccountId)!==Number(accountId)||!old.account_id||old.account_id===raw.account_id)continue;
   if(nativeIdentity(old,priorContext,provider)===nativeIdentity(raw,context,provider))matches.set(row.id,row);
  }else if(provider==='plaid'&&ctx.reviewed&&row.Category==='Internal'){
   const bank=old.row||{},bankMinor=bank.net_cash_amount==null?null:Math.round(Number(bank.net_cash_amount)*100);
   const flow=raw.amount>0?'OUT':'IN',description=norm(raw.original_description||raw.name);
   const bankDescription=norm(bank.description);
   const bankDirection=bankMinor>0?'IN':'OUT';
   // Reviewed complete bank export and explicit account-transfer wording.
   // The uniqueness check below refuses equal repeated transfers in the window.
   const explicitTransfer=/^(transferout|transferin)$/.test(description)&&/moneytransfer/.test(bankDescription);
   const verifiedPeer=old.websiteVerified&&old.counterpartEvidence&&
     (String(old.counterpartEvidence).match(/[A-Za-z]{4,}/g)||[]).some(w=>!['bank','page','names','transfer','from','into','account','verified'].includes(w.toLowerCase())&&description.includes(norm(w)));
   if(bankMinor!==null&&Math.abs(bankMinor)===minor&&flow===row.AccountFlow&&flow===bankDirection&&
     (explicitTransfer||verifiedPeer))matches.set(row.id,row);
  }
 }
 return !alreadyClaimed&&matches.size===1?[...matches.values()][0]:null;
}
module.exports={findRetainedSourceMatch,nativeIdentity};
