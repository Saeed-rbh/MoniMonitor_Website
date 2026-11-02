const parse=v=>JSON.parse(v||'{}');
const protectedFields=['Amount','AmountMinor','Currency','Category','Label','Reason','AccountFlow','PortfolioAction','PortfolioSymbol','PortfolioQuantity','PortfolioPrice','PostingStatus','BalanceAccountId','BalanceAccountConfidence','PortfolioAccountId','PortfolioAccountNumber','PortfolioConfidence','Account','Type','BankName','Timestamp','CashDate','ReferenceNumber'];
async function restoreVerifiedHistory(userId){
 const service=require('../database/dbService'),db=await service.getDb();let restored=0;
 const rows=await db.all(`SELECT v.* FROM verified_history_entries v LEFT JOIN transactions t ON t.id=v.transactionId
  WHERE v.userId=? AND t.id IS NULL`,[userId]);
 for(const entry of rows)await db.withTransaction(async()=>{
  if(await db.get('SELECT id FROM transactions WHERE id=?',[entry.transactionId]))return;
  const facts=parse(entry.factsJson),cols=(await db.all('PRAGMA table_info(transactions)')).map(c=>c.name);
  const keys=Object.keys(facts).filter(k=>cols.includes(k));
  if(facts.userId!==userId||facts.id!==entry.transactionId)throw Error('Verified history identity mismatch');
  await db.run(`INSERT INTO transactions(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,keys.map(k=>facts[k]));
  await service.upsertTransactionSource({userId,transactionId:facts.id,provider:'bank_checkpoint',externalId:`verified:${userId}:${facts.id}`,ownsTransaction:false,
   rawPayload:{facts,basis:parse(entry.basisJson)},contextPayload:{reviewed:true,historyOnly:true}});
  // Keep the original native identities as inactive evidence. A provider can
  // reactivate its own ID later without manufacturing a second history row.
  for(const source of parse(entry.basisJson).retainedSources||[]){
   if(source.userId!==userId||source.transactionId!==facts.id||!['plaid','plaid_investments'].includes(source.provider))throw Error('Invalid retained source owner');
   if(await db.get('SELECT 1 FROM transaction_sources WHERE provider=? AND externalId=?',[source.provider,source.externalId]))continue;
   await service.upsertTransactionSource({userId,transactionId:facts.id,provider:source.provider,externalId:source.externalId,itemId:source.itemId,ownsTransaction:false,
    rawPayload:parse(source.rawPayloadJson),contextPayload:{...parse(source.contextPayloadJson),providerRemoved:true,recoveredFromCheckpoint:true,originalCreatedAt:source.createdAt}});
  }
  await service.updateTransactionForUser(facts.id,userId,Object.fromEntries(protectedFields.filter(k=>Object.hasOwn(facts,k)).map(k=>[k,facts[k]])),{reviewed:true});
  await service.writeAgentAudit(userId,'verified_history_restored','success',{transactionId:facts.id,basis:parse(entry.basisJson)});restored++;
 });
 return restored;
}
async function checkVerifiedLedgers(userId){
 const db=await require('../database/dbService').getDb(),out=[];
 for(const control of await db.all('SELECT c.*,a.accountType,a.cashMinor currentCash,a.balanceAsOf,a.balanceSource FROM verified_ledger_controls c JOIN investment_accounts a ON a.id=c.accountId AND a.userId=c.userId WHERE c.userId=?',[userId])){
  const dateBasis=parse(control.basisJson).dateBasis==='settlement'?'settlement':'transaction';
  const dateColumn=dateBasis==='settlement'?"COALESCE(t.CashDate,substr(t.Timestamp,1,10))":"substr(t.Timestamp,1,10)";
  const row=await db.get(`SELECT COALESCE(SUM(CASE COALESCE(t.AccountFlow,CASE t.Category WHEN 'Income' THEN 'IN' WHEN 'Expense' THEN 'OUT' ELSE 'NONE' END)
   WHEN 'IN' THEN t.AmountMinor WHEN 'OUT' THEN -t.AmountMinor ELSE 0 END),0) amount
   FROM transactions t LEFT JOIN verified_history_entries v ON v.transactionId=t.id AND v.userId=t.userId
   JOIN investment_accounts a ON a.id=? AND a.userId=t.userId
   WHERE t.userId=? AND COALESCE(t.BalanceAccountId,t.PortfolioAccountId,v.accountId)=a.id
   AND t.Currency=a.currency AND t.PostingStatus='posted' AND ${dateColumn}<=?`,[control.accountId,userId,control.cutoffDate]);
  const actualMinor=row.amount*(control.accountType==='Credit Card'?-1:1);
  out.push({key:`verified-ledger:${control.accountId}:${control.cutoffDate}`,kind:'verified_ledger',accountId:control.accountId,
   cutoffDate:control.cutoffDate,dateBasis,expectedMinor:control.cashMinor,actualMinor,differenceMinor:actualMinor-control.cashMinor,status:actualMinor===control.cashMinor?'agrees':'conflict'});
 }
 return out;
}
module.exports={restoreVerifiedHistory,checkVerifiedLedgers,protectedFields};
