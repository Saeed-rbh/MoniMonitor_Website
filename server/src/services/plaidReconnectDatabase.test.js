const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'moni-reconnect-'));
process.env.MONIMONITOR_DB_PATH=path.join(directory,'test.sqlite');
process.env.PLAID_CLIENT_ID='test-client';process.env.PLAID_SECRET='test-secret';
process.env.PLAID_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
process.env.MARKET_QUOTES_ENABLED='false';
const service=require('../database/dbService');
const plaid=require('./plaidService');
let db,card,emailId;const realFetch=global.fetch;let fail=false;const calls=[];
const bankAccount={account_id:'bank-card',mask:'1234',name:'Visa',type:'credit',subtype:'credit card',balances:{current:100.25,iso_currency_code:'CAD'}};
test.before(async()=>{
 db=await service.getDb();await service.createUser('u','reconnect-owner','unused');
 card=await service.createInvestmentAccount('u',{name:'Card',institution:'RBC',accountType:'Credit Card',currency:'CAD',accountRef:'1234',cashMinor:5000});
 const now=new Date().toISOString();
 await db.run(`INSERT INTO plaid_items(itemId,userId,accessTokenEncrypted,institutionName,status,cursor,lastSyncedAt,createdAt,updatedAt)
 VALUES('item','u',?,'RBC','login_required','old-cursor',?,?,?)`,[plaid.encryptAccessToken('access-test'),now,now,now]);
 emailId=await service.addTransaction({userId:'u',Amount:20,Currency:'CAD',Category:'Expense',Label:'Shopping',Reason:'My merchant note',
  Timestamp:'2026-10-20',AccountFlow:'OUT',Type:'Credit Card',Account:'1234',BankName:'RBC',BalanceAccountId:card.id,PostingStatus:'pending',SourceEmailKey:'source-email'});
 await db.run("INSERT INTO transaction_ingestion_reviews(transactionId,reason,createdAt) VALUES(?,'ambiguous_account',?)",[emailId,now]);
 const raw={transaction_id:'settled',account_id:'bank-card',amount:-19.5,date:'2026-10-21',name:'Merchant',pending:false,iso_currency_code:'CAD'};
 await service.upsertTransactionSource({provider:'plaid',externalId:'settled',userId:'u',transactionId:emailId,itemId:'item',ownsTransaction:false,
  rawPayload:raw,contextPayload:{account:{...bankAccount,appAccountId:card.id},institutionName:'RBC'}});
 global.fetch=async(url,options)=>{
  const endpoint=new URL(url).pathname;calls.push({endpoint,body:JSON.parse(options.body)});
  if(fail) throw new Error('temporary network failure');
  const responses={
   '/transactions/sync':{added:[],modified:[],removed:[],has_more:false,next_cursor:'new-cursor',accounts:[bankAccount]},
   '/accounts/get':{accounts:[bankAccount]},
   '/item/public_token/exchange':{item_id:'new-item',access_token:'access-new'},
  };
  assert.ok(responses[endpoint],`Unexpected endpoint ${endpoint}`);
  return {ok:true,json:async()=>responses[endpoint]};
 };
});
test.after(async()=>{
 await new Promise(resolve=>setImmediate(resolve));await plaid.processPendingPlaidWebhooks();
 global.fetch=realFetch;await db.close();fs.rmSync(directory,{recursive:true,force:true});
});
test('reconnect corrects a previously linked email even when the cursor returns no changed transactions',async()=>{
 const result=await plaid.requestImmediateReconciliation('u','item');
 assert.equal(result.results[0].ok,true);
 const tx=await service.getTransactionById(emailId,'u');
 assert.equal(tx.PostingStatus,'posted');assert.equal(tx.AmountMinor,1950);assert.equal(tx.Category,'Income');
 assert.ok((await db.get('SELECT resolvedAt FROM transaction_ingestion_reviews WHERE transactionId=?',[emailId])).resolvedAt);
 assert.equal(tx.AccountFlow,'IN');assert.equal(tx.Reason,'My merchant note');assert.equal(tx.BalanceAccountId,card.id);
 assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[card.id])).cashMinor,10025);
 assert.equal((await db.get('SELECT cursor FROM plaid_items WHERE itemId=?',['item'])).cursor,'new-cursor');
 assert.equal((await db.get('SELECT COUNT(*) n FROM transactions')).n,1);
 assert.equal((await db.get("SELECT status FROM plaid_webhook_events WHERE webhookType='LOCAL'")).status,'processed');
 assert.ok(!calls.some(call=>call.endpoint==='/transactions/refresh'));
});
test('retry remains durable and reuses its job; reconnect does not change reviewed labels',async()=>{
 await service.updateTransactionForUser(emailId,'u',{Label:'Personal Transfers Received'},{reviewed:true});
 fail=true;
 const failed=await plaid.requestImmediateReconciliation('u','item');
 assert.equal(failed.results[0].ok,false);assert.equal(failed.results[0].queued,true);
 let job=await db.get("SELECT * FROM plaid_webhook_events WHERE status='retry'");assert.ok(job);assert.equal(job.attempts,1);
 fail=false;
 const recovered=await plaid.requestImmediateReconciliation('u','item');assert.equal(recovered.results[0].ok,true);
 const same=await db.get('SELECT * FROM plaid_webhook_events WHERE id=?',[job.id]);assert.equal(same.status,'processed');assert.equal(same.attempts,2);
 assert.equal((await service.getTransactionById(emailId,'u')).Label,'Personal Transfers Received');
 assert.equal((await db.get('SELECT COUNT(*) n FROM transactions')).n,1);
});
test('a connection is queued in the same transaction as its encrypted credentials',async()=>{
 const result=await plaid.exchangePublicToken('u','public-test',{institution:{name:'Another Bank'}});
 assert.equal(result.itemId,'new-item');
 assert.equal((await db.get("SELECT status FROM plaid_webhook_events WHERE itemId='new-item'")).status,'pending');
 // Avoid unrelated network work during cleanup: this test only checks durable creation.
 await db.run("UPDATE plaid_webhook_events SET status='processed' WHERE itemId='new-item'");
});
test('a different user cannot enqueue corrections for an owned Item',async()=>{
 await assert.rejects(plaid.requestImmediateReconciliation('other','item'),error=>error.statusCode===404);
});

test('linked investment facts are corrected while a conflicting source currency stays quarantined',async()=>{
 const account=await service.createInvestmentAccount('u',{name:'TFSA',institution:'Wealthsimple',accountType:'TFSA',currency:'CAD',accountRef:'S0K7',cashMinor:0});
 const id=await service.addTransaction({userId:'u',Amount:9,Currency:'CAD',Category:'Investment',Label:'ETF & Stock Purchase',Reason:'Keep this note',
  Timestamp:'2026-10-20',PortfolioAction:'BUY',PortfolioSymbol:'VFV',PortfolioQuantity:0.04,PortfolioPrice:200,
  SourceEmailKey:'investment-email',Account:'S0K7',BankName:'Wealthsimple'});
 const provider={investment_transaction_id:'trade',account_id:'invest',security_id:'vfv',type:'buy',amount:10,quantity:0.05,price:200,date:'2026-10-20',iso_currency_code:'USD'};
 const mapped={appAccountId:account.id,currency:'CAD',mask:'S0K7',type:'investment',subtype:'tfsa'};
 const security={ticker_symbol:'VFV',name:'Vanguard ETF'};
 await service.upsertTransactionSource({provider:'plaid_investments',externalId:'trade',userId:'u',transactionId:id,itemId:'item',ownsTransaction:false,
  rawPayload:provider,contextPayload:{account:mapped,security,institutionName:'Wealthsimple'}});
 await plaid.refreshStoredPlaidSourceDetails('u',{itemId:'item',includeLinked:true});
 assert.equal((await service.getTransactionById(id,'u')).Currency,'CAD');
 assert.equal((await service.getTransactionById(id,'u')).AmountMinor,900);
 const result=await plaid.importInvestmentTransaction('u',{itemId:'item',institutionName:'Wealthsimple'},
  {...provider,iso_currency_code:'CAD'},new Map([['invest',mapped]]),new Map([['vfv',security]]));
 assert.equal(result.status,'known');
 const corrected=await service.getTransactionById(id,'u');
 assert.equal(corrected.AmountMinor,1000);assert.equal(corrected.PortfolioQuantity,0.05);
 assert.equal(corrected.PortfolioAccountId,account.id);assert.equal(corrected.Reason,'Keep this note');
});


test('provider removals retain posted portfolio evidence for review without aborting correction',async()=>{
 const source=await db.get("SELECT * FROM transaction_sources WHERE provider='plaid_investments' AND externalId='trade'");
 await db.run("UPDATE transaction_sources SET ownsTransaction=1 WHERE provider='plaid_investments' AND externalId='trade'");
 const account=await db.get("SELECT * FROM investment_accounts WHERE accountRef='S0K7'");
 await db.run(`INSERT INTO portfolio_transactions(userId,accountId,sourceTransactionId,kind,amountMinor,occurredAt)
  VALUES('u',?,?,'EMAIL_BUY',1000,'2026-10-20')`,[account.id,source.transactionId]);
 await assert.doesNotReject(plaid.removeMissingInvestmentTransactions('u','item','2026-10-01',new Set()));
 const retained=await db.get("SELECT * FROM transaction_sources WHERE provider='plaid_investments' AND externalId='trade'");
 assert.ok(retained);assert.equal(retained.ownsTransaction,0);assert.equal(JSON.parse(retained.contextPayloadJson).providerRemoved,true);
 assert.ok(await service.getTransactionById(source.transactionId,'u'));
 assert.equal((await db.get('SELECT reason FROM transaction_ingestion_reviews WHERE transactionId=?',[source.transactionId])).reason,'provider_removed_linked_activity');
});
