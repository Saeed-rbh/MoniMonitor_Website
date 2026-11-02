const test = require('node:test');
const assert = require('node:assert/strict');
const { createItemSyncCoordinator } = require('./itemSyncCoordinator');

test('webhooks during a fetch coalesce into a fresh pass using the committed cursor and strongest options', async () => {
 let release; const seen=[];
 const coordinator=createItemSyncCoordinator(async (item,options)=>{
  seen.push({cursor:item.cursor,options});
  if(seen.length===1) await new Promise(resolve=>{release=resolve;});
  return seen.length;
 },async item=>({...item,cursor:'committed-cursor'}));
 const item={itemId:'a',cursor:'old-cursor'};
 const first=coordinator.sync(item,{forceHoldings:false});
 await new Promise(resolve=>setImmediate(resolve));
 const webhook=coordinator.sync(item,{forceHoldings:false},true);
 const reconnect=coordinator.sync(item,{forceHoldings:true,backfillSources:true},true);
 assert.equal(webhook,reconnect);
 release();await Promise.all([first,webhook,reconnect]);
 assert.deepEqual(seen,[{cursor:'old-cursor',options:{forceHoldings:false}},
  {cursor:'committed-cursor',options:{forceHoldings:true,backfillSources:true}}]);
 assert.equal(coordinator.running.size,0);assert.equal(coordinator.trailing.size,0);
});
test('a fresh reconnect still runs after the in-flight request fails', async () => {
 let reject;let calls=0;
 const coordinator=createItemSyncCoordinator(async()=>{
  if(++calls===1) return new Promise((resolve,rejectPromise)=>{reject=rejectPromise;});
  return 'repaired';
 },async item=>item);
 const first=coordinator.sync({itemId:'a'});first.catch(()=>{});
 await new Promise(resolve=>setImmediate(resolve));
 const retry=coordinator.sync({itemId:'a'},{forceHoldings:true},true);
 reject(new Error('old request failed'));
 assert.equal(await retry,'repaired');assert.equal(calls,2);
});
