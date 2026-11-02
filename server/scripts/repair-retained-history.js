// A private, reviewed evidence plan; no history deletion or database restore.
const fs=require('fs'),path=require('path');
async function applyPlan(db,userId,plan){
 const service=require('../src/database/dbService'),{protectedFields,restoreVerifiedHistory}=require('../src/services/verifiedHistory');
 if(plan.userId!==userId||!plan.basis?.checkpointSha256||!Array.isArray(plan.entries)||!Array.isArray(plan.controls))throw Error('Verified bank evidence is required');
 const now=new Date().toISOString();let updated=0;
 for(const entry of plan.entries){
  const t=entry.transaction;if(t.userId!==userId||!Number.isSafeInteger(t.id))throw Error('Invalid history owner');
  await db.run('INSERT OR IGNORE INTO verified_history_entries VALUES(?,?,?,?,?,?)',[userId,t.id,entry.accountId,JSON.stringify(t),JSON.stringify({...plan.basis,retainedSources:entry.sources||[]}),now]);
 }
 for(const c of plan.controls){
  if(!Number.isSafeInteger(c.cashMinor)||!/^\d{4}-\d{2}-\d{2}$/.test(c.cutoffDate||plan.cutoffDate||''))throw Error('Invalid bank closing control');
  if(!await db.get('SELECT id FROM investment_accounts WHERE id=? AND userId=?',[c.accountId,userId]))throw Error('Control account not found');
  await db.run('INSERT OR IGNORE INTO verified_ledger_controls VALUES(?,?,?,?,?)',[userId,c.accountId,c.cutoffDate||plan.cutoffDate,c.cashMinor,JSON.stringify({...plan.basis,...c.basis})]);
 }
 const restored=await restoreVerifiedHistory(userId);
 for(const change of plan.updates||[]){
  const row=await db.get('SELECT * FROM transactions WHERE id=? AND userId=?',[change.id,userId]);if(!row)throw Error('History correction missing row');
  if(Object.entries(change.fields).every(([k,v])=>row[k]===v))continue;
  for(const[k,v]of Object.entries(change.expected))if(row[k]!==v&&row[k]!==change.fields[k])throw Error(`Financial facts changed: ${change.id} ${k}`);
  if(Object.keys(change.fields).some(k=>!protectedFields.includes(k)))throw Error('Unsupported reviewed field');
  await service.updateTransactionForUser(change.id,userId,change.fields,{reviewed:true});
  const postingHistory={};
  if(change.fields.Timestamp||change.fields.CashDate){
   postingHistory.balance=await db.all('SELECT * FROM account_balance_events WHERE userId=? AND sourceTransactionId=?',[userId,change.id]);
   postingHistory.portfolio=await db.all('SELECT * FROM portfolio_transactions WHERE userId=? AND sourceTransactionId=?',[userId,change.id]);
   const current=await db.get('SELECT Timestamp,CashDate FROM transactions WHERE id=? AND userId=?',[change.id,userId]);
   await db.run('UPDATE account_balance_events SET occurredAt=? WHERE userId=? AND sourceTransactionId=?',[current.CashDate||current.Timestamp,userId,change.id]);
   if(change.fields.Timestamp)await db.run('UPDATE portfolio_transactions SET occurredAt=? WHERE userId=? AND sourceTransactionId=?',[current.Timestamp,userId,change.id]);
  }
  if(change.source){
   if(change.source.provider!=='bank_csv'||!change.source.externalId||!change.source.rawPayload)throw Error('Invalid reviewed bank source');
   const existing=await db.get('SELECT userId,transactionId FROM transaction_sources WHERE provider=? AND externalId=?',[change.source.provider,change.source.externalId]);
   if(existing&&(existing.userId!==userId||existing.transactionId!==change.id))throw Error('Bank evidence already belongs to another transaction');
   await service.upsertTransactionSource({...change.source,userId,transactionId:change.id,ownsTransaction:false,contextPayload:{...change.source.contextPayload,reviewed:true}});
  }
  const verified=await db.get('SELECT * FROM verified_history_entries WHERE userId=? AND transactionId=?',[userId,change.id]);
  if(verified)await db.run('UPDATE verified_history_entries SET factsJson=?,verifiedAt=? WHERE userId=? AND transactionId=?',
   [JSON.stringify({...JSON.parse(verified.factsJson),...change.fields}),now,userId,change.id]);
  await service.writeAgentAudit(userId,'verified_history_correction','success',{before:row,fields:change.fields,basis:plan.basis,evidence:change.evidence,previousVerifiedFacts:verified?.factsJson,postingHistory});updated++;
 }
 for(const correction of plan.snapshots||[]){
  const a=await db.get('SELECT * FROM investment_accounts WHERE id=? AND userId=?',[correction.accountId,userId]);
  if(a.cashMinor===correction.cashMinor)continue;
  if(a.cashMinor!==correction.expectedCashMinor||a.balanceAsOf!==correction.expectedAsOf||a.balanceSource!=='bank_ui')throw Error('Snapshot changed since bank evidence review');
  await db.run('UPDATE investment_accounts SET cashMinor=?,updatedAt=? WHERE id=? AND userId=?',[correction.cashMinor,now,a.id,userId]);
  await db.run('INSERT INTO balance_snapshots(userId,accountId,cashMinor,currency,source,asOf,createdAt) VALUES(?,?,?,?,?,?,?)',[userId,a.id,correction.cashMinor,a.currency,'bank_evidence_repair',a.balanceAsOf,now]);
  await service.writeAgentAudit(userId,'verified_snapshot_correction','success',{before:a,afterMinor:correction.cashMinor,basis:plan.basis});
 }
 if(plan.requireControlAgreement){
  const checks=await require('../src/services/verifiedHistory').checkVerifiedLedgers(userId);
  const conflicts=checks.filter(c=>c.status!=='agrees');
  if(conflicts.length)throw Error(`Bank closing controls do not reconcile: ${conflicts.map(c=>`${c.accountId}:${c.cutoffDate}`).join(',')}`);
 }
 return {restored,updated};
}
async function main(){
 const [filename,planPath,userId]=process.argv.slice(2).filter(x=>x!=='--apply');if(!filename||!planPath||!userId)throw Error('Usage: node repair-retained-history.js DB PLAN USER [--apply]');
 process.env.MONIMONITOR_DB_PATH=path.resolve(filename);const db=await require('../src/database/dbService').getDb();const apply=process.argv.includes('--apply');
 try{
  if(apply){const backup=path.resolve(`${filename}.before-retained-history-${Date.now()}.sqlite`);await db.exec(`VACUUM INTO '${backup.replace(/'/g,"''")}'`);console.log('Backup:',backup);}
  let result;try{await db.withTransaction(async()=>{result=await applyPlan(db,userId,JSON.parse(fs.readFileSync(planPath)));if(!apply)throw Error('PREVIEW_ROLLBACK');});}catch(e){if(e.message!=='PREVIEW_ROLLBACK')throw e;}
  console.log(JSON.stringify({applied:apply,...result}));
 }finally{await db.close();}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});module.exports={applyPlan};
