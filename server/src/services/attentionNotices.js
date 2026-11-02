const { hash } = require('./automaticLearning');
async function enqueueAttentionNotice(userId,key,evidence,text,buttons=[]) {
    if(!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return false;
    const owner=process.env.BACKUP_OWNER_USER_ID || process.env.USER_ID;
    if(owner && String(owner)!==String(userId)) return false;
    const service=require('../database/dbService'),db=await service.getDb();
    if((await db.get('SELECT notificationsEnabled FROM user_settings WHERE userId=?',[userId]))?.notificationsEnabled===0) return false;
    return db.withTransaction(async()=>{
        const fingerprint=hash(evidence),now=new Date().toISOString();
        const result=await db.run('INSERT OR IGNORE INTO attention_deliveries VALUES (?,?,?,?)',[userId,key,fingerprint,now]);
        if(!result.changes) return false;
        await service.enqueueTelegramOutbox('sendMessage',{
            text:require('./telegramService').e(text),silent:true,reliabilityFormatVersion:2,
            ...(buttons.length?{replyMarkup:{inline_keyboard:buttons}}:{}),
        });
        return true;
    });
}
async function notifyBankAction(userId,item) {
    const consent=item.holdingsStatus==='consent_required'||item.investmentTransactionsStatus==='consent_required';
    if(!['login_required','attention_required'].includes(item.status) && !consent) return false;
    return enqueueAttentionNotice(userId,`bank-action:${item.itemId}`,
        [item.status,consent,item.lastSyncedAt,item.holdingsLastSyncedAt],
        `${item.institutionName || 'Your bank'} needs authorization. Open Profile → Bank fallback to reconnect. Automatic correction will continue afterward.`);
}
module.exports={enqueueAttentionNotice,notifyBankAction};
