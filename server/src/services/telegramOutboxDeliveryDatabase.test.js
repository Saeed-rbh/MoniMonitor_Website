const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const https=require('node:https');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'moni-telegram-delivery-'));
process.env.MONIMONITOR_DB_PATH=path.join(directory,'test.sqlite');
process.env.TELEGRAM_BOT_TOKEN='12345:test-token';process.env.TELEGRAM_CHAT_ID='42';
process.env.TELEGRAM_DISABLE_NETWORK='false';
const service=require('../database/dbService');
const telegram=require('./telegramService');
const worker=require('./telegramOutboxWorker');
const { normalizeTransactionSemantics } = require('./transactionSemantics');
let db;
test.before(async()=>{db=await service.getDb();await service.createUser('u','delivery-owner','unused');});
test.after(async()=>{await db.close();fs.rmSync(directory,{recursive:true,force:true});});
test('delivery mutes recurring investments even when the stored job requests an audible alert',async t=>{
    const sent=[];
    t.mock.method(telegram,'sendTelegramMessage',async(...args)=>{sent.push(args);return {ok:true,result:{message_id:500}};});
    for(const [Category,Label,PortfolioAction,Frequency,silent,expected] of [
        ['Investment','ETF & Stock Purchase','BUY','Daily',false,true],
        ['Investment','ETF & Stock Purchase',null,'Weekly',false,true],
        ['Saving','Investment','CONTRIBUTION','Monthly',false,true],
        ['Expense','Food',null,'OneTime',false,false],
        ['Expense','Food',null,'OneTime',true,true],
    ]){
        const transactionId=await service.addTransaction({userId:'u',Amount:100,Category,Label,PortfolioAction,Frequency,Reason:'Delivery preference test',Timestamp:'2026-11-04'});
        await worker.deliver({action:'sendMessage',transactionId,payload:{text:'old queued content',silent}});
        const [text,markup,muted,protectedContent]=sent.at(-1);
        assert.equal(muted,expected);assert.ok(text);assert.ok(markup);assert.equal(protectedContent,true);
    }
});
test('the durable worker records unchanged content as completed and preserves the message id',async t=>{
    t.mock.method(https,'request',(_options,callback)=>{
        const req=new EventEmitter();req.write=()=>{};req.end=()=>{const res=new EventEmitter();res.statusCode=400;callback(res);queueMicrotask(()=>{res.emit('data',JSON.stringify({ok:false,error_code:400,description:'Bad Request: message is not modified: content and markup already match'}));res.emit('end');});};return req;
    });
    const transactionId=await service.addTransaction({userId:'u',Amount:12,Category:'Expense',Reason:'Corrected bank purchase',Timestamp:'2026-10-31',TelegramMessageId:123});
    const id=await service.enqueueTelegramOutbox('editMessage',{messageId:123},{transactionId});
    await worker.processTelegramOutboxOnce();
    const row=await db.get('SELECT * FROM telegram_outbox WHERE id=?',[id]);
    assert.equal(row.status,'processed');assert.ok(row.processedAt);assert.equal(row.lastError,null);
    assert.equal((await service.getTransactionById(transactionId,'u')).TelegramMessageId,123);
});
test('temporary connection errors do not exhaust edit retries, but blocked bot errors do',async t=>{
    let response={ok:false,retryable:true,error_code:'ETIMEDOUT',description:'Connection timed out'};
    t.mock.method(telegram,'editTelegramMessage',async()=>response);
    const id=await service.enqueueTelegramOutbox('editMessage',{messageId:124,text:'correction'});
    await db.run('UPDATE telegram_outbox SET attempts=7 WHERE id=?',[id]);
    await worker.processTelegramOutboxOnce();
    let row=await db.get('SELECT * FROM telegram_outbox WHERE id=?',[id]);
    assert.equal(row.attempts,8);assert.equal(row.status,'retry');
    response={ok:false,error_code:429,description:'Too Many Requests',parameters:{retry_after:7200}};
    await db.run("UPDATE telegram_outbox SET nextAttemptAt='2000-01-01' WHERE id=?",[id]);
    const before=Date.now();await worker.processTelegramOutboxOnce();
    row=await db.get('SELECT * FROM telegram_outbox WHERE id=?',[id]);
    assert.equal(row.attempts,9);assert.equal(row.status,'retry');assert.ok(Date.parse(row.nextAttemptAt)>=before+7200000);
    response={ok:false,error_code:403,description:'Forbidden: bot was blocked by the user'};
    await db.run("UPDATE telegram_outbox SET nextAttemptAt='2000-01-01' WHERE id=?",[id]);
    await worker.processTelegramOutboxOnce();
    row=await db.get('SELECT * FROM telegram_outbox WHERE id=?',[id]);
    assert.equal(row.status,'dead');assert.equal(row.lastError,response.description);
});
test('failed new sends cannot be completed as an unchanged edit',async t=>{
    t.mock.method(telegram,'sendTelegramMessage',async()=>({ok:false,error_code:400,description:'Bad Request: message is not modified'}));
    const id=await service.enqueueTelegramOutbox('sendMessage',{text:'new message'});
    await worker.processTelegramOutboxOnce();
    const row=await db.get('SELECT * FROM telegram_outbox WHERE id=?',[id]);
    assert.equal(row.status,'retry');assert.equal(row.processedAt,null);
});

function paymentEmails(amount) {
    const base = { userId: 'u', Amount: amount, Currency: 'CAD', BankName: 'RBC',
        Timestamp: '2026-11-05T12:00:00Z', ReceivedAt: '2026-11-05T12:00:00Z' };
    return [
        { ...base, Category: 'Expense', Label: 'Other Expense', Type: 'Checking Account',
            Account: '1111', Reason: 'Withdrawal from chequing', AccountFlow: 'OUT' },
        normalizeTransactionSemantics({ ...base, Type: 'Credit Card', Account: '2222',
            Reason: 'Payment Made', ReceivedAt: '2026-11-05T12:00:08Z' }),
    ];
}

const commitWithAlert = transaction => service.commitEmailTransaction({
    transaction, outbox: { action: 'sendMessage', payload: {} },
});

test('one card payment sends one Telegram alert with either email arriving first', async t => {
    const sent = [];
    t.mock.method(telegram, 'sendTelegramMessage', async text => {
        sent.push(text);
        return { ok: true, result: { message_id: 600 + sent.length } };
    });
    for (const [index, amount] of [201.11, 202.22].entries()) {
        const emails = paymentEmails(amount);
        const firstId = await commitWithAlert(emails[index]);
        assert.equal(await worker.processTelegramOutboxOnce(), 0);
        const secondId = await commitWithAlert(emails[1 - index]);
        const [first, second] = await Promise.all([firstId, secondId].map(id => service.getTransactionById(id, 'u')));
        assert.deepEqual([first.AccountFlow, second.AccountFlow], index ? ['IN', 'OUT'] : ['OUT', 'IN']);
        assert.match(first.ReferenceNumber, /^XFER-CARD-/);
        assert.equal(second.ReferenceNumber, first.ReferenceNumber);
        for (const leg of [first, second]) {
            assert.equal(leg.Category, 'Internal');
            assert.equal(leg.Label, 'Credit Card Payment');
            assert.equal(leg.DisplayReason, 'Credit Card Payment');
        }
        assert.equal(await worker.processTelegramOutboxOnce(), 1);
        assert.match(sent.at(-1), /\*Credit Card Payment\*/);
        assert.equal(sent.length, index + 1);
    }
});

test('an unmatched alert still sends, and a late counterpart updates it without a second send', async t => {
    const [funding, card] = paymentEmails(203.33);
    const fundingId = await commitWithAlert(funding);
    const held = await db.get('SELECT nextAttemptAt, createdAt FROM telegram_outbox WHERE transactionId=?', [fundingId]);
    assert.equal(Date.parse(held.nextAttemptAt) - Date.parse(held.createdAt), 10 * 60_000);
    await db.run("UPDATE telegram_outbox SET nextAttemptAt='2000-01-01' WHERE transactionId=?", [fundingId]);
    const send = t.mock.method(telegram, 'sendTelegramMessage', async () => ({ ok: true, result: { message_id: 700 } }));
    const edit = t.mock.method(telegram, 'editTelegramMessage', async () => ({ ok: true, result: { message_id: 700 } }));
    assert.equal(await worker.processTelegramOutboxOnce(), 1);
    await commitWithAlert(card);
    assert.equal(await worker.processTelegramOutboxOnce(), 1);
    assert.equal(send.mock.callCount(), 1);
    assert.equal(edit.mock.callCount(), 1);
    assert.equal(edit.mock.calls[0].arguments[0], 700);
    assert.match(edit.mock.calls[0].arguments[1], /\*Credit Card Payment\*/);
});

test('a counterpart arriving during the send updates the same Telegram message', async t => {
    const [funding, card] = paymentEmails(204.44);
    const fundingId = await commitWithAlert(funding);
    await db.run("UPDATE telegram_outbox SET nextAttemptAt='2000-01-01' WHERE transactionId=?", [fundingId]);
    const send = t.mock.method(telegram, 'sendTelegramMessage', async () => {
        await commitWithAlert(card);
        return { ok: true, result: { message_id: 701 } };
    });
    const edit = t.mock.method(telegram, 'editTelegramMessage', async () => ({ ok: true }));
    assert.equal(await worker.processTelegramOutboxOnce(), 1);
    assert.equal(await worker.processTelegramOutboxOnce(), 1);
    assert.equal(send.mock.callCount(), 1);
    assert.equal(edit.mock.callCount(), 1);
    assert.equal(edit.mock.calls[0].arguments[0], 701);
    assert.match(edit.mock.calls[0].arguments[1], /\*Credit Card Payment\*/);
});
