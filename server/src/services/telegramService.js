const https = require('https');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_REQUEST_TIMEOUT_MS = Number(process.env.TELEGRAM_REQUEST_TIMEOUT_MS || 15_000);

function telegramJsonRequest(method, payload) {
    if (!TELEGRAM_BOT_TOKEN) return Promise.resolve(null);
    if (process.env.TELEGRAM_DISABLE_NETWORK === 'true') return Promise.resolve({ ok: true, result: {} });
    const body = JSON.stringify(payload);
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.telegram.org', path: `/bot${TELEGRAM_BOT_TOKEN}/${method}`,
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: TELEGRAM_REQUEST_TIMEOUT_MS,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(null); }
            });
        });
        req.on('timeout', () => req.destroy(new Error(`Telegram ${method} request timed out`)));
        req.on('error', (error) => {
            console.error(`[Telegram] ${method} failed:`, error.message);
            resolve(null);
        });
        req.write(body);
        req.end();
    });
}

/**
 * Sends a message to the configured Telegram chat using MarkdownV2.
 */
async function sendTelegramMessage(text, replyMarkup = null, silent = false, protectContent = true) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.warn('[Telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set. Skipping notification.');
        return;
    }

    const payload = {
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'MarkdownV2',
        protect_content: protectContent
    };

    if (silent) {
        payload.disable_notification = true;
    }

    if (replyMarkup) {
        payload.reply_markup = replyMarkup;
    }

    return telegramJsonRequest('sendMessage', payload);
}

/**
 * Deletes a previously sent Telegram message by its message_id.
 */
async function deleteTelegramMessage(messageId) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !messageId) return;

    return telegramJsonRequest('deleteMessage', {
        chat_id: TELEGRAM_CHAT_ID,
        message_id: messageId
    });
}

/**
 * Escapes all MarkdownV2 special characters.
 * Must be applied to every dynamic value inserted into the message.
 */
function e(text) {
    if (text === null || text === undefined) return 'N/A';
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/**
 * Formats a transaction into a rich, readable Telegram MarkdownV2 message.
 */
function formatTransactionMessage(tx, action = 'new') {
    const isIncome = tx.Category === 'Income';
    const isInternal = tx.Category === 'Internal';
    const portfolioAction = tx.PortfolioAction || null;
    const isTrade = portfolioAction === 'BUY' || portfolioAction === 'SELL';
    const sign = isTrade ? '' : (isInternal ? '' : (isIncome ? '+' : '-'));
    const amountStr = `${sign}$${parseFloat(tx.Amount).toFixed(2)}`;
    const headerEmoji = action === 'updated' ? '🔄' : (isTrade ? '📈' : (isInternal ? '🔄' : (isIncome ? '💰' : '💸')));
    const headerLabel = action === 'updated'
        ? 'Transaction Updated'
        : (isTrade ? `${portfolioAction} Order Filled` : (isInternal ? 'Internal Transfer' : (isIncome ? 'Income Received' : 'Expense Detected')));
    const amountEmoji = isTrade ? '⚪' : (isInternal ? '🔄' : (isIncome ? '✅' : '🔴'));
    const divider     = e('─────────────────────');

    const lines = [
        `${headerEmoji} *${e(headerLabel)}*`,
        divider,
        `${amountEmoji} *${e(amountStr)}*`,
        divider,
        `🏷  *Label*      ${e(tx.Label)}`,
        `📝  *Reason*`,
        `**>${e(tx.Reason)}`,
        `💳  *Type*        ${e(tx.Type)}`,
    ];

    if (isTrade) {
        lines.push(divider);
        lines.push(`📊  *Action*      ${e(portfolioAction)}`);
        lines.push(`🔤  *Symbol*      ${e(tx.PortfolioSymbol)}`);
        lines.push(`🔢  *Shares*      ${e(tx.PortfolioQuantity)}`);
        lines.push(`💵  *Price/share* ${e('$' + Number(tx.PortfolioPrice).toFixed(4))}`);
    }

    if (tx.BankName || tx.Account) {
        lines.push(divider);
        if (tx.BankName)        lines.push(`🏦  *Bank*         ${e(tx.BankName)}`);
        if (tx.Account)         lines.push(`🔢  *Account*   \`${tx.Account}\``);
        if (tx.ReferenceNumber) lines.push(`🔑  *Ref*             \`${tx.ReferenceNumber}\``);
    }

    const date = tx.Timestamp
        ? new Date(tx.Timestamp).toLocaleString('en-CA', {
            timeZone: 'America/Toronto',
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })
        : 'N/A';

    lines.push(divider);
    lines.push(`📅  *${e(date)}*`);

    return lines.join('\n');
}

function transactionActionKeyboard(tx) {
    if (!tx?.id) return null;
    return {
        inline_keyboard: [[
            { text: '🏷️ Recategorize', callback_data: `recat:${tx.id}` },
            { text: '🔄 Internal Transfer', callback_data: `transfer:${tx.id}` },
        ]],
    };
}

async function editTelegramTransactionMessage(messageId, tx, action = 'updated') {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !messageId) return null;
    return editTelegramMessage(
        messageId,
        formatTransactionMessage(tx, action),
        transactionActionKeyboard(tx)
    );
}

function categoryPickerRichMessage(txId) {
    const button = (label, category, value, style = 'primary') =>
        `<tg-button type="callback_data" style="${style}" data="setcat:${txId}:${category}:${value}">${label}</tg-button>`;
    return {
        html: `<h3>Choose a category</h3><p>This selection is temporary and will not add another chat message.</p>
<tg-button-row align="center">${button('Groceries', 'Expense', 'Groceries')}${button('Dining', 'Expense', 'Dining')}</tg-button-row>
<tg-button-row align="center">${button('Transport', 'Expense', 'Transportation')}${button('Shopping', 'Expense', 'Shopping')}</tg-button-row>
<tg-button-row align="center">${button('Housing', 'Expense', 'Housing &amp; Utilities')}<tg-button type="callback_data" style="link" data="cancel:${txId}">Cancel</tg-button></tg-button-row>`,
        skip_entity_detection: true,
    };
}

async function sendEphemeralCategoryPicker(callbackQuery, txId) {
    const receiverUserId = callbackQuery?.from?.id;
    if (!TELEGRAM_CHAT_ID || !receiverUserId || !callbackQuery?.id) return null;
    return telegramJsonRequest('sendRichMessage', {
        chat_id: TELEGRAM_CHAT_ID,
        rich_message: categoryPickerRichMessage(txId),
        disable_notification: true,
        ephemeral_message_parameters: {
            receiver_user_id: receiverUserId,
            callback_query_id: callbackQuery.id,
            replace_callback_query_message: true,
        },
    });
}

async function sendTelegramDocument(filename, content, caption = '', { silent = true, protectContent = true } = {}) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return null;
    const boundary = `----MoniMonitor${Date.now().toString(16)}`;
    const fields = [
        ['chat_id', TELEGRAM_CHAT_ID], ['caption', caption],
        ['disable_notification', String(silent)], ['protect_content', String(protectContent)],
    ].map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    const document = Buffer.from(content);
    const fileHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: text/csv; charset=utf-8\r\n\r\n`);
    const body = Buffer.concat([...fields, fileHeader, document, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.telegram.org', path: `/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, method: 'POST',
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
            timeout: TELEGRAM_REQUEST_TIMEOUT_MS,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        });
        req.on('timeout', () => req.destroy(new Error('Telegram sendDocument request timed out')));
        req.on('error', () => resolve(null));
        req.write(body);
        req.end();
    });
}

let lastUpdateId = 0;

function startTelegramPolling(onUpdate) {
    if (!TELEGRAM_BOT_TOKEN) return;
    
    console.log('[Telegram] Started polling for bot updates...');
    
    const poll = () => {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
        const request = https.get(url, { timeout: TELEGRAM_REQUEST_TIMEOUT_MS + 35_000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', async () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.ok && parsed.result.length > 0) {
                        for (const update of parsed.result) {
                            lastUpdateId = Math.max(lastUpdateId, update.update_id);
                            await onUpdate(update);
                        }
                    }
                } catch (e) {
                    console.error('[Telegram] Polling parse error:', e.message);
                }
                poll();
            });
        });
        request.on('timeout', () => request.destroy(new Error('Telegram polling request timed out')));
        request.on('error', (err) => {
            console.error('[Telegram] Polling network error:', err.message);
            setTimeout(poll, 5000);
        });
    };
    
    poll();
}

async function editTelegramMessage(messageId, text, replyMarkup = null) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !messageId) return;

    const isInlineMessage = typeof messageId === 'string' && !/^\d+$/.test(messageId);
    const payload = {
        ...(isInlineMessage
            ? { inline_message_id: messageId }
            : { chat_id: TELEGRAM_CHAT_ID, message_id: messageId }),
        text,
        parse_mode: 'MarkdownV2'
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    return telegramJsonRequest('editMessageText', payload);
}

async function setTelegramReaction(messageId, emoji) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !messageId) return;

    const payload = {
        chat_id: TELEGRAM_CHAT_ID,
        message_id: messageId,
        reaction: [{ type: "emoji", emoji: emoji }]
    };

    return telegramJsonRequest('setMessageReaction', payload);
}

async function answerTelegramInlineQuery(inlineQueryId, results) {
    if (!TELEGRAM_BOT_TOKEN || !inlineQueryId) return;

    const payload = {
        inline_query_id: inlineQueryId,
        results: results,
        cache_time: 0 // Don't cache so it updates live
    };

    return telegramJsonRequest('answerInlineQuery', payload);
}

async function answerTelegramCallbackQuery(callbackQueryId, text = null) {
    if (!TELEGRAM_BOT_TOKEN || !callbackQueryId) return null;
    return telegramJsonRequest('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        ...(text ? { text: String(text).slice(0, 200) } : {}),
    });
}

module.exports = { sendTelegramMessage, deleteTelegramMessage, formatTransactionMessage, transactionActionKeyboard, editTelegramTransactionMessage, sendEphemeralCategoryPicker, sendTelegramDocument, startTelegramPolling, editTelegramMessage, setTelegramReaction, answerTelegramInlineQuery, answerTelegramCallbackQuery, telegramJsonRequest, e };
