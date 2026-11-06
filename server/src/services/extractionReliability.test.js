const test=require('node:test'),assert=require('node:assert/strict');
const {validateEvidence}=require('./extractionEvidence');
const {createProvider}=require('./aiProvider');
const {parseKnownEmail}=require('./emailTemplates');
const body='Amount: $10.00 CAD\nAccount: A123\nSymbol: QQC\nShares: 0.2\nAverage price: $50\nType: Buy\nTime: October 20, 2026 12:05 EDT';
const base={Amount:'10.00',Currency:'CAD',Account:'A123',BalanceAccountId:1,PortfolioAccountId:1,Category:'Investment',PortfolioAction:'BUY',PortfolioSymbol:'QQC',PortfolioQuantity:0.2,PortfolioPrice:50,Timestamp:'2026-10-20T16:05:00.000Z',AccountFlow:'OUT',Evidence:{Amount:'Amount: $10.00 CAD',Currency:'CAD',Account:'A123',PortfolioAction:'Type: Buy',PortfolioSymbol:'Symbol: QQC',PortfolioQuantity:'Shares: 0.2',PortfolioPrice:'Average price: $50',Timestamp:'October 20, 2026 12:05 EDT',AccountFlow:'Type: Buy'}};
const accounts=[{id:1,accountRef:'A123',name:'TFSA A'}];
test('financial extraction rejects invented values even when the quoted span really exists',()=>{
 assert.equal(validateEvidence(base,body,accounts),base);
 for(const fields of [{Amount:'100'},{Currency:'USD'},{PortfolioQuantity:2},{PortfolioPrice:5},{PortfolioSymbol:'VFV'},{BalanceAccountId:2},{Timestamp:'2026-10-21T16:05:00.000Z'},{AccountFlow:'IN'}])assert.throws(()=>validateEvidence({...base,...fields},body,accounts),{code:'AI_SOURCE_EVIDENCE'});
 assert.throws(()=>validateEvidence({...base,Evidence:{...base.Evidence,Amount:'Amount: $100.00 CAD'}},body,accounts));
 assert.throws(()=>validateEvidence({...base,Category:'Internal',PortfolioAction:'TRANSFER',Evidence:{...base.Evidence,PortfolioAction:'Account: A123'}},body,accounts));
});
test('generic account aliases cannot choose between multiple accounts',()=>{
 assert.throws(()=>validateEvidence({...base,Account:'TFSA',Evidence:{...base.Evidence,Account:'TFSA'}},body+'\nTFSA',[{id:1,name:'TFSA'},{id:2,name:'TFSA'}]));
});
test('local provider uses schema, localhost, cancellation and never falls back to hosted billing',async()=>{
 let calls=0,request;
 const local=createProvider({OLLAMA_MODEL:'test'},{gemini:{models:{generateContent:()=>{throw Error('paid')}}},fetchImpl:async(url,options)=>{if(url.pathname==='/api/show')return{ok:true,json:async()=>({model_info:{'general.parameter_count':1000}})};calls++;request=JSON.parse(options.body);return{ok:true,json:async()=>({message:{content:'{}'}})};}});
 await local.generate({contents:'raw email',config:{responseJsonSchema:{type:'object'}}});
 assert.equal(calls,1);assert.equal(request.format.type,'object');
 const foreign=createProvider({OLLAMA_MODEL:'test',OLLAMA_URL:'https://example.com'},{fetchImpl:()=>{throw Error('must not send')}});
 await assert.rejects(foreign.generate({}),{code:'AI_LOCAL_ENDPOINT_REQUIRED'});
 const keyAlone=createProvider({AI_API_KEY:'secret'},{gemini:{}});
 await assert.rejects(keyAlone.generate({}),{code:'AI_FREE_PROVIDER_NOT_CONFIGURED'});
 let hosted=0;
 const unconfirmed=createProvider({AI_PROVIDER:'gemini-free'},{gemini:{models:{generateContent:()=>{hosted++;}}}});
 await assert.rejects(unconfirmed.generate({}),{code:'AI_FREE_PROVIDER_NOT_CONFIGURED'});assert.equal(hosted,0);
 const free=createProvider({AI_PROVIDER:'gemini-free',AI_FREE_PROJECT_CONFIRMED:'true'},{gemini:{models:{generateContent:()=>{hosted++;throw Object.assign(Error('quota'),{status:429});}}}});
 await assert.rejects(free.generate({}),{status:429});assert.equal(hosted,1);assert.equal(calls,1);
});
test('known source templates read raw amounts, dates and exact trade units without model output',()=>{
 const trade=parseKnownEmail('From: Wealthsimple <notifications@o.wealthsimple.com>\nSubject: Your order has been filled\nAccount: TFSA\nType: Fractional Buy\nSymbol: QQC\nShares: 0.2\nAverage price: $50\nTotal cost: $10.00\nTime: October 20, 2026 12:05 EDT');
 assert.equal(trade.Amount,'10.00');assert.equal(trade.PortfolioQuantity,0.2);assert.equal(trade.Timestamp,'2026-10-20T16:05:00.000Z');assert.equal(trade.Currency,null);assert.equal(trade.BalanceAccountId,null);
 const rbc=parseKnownEmail('From: RBC <rbcroyalbankalerts@alerts.rbc.com>\nSubject: Withdrawal Warning\nAccount:\n****1234\nWithdrawal Amount:\n$1,150.70\nTransaction Date:\nOctober 20, 2026');
 assert.equal(rbc.Amount,'1150.70');assert.equal(rbc.Category,'Expense');assert.equal(rbc.AccountFlow,'OUT');
 assert.equal(parseKnownEmail('From: Other <merchant@example.com>\nSubject: Your order has been filled\n'+body),null);
 assert.equal(parseKnownEmail('From: Wealthsimple <notifications@o.wealthsimple.com>\nSubject: Your order has been filled\nAccount: TFSA\nType: Buy\nSymbol: QQC'),null);
});
test('cannot suppress a buy cash movement, omit trade units, invent an account ref or label an external transfer internal',()=>{
 for(const patch of [{AccountFlow:'NONE'},{PortfolioQuantity:null},{PortfolioAccountNumber:'B999'}])assert.throws(()=>validateEvidence({...base,...patch},body,accounts));
 const transferBody='Amount: $10.00 CAD\nAccount: A123\nTransfer from A123 to an external person';
 assert.throws(()=>validateEvidence({Amount:'10.00',Currency:'CAD',Account:'A123',BalanceAccountId:1,Category:'Internal',PortfolioAction:'TRANSFER',AccountFlow:'OUT',Evidence:{Amount:'Amount: $10.00 CAD',Currency:'CAD',Account:'A123',PortfolioAction:'Transfer',AccountFlow:'from A123',FromAccount:'A123',ToAccount:'an external person'}},transferBody,accounts));
});
test('crypto 12-hour execution clocks retain explicit Eastern offsets including midnight',()=>{
 const time=require('./emailEvidence').sourceEventTimestamp;
 assert.equal(time('Time: October 20, 2026  3:42 PM, EDT'),'2026-10-20T19:42:00.000Z');
 assert.equal(time('Time: November 10, 2026 12:05 AM, EST'),'2026-11-10T05:05:00.000Z');
 assert.equal(time('Time: October 20, 2026 25:42 EDT'),null);
});
test('local aliases to cloud models are rejected before financial content is sent',async()=>{
 let generation=0;
 const provider=createProvider({OLLAMA_MODEL:'innocent-alias'},{fetchImpl:async(url,options)=>{
  if(url.pathname==='/api/chat')generation++;
  assert.ok(!options.body.includes('private financial email'));
  assert.equal(options.redirect,'error');
  return{ok:true,json:async()=>({remote_model:'paid-model',remote_host:'https://ollama.com',model_info:{'general.parameter_count':1000}})};
 }});
 await assert.rejects(provider.generate({contents:'private financial email'}),{code:'AI_LOCAL_MODEL_REQUIRED'});
 assert.equal(generation,0);
});
test('explicit metered Gemini uses the supplied client without free-project attestation or provider fallback',async()=>{
 let calls=0;
 const provider=createProvider({AI_PROVIDER:'gemini',GEMINI_MODEL:'configured-model'},{gemini:{models:{generateContent:async request=>{calls++;assert.equal(request.model,'configured-model');return{text:'{}'};}}},fetchImpl:()=>assert.fail('No alternative provider permitted')});
 assert.equal(provider.enabled,true);
 assert.equal((await provider.generate({contents:'synthetic test'})).text,'{}');assert.equal(calls,1);
});
test('literal credited/deposited wording proves incoming direction while output enum text does not',()=>{
 for(const wording of ['was credited','was deposited']){
  const source='Amount: $10.00 CAD\n'+wording;
  const tx={Amount:'10.00',Currency:'CAD',Category:'Income',AccountFlow:'IN',Evidence:{Amount:'$10.00 CAD',Currency:'CAD',AccountFlow:wording}};
  assert.equal(validateEvidence(tx,source).AccountFlow,'IN');
  assert.throws(()=>validateEvidence({...tx,Evidence:{...tx.Evidence,AccountFlow:'IN'}},source));
 }
});
test('Gemini quota and credential outages remain eligible for durable retry',async()=>{
 for(const status of [401,403,408,429,503]){
  const provider=createProvider({AI_PROVIDER:'gemini'},{gemini:{models:{generateContent:async()=>{throw{status};}}}});
  await assert.rejects(provider.generate({}),{code:'AI_PROVIDER_UNAVAILABLE',retryable:true,status});
 }
});
test('AI counterparty names require literal source evidence and cannot expand initials into invented names',()=>{
 const text='From: Bank\nInterac e-Transfer received from J. Winters\nAmount: $10.00 CAD';
 const tx={Amount:'10.00',Currency:'CAD',Category:'Income',Label:'Personal Transfers Received',Type:'e-Transfer',AccountFlow:'IN',CounterpartyName:'J. Winters',Evidence:{Amount:'$10.00 CAD',Currency:'CAD',AccountFlow:'received from',CounterpartyName:'J. Winters'}};
 assert.equal(validateEvidence(tx,text).CounterpartyName,'J. Winters');
 assert.throws(()=>validateEvidence({...tx,CounterpartyName:'Jordan Winters'},text),{code:'AI_SOURCE_EVIDENCE'});
});

test('crypto wallet receipt needs literal action evidence and cannot route on account type alone',()=>{
 const source='Account: Crypto\nAmount: $10.00 CAD\nYou’ve received crypto from another wallet!';
 const tx={Amount:'10.00',Currency:'CAD',Category:'Investment',Label:'Asset Distribution',
  Account:null,BalanceAccountId:null,PortfolioAccountId:null,PortfolioAction:'TRANSFER',AccountFlow:'IN',
  Evidence:{Amount:'$10.00 CAD',Currency:'CAD',Account:'Account: Crypto',
   PortfolioAction:'You’ve received crypto from another wallet!',AccountFlow:'received crypto'}};
 const supplied=[{id:13,name:'Wealthsimple Crypto',accountRef:'C123'}];
 assert.equal(validateEvidence(tx,source,supplied),tx);
 assert.throws(()=>validateEvidence({...tx,BalanceAccountId:13},source,supplied),{code:'AI_SOURCE_EVIDENCE'});
 assert.throws(()=>validateEvidence({...tx,PortfolioAction:'DEPOSIT'},source,supplied),{code:'AI_SOURCE_EVIDENCE'});
 assert.throws(()=>validateEvidence({...tx,Evidence:{...tx.Evidence,Account:'Wealthsimple Crypto'}},source,supplied),{code:'AI_SOURCE_EVIDENCE'});
});
