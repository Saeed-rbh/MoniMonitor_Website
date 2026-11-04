const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moni-posting-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
const service = require('../database/dbService');
const plaid = require('./plaidService');
const semantics = require('../../../shared/financialSemantics.cjs');
const { normalizeEmailEvidence } = require('./emailEvidence');
const { formatTransactionMessage } = require('./telegramService');
const { repair } = require('../../scripts/apply-bank-evidence');
let db, card;
const row = { userId:'u', Amount:12, Currency:'CAD', Category:'Expense', Label:'Shopping', Reason:'Merchant',
    Timestamp:'2026-10-20', Type:'Credit Card', Account:'1234', BankName:'RBC', AccountFlow:'OUT' };
test.before(async()=>{
    db=await service.getDb(); await service.createUser('u','posting-owner','unused');
    card=await service.createInvestmentAccount('u',{name:'Card',institution:'RBC',accountType:'Credit Card',currency:'CAD',accountRef:'1234',cashMinor:0});
});
test.after(async()=>{await db.close();fs.rmSync(directory,{recursive:true,force:true});});
test('legacy status inputs retain amounts while explicit unposted activity is excluded',()=>{
    for(const PostingStatus of ['pending','unposted']) {
        assert.equal(semantics.amountMinorOf({...row,PostingStatus}),1200);
        assert.equal(semantics.isExpense({...row,PostingStatus}),false);
        assert.equal(semantics.isIncome({...row,Category:'Income',PostingStatus}),false);
        assert.equal(semantics.getSavingEffectMinor({...row,Category:'Saving',Label:'TFSA Contribution',PostingStatus}),0);
        const message=formatTransactionMessage({...row,PostingStatus});
        if (PostingStatus === 'unposted') assert.match(message,/Not posted by the bank/);
        else assert.doesNotMatch(message,/Pending/);
    }
    assert.equal(semantics.isExpense(row),true);
});
test('RBC card alerts are recorded immediately like cash alerts',()=>{
    const sender='From: rbcroyalbankalerts@alerts.rbc.com\n';
    assert.equal(normalizeEmailEvidence(row,sender+'Subject: Credit Card Transaction Alert').PostingStatus,undefined);
    assert.equal(normalizeEmailEvidence({...row,Type:'Checking Account'},sender+'Subject: Deposit Notice').PostingStatus,undefined);
});
test('pending source linked to an email settles once with the bank amount and date',async()=>{
    const id=await service.addTransaction({...row,PostingStatus:'pending',BalanceAccountId:card.id,SourceEmailKey:'email-card'});
    await service.syncTransactionAccountBalance('u',id,{accountId:card.id,confidence:'HIGH'});
    assert.equal((await service.getTransactionById(id,'u')).PostingStatus,'posted');
    assert.equal((await service.getSummaryForUser('u')).totalExpenses,12);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[card.id])).cashMinor,1200);
    assert.ok(await db.get('SELECT id FROM account_balance_events WHERE sourceTransactionId=?',[id]));
    const accounts=new Map([['bank-card',{appAccountId:card.id,mask:'1234',type:'credit',subtype:'credit card'}]]);
    const item={itemId:'posting-item',institutionName:'RBC'};
    const auth={transaction_id:'auth',account_id:'bank-card',amount:12,date:'2026-10-20',name:'Merchant',iso_currency_code:'CAD',pending:true};
    const matched=await plaid.importAddedTransaction('u',item,auth,accounts);
    assert.equal(matched.transactionId,id);
    const posted={...auth,transaction_id:'settled',pending_transaction_id:'auth',pending:false,amount:11.50,date:'2026-10-21'};
    const settled=await plaid.importAddedTransaction('u',item,posted,accounts);
    assert.equal(settled.transactionId,id);
    const tx=await service.getTransactionById(id,'u');
    assert.equal(tx.PostingStatus,'posted');assert.equal(tx.AmountMinor,1150);assert.equal(tx.Reason,'Merchant');
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[card.id])).cashMinor,1150);
    await plaid.importAddedTransaction('u',item,posted,accounts);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[card.id])).cashMinor,1150);
    await plaid.importAddedTransaction('u',item,auth,accounts);
    assert.equal((await service.getTransactionById(id,'u')).PostingStatus,'posted');
    assert.equal((await service.getTransactionById(id,'u')).AmountMinor,1150);
    await plaid.applyModifiedTransaction('u',item,{...posted,amount:11.25},accounts);
    assert.equal((await service.getTransactionById(id,'u')).AmountMinor,1125);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=?',[card.id])).cashMinor,1125);
});
test('status corrections invalidate monthly totals and remain eligible for later settlement',async()=>{
    const id=await service.addTransaction({...row,Amount:5,Timestamp:'2026-09-20'});
    assert.equal((await service.getSummaryForUser('u')).byMonth.find(m=>m.month==='2026-09').expenses,5);
    await db.withTransaction(()=>repair(db,{updates:[{id,expected:{AmountMinor:500},fields:{PostingStatus:'unposted'},evidence:{bank:'No posted charge in complete statements'}}],merges:[]},'u'));
    assert.ok(!(await service.getSummaryForUser('u')).byMonth.some(m=>m.month==='2026-09'));
    assert.equal(JSON.parse((await db.get('SELECT fieldsJson FROM transaction_overrides WHERE transactionId=?',[id])).fieldsJson).PostingStatus,undefined);
    await service.updateTransactionForUser(id,'u',{PostingStatus:'posted'});
    assert.equal((await service.getSummaryForUser('u')).byMonth.find(m=>m.month==='2026-09').expenses,5);
    await assert.rejects(service.updateTransactionForUser(id,'u',{PostingStatus:'unknown'}),/Invalid transaction posting status/);
});

test('an authorization release cannot pair as a settled refund',async()=>{
    const refunds=require('./refundPairing');
    assert.equal(refunds.isRefundTransaction({...row,Category:'Income',Label:'Refunds & Reversals',PostingStatus:'pending'}),false);
    assert.equal(await refunds.pairTransactionOnIngestion(db,'u',{...row,PostingStatus:'unposted'}),null);
});

test('removing the pending stage rebuilds existing expense totals once and preserves exclusions',async()=>{
    const id=await service.addTransaction({...row,Amount:99,Timestamp:'2026-11-04'});
    const excluded=await service.addTransaction({...row,Amount:7,Timestamp:'2026-11-04',PostingStatus:'unposted'});
    // Simulate an existing database from before migration 24.
    await db.run("UPDATE transactions SET PostingStatus='pending' WHERE id=?",[id]);
    assert.ok(!(await service.getSummaryForUser('u')).byMonth.some(m=>m.month==='2026-11'));
    const migration=require('../database/migrations').MIGRATIONS.find(m=>m.version===24);
    await db.withTransaction(()=>migration.up(db));
    assert.equal((await service.getTransactionById(id,'u')).PostingStatus,'posted');
    assert.equal((await service.getTransactionById(excluded,'u')).PostingStatus,'unposted');
    assert.equal((await service.getSummaryForUser('u')).byMonth.find(m=>m.month==='2026-11').expenses,99);
    await db.withTransaction(()=>migration.up(db));
    assert.equal((await service.getSummaryForUser('u')).byMonth.find(m=>m.month==='2026-11').expenses,99);
    await service.updateTransactionForUser(id,'u',{PostingStatus:'pending'});
    assert.equal((await service.getTransactionById(id,'u')).PostingStatus,'posted');
});
