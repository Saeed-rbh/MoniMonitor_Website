const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(),'operational-status-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory,'test.sqlite');
process.env.JWT_SECRET = 'operational-test-secret';
process.env.USER_ID = 'owner';
process.env.AI_INGESTION_ENABLED = 'true';
const {getDb} = require('../database/db');
const {recordAgentState,getOperationalStatus,STALE_MS} = require('./operationalStatus');
let db;
const now=Date.now();
test.before(async()=>{db=await getDb();});
test.beforeEach(async()=>{await db.exec('DELETE FROM email_sync_state; DELETE FROM email_ingestion; DELETE FROM email_notifications;');});
test.after(async()=>{await db.close();fs.rmSync(directory,{recursive:true,force:true});});
const healthy=()=>recordAgentState({connected:true,lastScanAt:new Date(now).toISOString()},now);
test('fresh scans with no new mail are healthy; a heartbeat alone cannot mask a stalled scan',async()=>{
 await healthy(); assert.equal((await getOperationalStatus({now})).status,'ok');
 await recordAgentState({},now+STALE_MS+1);
 const status=await getOperationalStatus({now:now+STALE_MS+1});
 assert.ok(status.issues.includes('scan_stalled')); assert.ok(!status.issues.includes('agent_offline'));
});
test('offline, disconnected and disabled states are explicit',async()=>{
 const missing=await getOperationalStatus({now}); assert.ok(missing.issues.includes('agent_offline'));
 await healthy(); await recordAgentState({connected:false},now);
 assert.ok((await getOperationalStatus({now})).issues.includes('mail_disconnected'));
 assert.equal((await getOperationalStatus({enabled:false,now})).status,'disabled');
});
test('queue age uses receipt time even when retries have just updated the job',async()=>{
 await healthy(); const old=new Date(now-15*60*1000).toISOString();
 await db.run("INSERT INTO email_ingestion(sourceKey,body,receivedAt,status,updatedAt,lastError) VALUES('private-source','private body',?,'pending',?,'private failure')",[old,new Date(now).toISOString()]);
 await db.run("INSERT INTO email_ingestion(sourceKey,body,receivedAt,status,updatedAt) VALUES('review','private body',?,'review_required',?)",[old,old]);
 await db.run('INSERT INTO email_notifications(transactionId,updatedAt) VALUES(1,?)',old);
 const status=await getOperationalStatus({now});
 assert.ok(status.issues.includes('email_backlog')); assert.ok(status.issues.includes('notification_backlog')); assert.equal(status.reviewCount,1);
});
const app=require('../../index');
async function request(route,token) {
 const stack=app._router.stack.find(layer=>layer.route?.path===route).route.stack;
 const req={headers:token?{authorization:'Bearer '+token}:{}};
 let status=200, payload;
 const res={status(code){status=code;return this;},json(data){payload=data;return this;}};
 let index=0;
 const next=()=>stack[index++]?.handle(req,res,next);
 await next();
 return {status,payload};
}
const jwt=require('jsonwebtoken');
test('health reports degradation without exposing private queue information; liveness is independent',async()=>{
 const health=await request('/health'); assert.equal(health.status,503); assert.equal(health.payload.status,'degraded');
 assert.equal(JSON.stringify(health.payload).includes('private'),false); assert.equal(health.payload.counts,undefined);
 assert.equal((await request('/live')).status,200);
 await healthy(); assert.equal((await request('/health')).payload.status,'ok');
});
test('email status requires the linked user and never returns email bodies',async()=>{
 assert.equal((await request('/email/status')).status,401);
 const token=id=>jwt.sign({userId:id},process.env.JWT_SECRET);
 assert.equal((await request('/email/status',token('other'))).status,403);
 await healthy();
 await db.run("INSERT INTO email_ingestion(sourceKey,body,receivedAt,status,updatedAt,lastError) VALUES('private-key','secret email body',?,'review_required',?,'Account identity ambiguous')",[new Date(now).toISOString(),new Date(now).toISOString()]);
 const result=await request('/email/status',token('owner'));
 assert.equal(result.status,200); assert.equal(result.payload.status,'degraded'); assert.equal(result.payload.unresolved.length,1); assert.equal(result.payload.unresolved[0].lastError,'Account identity ambiguous'); assert.equal(JSON.stringify(result.payload).includes('secret email body'),false);
});

test('failed scan degrades health even with a recent successful scan',async()=>{
 await healthy(); await recordAgentState({lastError:'Scan failed'},now);
 assert.ok((await getOperationalStatus({now})).issues.includes('scan_error'));
});
test('processing attempts are counted even when posting completes the job inside the handler',async()=>{
 const {ImapService}=require('./imapService');
 await db.run("INSERT INTO email_ingestion(sourceKey,body,receivedAt,status,updatedAt) VALUES('attempt','fixture',?,'pending',?)",[new Date(now).toISOString(),new Date(now).toISOString()]);
 const service=Object.create(ImapService.prototype);
 service.onNewEmail=async()=>{await db.run("UPDATE email_ingestion SET status='review_required',lastError='Account ambiguous' WHERE sourceKey='attempt'");return true;};
 await service.processJob('attempt');
 const job=await db.get("SELECT * FROM email_ingestion WHERE sourceKey='attempt'");
 assert.equal(job.attempts,1); assert.equal(job.status,'review_required'); assert.equal(job.lastError,'Account ambiguous');
});
