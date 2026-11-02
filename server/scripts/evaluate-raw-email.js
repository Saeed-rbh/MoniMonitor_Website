// Private, read-only evaluation. Never uses retained parsedTransaction as model input.
// Usage: node scripts/evaluate-raw-email.js CORPUS SNAPSHOT OUTPUT [--model]
const fs=require('node:fs');
const {parseKnownEmail}=require('../src/services/emailTemplates');
const {parseEmailWithGemini,providerStatus}=require('../src/services/aiService');
const {normalizeEmailEvidence}=require('../src/services/emailEvidence');
const {VERSION}=require('../src/services/extractionEvidence');
async function evaluate(corpus,snapshot,{model=false}={}){
 const tables=snapshot.tables,byId=new Map(tables.transactions.map(t=>[t.id,t]));
 const verified=new Map((tables.verified_history_entries||[]).map(v=>[v.transactionId,v]));
 const accounts=corpus.accounts||tables.investment_accounts;
 const report={version:VERSION,mode:model?'fresh_raw_extraction':'raw_templates_only',provider:providerStatus(),
  limitations:['Captured-email corpus cannot measure emails never discovered or retained.','Bank agreement is measured separately from raw source extraction; corrected bank facts can differ from an alert.','Examples must have been verified before receipt; later corrections are excluded.','This is an offline evaluation; no financial records are written.'],months:{},modelAttempts:0,rows:[]};
 for(const email of [...corpus.emails].sort((a,b)=>String(a.payload.receivedAt).localeCompare(String(b.payload.receivedAt)))){
  const month=String(email.payload.receivedAt||'').slice(0,7);
  if(!/^2026-(08|09|10)$/.test(month))continue;
  const stats=report.months[month] ||= {total:0,templates:0,modelAttempts:0,abstained:0,unconfirmedCurrency:0,bankVerified:0,fields:{}};
  stats.total++;
  const expected=byId.get(email.transactionId),proof=verified.get(email.transactionId),raw=email.payload.rawBody;
  let result=parseKnownEmail(raw);
  if(result)stats.templates++;
  else if(model){
   report.modelAttempts++;stats.modelAttempts++;
   // Chronological retrieval: only independent verified facts known BEFORE receipt and from an earlier calendar month.
   const before=String(email.payload.receivedAt||'');
   const examples=corpus.emails.filter(e=>{
    const v=verified.get(e.transactionId);return v && v.verifiedAt<before && String(e.transactionDate).slice(0,7)<month && e.transactionId!==email.transactionId;
   }).filter(e=>e.payload.rawBody.match(/^Subject:[^\r\n]*/im)?.[0]===raw.match(/^Subject:[^\r\n]*/im)?.[0]).slice(-3).map(e=>({source:e.payload.rawBody.slice(0,8000),expected:JSON.parse(verified.get(e.transactionId).factsJson)}));
   result=await parseEmailWithGemini(raw,[],accounts,{examples,bypassCache:true});
  }
  if(!result||result.error){stats.abstained++;report.rows.push({externalId:email.externalId,month,status:'abstained'});continue;}
  result=normalizeEmailEvidence(result,raw,accounts);
  if(result.IngestionReviewReason==='unconfirmed_currency')stats.unconfirmedCurrency++;
  const differences=[];
  if(expected&&proof){
   stats.bankVerified++;
   const fields=['Amount','Currency','AccountFlow','PortfolioAction','PortfolioSymbol','PortfolioQuantity','PortfolioPrice','Timestamp','CashDate','BalanceAccountId'];
   for(const field of fields){
    const actual=result[field]??null,gold=expected[field]??(field==='AccountFlow'?(expected.Category==='Expense'?'OUT':expected.Category==='Income'?'IN':null):null);
    if(gold===null && actual===null)continue;
    const metric=stats.fields[field] ||= {compared:0,agrees:0,abstained:0};
    if(actual===null || field==='Currency'&&result.IngestionReviewReason==='unconfirmed_currency'){metric.abstained++;continue;}
    metric.compared++;
    const same=['Amount','PortfolioQuantity','PortfolioPrice'].includes(field)?Math.abs(Number(actual)-Number(gold))<1e-8:actual===gold;
    if(field==='Timestamp'){if(String(actual).slice(0,10)===String(gold).slice(0,10))metric.agrees++;else differences.push(field);}else if(same)metric.agrees++;else differences.push(field);
   }
  }
  report.rows.push({externalId:email.externalId,month,status:result.IngestionReviewReason?'held':'extracted',template:!!result.ExtractionVersion,bankDifferenceFields:differences});
 }
 report.heldOutMonth='2026-10';
 return report;
}
if(require.main===module){
 const [corpusPath,snapshotPath,output]=process.argv.slice(2);
 if(!output)throw Error('CORPUS SNAPSHOT OUTPUT required');
 const model=process.argv.includes('--model');
 if(model&&!providerStatus().enabled)throw Error('Configure a verified free/local provider before fresh model evaluation');
 evaluate(JSON.parse(fs.readFileSync(corpusPath)),JSON.parse(fs.readFileSync(snapshotPath)),{model}).then(report=>{
  fs.writeFileSync(output,JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({mode:report.mode,modelAttempts:report.modelAttempts,months:report.months}));
 }).catch(()=>{console.error('Raw evaluation failed; private inputs were not printed.');process.exitCode=1;});
}
module.exports={evaluate};
