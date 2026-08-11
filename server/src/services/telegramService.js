const https = require('https');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

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

    const body = JSON.stringify(payload);

    return new Promise((resolve) => {
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const parsed = JSON.parse(data);
                if (!parsed.ok) {
                    console.error('[Telegram] API error:', parsed.description);
                }
                resolve(parsed);
            });
        });

        req.on('error', (err) => {
            console.error('[Telegram] Failed to send message:', err.message);
            resolve(null);
        });

        req.write(body);
        req.end();
    });
}

/**
 * Deletes a previously sent Telegram message by its message_id.
 */
async function deleteTelegramMessage(messageId) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !messageId) return;

    const body = JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        message_id: messageId
    });

    return new Promise((resolve) => {
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/deleteMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', (err) => {
            console.error('[Telegram] Failed to delete message:', err.message);
            resolve(null);
        });
        req.write(body);
        req.end();
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
    const portfolioAction = tx.PortfolioAction || null;
    const isTrade = portfolioAction === 'BUY' || portfolioAction === 'SELL';
    const sign = isTrade ? '' : (isIncome ? '+' : '-');
    const amountStr = `${sign}$${parseFloat(tx.Amount).toFixed(2)}`;
    const headerEmoji = action === 'updated' ? '🔄' : (isTrade ? '📈' : (isIncome ? '💰' : '💸'));
    const headerLabel = action === 'updated'
        ? 'Transaction Updated'
        : (isTrade ? `${portfolioAction} Order Filled` : (isIncome ? 'Income Received' : 'Expense Detected'));
    const amountEmoji = isTrade ? '⚪' : (isIncome ? '✅' : '🔴');
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

let lastUpdateId = 0;

function startTelegramPolling(onUpdate) {
    if (!TELEGRAM_BOT_TOKEN) return;
    
    console.log('[Telegram] Started polling for bot updates...');
    
    const poll = () => {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
        
        https.get(url, (res) => {
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
        }).on('error', (err) => {
            console.error('[Telegram] Polling network error:', err.message);
            setTimeout(poll, 5000);
        });
    };
    
    poll();
}

async function editTelegramMessage(messageId, text, replyMarkup = null) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !messageId) return;

    const payload = {
        chat_id: TELEGRAM_CHAT_ID,
        message_id: messageId,
        text,
        parse_mode: 'MarkdownV2'
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    const body = JSON.stringify(payload);
    return new Promise((resolve) => {
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/editMessageText`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', () => resolve(null));
        req.write(body);
        req.end();
    });
}

async function setTelegramReaction(messageId, emoji) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !messageId) return;

    const payload = {
        chat_id: TELEGRAM_CHAT_ID,
        message_id: messageId,
        reaction: [{ type: "emoji", emoji: emoji }]
    };

    const body = JSON.stringify(payload);
    return new Promise((resolve) => {
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/setMessageReaction`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', () => resolve(null));
        req.write(body);
        req.end();
    });
}

async function answerTelegramInlineQuery(inlineQueryId, results) {
    if (!TELEGRAM_BOT_TOKEN || !inlineQueryId) return;

    const payload = {
        inline_query_id: inlineQueryId,
        results: results,
        cache_time: 0 // Don't cache so it updates live
    };

    const body = JSON.stringify(payload);
    return new Promise((resolve) => {
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/answerInlineQuery`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', () => resolve(null));
        req.write(body);
        req.end();
    });
}

module.exports = { sendTelegramMessage, deleteTelegramMessage, formatTransactionMessage, startTelegramPolling, editTelegramMessage, setTelegramReaction, answerTelegramInlineQuery };
