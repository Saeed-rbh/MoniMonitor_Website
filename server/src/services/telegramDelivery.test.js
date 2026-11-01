const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
process.env.TELEGRAM_BOT_TOKEN='12345:test-token';
process.env.TELEGRAM_CHAT_ID='42';
process.env.TELEGRAM_DISABLE_NETWORK='false';
const telegram = require('./telegramService');

function reply(t, response, statusCode=200) {
    t.mock.method(https,'request',(_options,callback)=>{
        const req=new EventEmitter();req.write=()=>{};
        req.end=()=>{const res=new EventEmitter();res.statusCode=statusCode;callback(res);queueMicrotask(()=>{res.emit('data',JSON.stringify(response));res.emit('end');});};
        return req;
    });
}
test('an unchanged edit confirms exact content and markup without retrying',async t=>{
    reply(t,{ok:false,error_code:400,description:'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message'},400);
    assert.deepEqual(await telegram.editTelegramMessage(123,'same'),{ok:true,unchanged:true,result:{message_id:123}});
    assert.deepEqual(await telegram.editTelegramMessage('inline-id','same'),{ok:true,unchanged:true,result:true});
});
test('other edit failures and failed sends never claim successful delivery',async t=>{
    const failure={ok:false,error_code:400,description:'Bad Request: message to edit not found'};
    reply(t,failure,400);assert.deepEqual(await telegram.editTelegramMessage(123,'changed'),failure);
});
test('unchanged only applies to edits, not sends',async t=>{
    const failure={ok:false,error_code:400,description:'Bad Request: message is not modified'};
    reply(t,failure,400);assert.deepEqual(await telegram.sendTelegramMessage('same'),failure);
});
test('successful edits preserve Telegram confirmation',async t=>{
    const result={ok:true,result:{message_id:123,text:'corrected'}};reply(t,result);
    assert.deepEqual(await telegram.editTelegramMessage(123,'corrected'),result);
});
test('timeouts retain a retryable connection error instead of an unknown failure',async t=>{
    t.mock.method(https,'request',()=>{
        const req=new EventEmitter();req.write=()=>{};
        req.end=()=>queueMicrotask(()=>req.emit('timeout'));
        req.destroy=error=>req.emit('error',error);return req;
    });
    const result=await telegram.telegramJsonRequest('getMe',{});
    assert.equal(result.ok,false);assert.equal(result.error_code,'ETIMEDOUT');assert.equal(result.retryable,true);
    assert.doesNotMatch(result.description,/test-token/);
});

test('an interrupted response releases the request for a later retry',async t=>{
    t.mock.method(https,'request',(_options,callback)=>{
        const req=new EventEmitter();req.write=()=>{};
        req.end=()=>{const res=new EventEmitter();callback(res);queueMicrotask(()=>res.emit('aborted'));};
        return req;
    });
    const result=await telegram.telegramJsonRequest('editMessageText',{});
    assert.equal(result.ok,false);assert.equal(result.error_code,'ECONNRESET');assert.equal(result.retryable,true);
});
