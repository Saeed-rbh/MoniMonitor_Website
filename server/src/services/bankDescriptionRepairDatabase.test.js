const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'moni-bank-description-'));
process.env.MONIMONITOR_DB_PATH=path.join(directory,'test.sqlite');
const service=require('../database/dbService');
const {repairBankDescriptions,identityFields}=require('./bankDescriptionRepair');
let db;const user='description-owner';
test.before(async()=>{db=await service.getDb();await service.createUser(user,user,'unused');});
test.after(async()=>{await db.close();fs.rmSync(directory,{recursive:true,force:true});});
async function fixture(description,index=0){
 const id=await service.addTransaction({userId:user,Amount:42,Currency:'CAD',Category:'Expense',Label:'Personal Transfers',Reason:'E-Transfer via Example Chequing',Timestamp:'2026-10-01',AccountFlow:'OUT'});
 const row=await db.get('SELECT * FROM transactions WHERE id=?',[id]);
 await db.run('INSERT INTO verified_history_entries VALUES(?,?,?,?,?,?)',[user,id,null,JSON.stringify(row),JSON.stringify({authority:'reviewed bank checkpoint'}),'2026-10-31']);
 return {transactionId:id,expected:Object.fromEntries(identityFields.map(k=>[k,row[k]])),bank:{file:'example.csv',fileSha256:'a'.repeat(64),key:'example.csv:'+index,rowIndex:index,description,raw:{'Description 1':description,'Description 2':''}}};
}
test('repairs bank wording, preserves financial history and protects the correction on replay',async()=>{
 const entries=[await fixture('MISC PAYMENT WISE'),await fixture('E-TRANSFER - AUTODEPOSIT MARA TAYLOR C1AKFKNECQJU',1)];
 const financial=async()=>(await db.all('SELECT * FROM transactions ORDER BY id')).map(({Reason,CounterpartyName,...row})=>row);
 const before=await financial();
 assert.deepEqual(await repairBankDescriptions(db,user,entries),{updated:2,addedEvidence:2});
 assert.deepEqual(await financial(),before);
 assert.deepEqual(await repairBankDescriptions(db,user,entries),{updated:0,addedEvidence:0});
 await service.updateTransactionForUser(entries[0].transactionId,user,{Reason:'E-Transfer via Example Chequing'});
 assert.equal((await service.getTransactionById(entries[0].transactionId,user)).DisplayReason,'MISC PAYMENT WISE');
 await require('./transactionNames').enrichCounterpartyNames(user);
 assert.equal((await service.getTransactionById(entries[1].transactionId,user)).DisplayReason,'Mara Taylor');
 const verified=await db.get('SELECT factsJson FROM verified_history_entries WHERE transactionId=?',[entries[0].transactionId]);
 assert.equal(JSON.parse(verified.factsJson).Reason,'MISC PAYMENT WISE');
 const audits=await db.all("SELECT details FROM agent_audit_log WHERE action='bank_description_repair'");
 assert.equal(audits.length,2);
 assert.equal(JSON.parse(audits[0].details).beforeReason,'E-Transfer via Example Chequing');
 assert.equal((await db.get('SELECT COUNT(*) n FROM transaction_sources')).n,2);
 assert.equal((await db.get('SELECT COUNT(*) n FROM account_balance_events')).n,0);
});
test('rejects stale or incomplete identities and rolls back the entire plan',async()=>{
 const first=await fixture('MISC PAYMENT PAYPAL',2),second=await fixture('MISC PAYMENT PAYPAL',3);
 second.expected.AmountMinor=9999;
 await assert.rejects(repairBankDescriptions(db,user,[first,second]),/identity changed/);
 assert.equal((await db.get('SELECT Reason FROM transactions WHERE id=?',[first.transactionId])).Reason,first.expected.Reason);
 assert.equal((await db.get('SELECT COUNT(*) n FROM transaction_sources')).n,2);
 delete second.expected.AmountMinor;
 await assert.rejects(repairBankDescriptions(db,user,[second]),/Incomplete/);
 await assert.rejects(repairBankDescriptions(db,'other-owner',[first]),/Invalid/);
});
