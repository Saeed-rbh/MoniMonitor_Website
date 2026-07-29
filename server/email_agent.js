require('dotenv').config();
const { ImapService } = require('./src/services/imapService');
const { parseEmailWithGemini } = require('./src/services/aiService');
const dbService = require('./src/database/dbService');
const { sendTelegramMessage, deleteTelegramMessage, formatTransactionMessage, startTelegramPolling, editTelegramMessage, setTelegramReaction, answerTelegramInlineQuery } = require('./src/services/telegramService');

const IMAP_HOST = 'imap.gmail.com';
const IMAP_PORT = 993;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASSWORD = process.env.IMAP_PASSWORD;
const USER_ID = process.env.USER_ID;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AI_INGESTION_ENABLED = process.env.AI_INGESTION_ENABLED === "true";
const WEB_APP_URL = process.env.PUBLIC_APP_URL ||
    (process.env.FRONTEND_URL || "").split(",").map((url) => url.trim()).find((url) => url.startsWith("https://")) ||
    "http://localhost:3000";

if (AI_INGESTION_ENABLED && !USER_ID) throw new Error("USER_ID must be configured before starting the email agent");

async function writeAudit(action, status, details = {}) {
    if (!USER_ID) return;
    try {
        await dbService.writeAgentAudit(USER_ID, action, status, details);
    } catch (error) {
        console.error('[Agent audit] Failed to record audit event:', error.message);
    }
}

async function updateAgentTransaction(id, updates) {
    const existing = await dbService.getTransactionById(id, USER_ID);
    if (!existing) return null;
    await dbService.updateTransactionForUser(id, USER_ID, updates);
    await writeAudit('transaction_updated', 'success', { transactionId: id, fields: Object.keys(updates) });
    return { ...existing, ...updates };
}

function isAuthorizedTelegramUpdate(update) {
    if (!TELEGRAM_CHAT_ID) return false;
    const chatId = update.callback_query?.message?.chat?.id ?? update.message?.chat?.id;
    return chatId !== undefined && String(chatId) === String(TELEGRAM_CHAT_ID);
}

// A transaction is "generic" only when both Label AND Reason are vague bank placeholders.
// Uses the new label taxonomy from aiService.js
const isGeneric = (l = "", r = "") => {
    const label = l.toLowerCase().trim();
    const reason = r.toLowerCase().trim();
    const genericLabels = ['bank deposit', 'e-transfer out', 'withdrawal', 'deposit'];
    const genericReasons = ['withdrawal', 'deposit', 'bank withdrawal', 'bank deposit', 'rbc royal bank deposit', 'interac e-transfer'];
    return genericLabels.includes(label) && genericReasons.includes(reason);
};

/**
 * Sends a Telegram notification and saves the message_id back to the transaction row.
 */
async function notifyAndSave(tx) {
    const webAppUrl = WEB_APP_URL;
    const isHttps = webAppUrl.startsWith('https');
    
    const replyMarkup = {
        inline_keyboard: [
            [
                { text: "🏷️ Recategorize", callback_data: `recat:${tx.id}` },
                { text: "💰 Mark Saving", callback_data: `save:${tx.id}` }
            ]
        ]
    };
    
    if (isHttps) {
        replyMarkup.inline_keyboard.push([{ text: "📊 Open Dashboard", web_app: { url: webAppUrl } }]);
    }

    const silent = isGeneric(tx.Label, tx.Reason) || parseFloat(tx.Amount) < 5.0;

    const result = await sendTelegramMessage(formatTransactionMessage(tx), replyMarkup, silent, true);
    const msgId = result?.result?.message_id || null;
    if (msgId) {
        await updateAgentTransaction(tx.id, { TelegramMessageId: msgId });
    }
    return msgId;
}

/**
 * Deletes the old Telegram message for a transaction (if any), sends a fresh one,
 * and saves the new message_id.
 */
async function replaceNotification(tx) {
    if (tx.TelegramMessageId) {
        await deleteTelegramMessage(tx.TelegramMessageId);
    }
    await notifyAndSave(tx);
}

async function onNewEmail(emailBody, idInfo, receivedAt) {
    try {
        console.log(`[${idInfo}] Sending to Gemini for analysis...`);

        // Fetch user's known accounts and inject into AI prompt for better type classification
        const knownAccounts = await dbService.getAccountsForUser(USER_ID);
        const expenseData = await parseEmailWithGemini(emailBody, knownAccounts);

        if (!expenseData) {
            console.log(`[${idInfo}] Parsing failed due to error or hallucination. Retrying later.`);
            return false;
        }

        if (expenseData.error) {
            console.log(`[${idInfo}] AI rejected email: ${expenseData.error}`);
            return true;
        }

        // Apply learned merchant rules (user category/label overrides)
        const rule = await dbService.getMerchantRuleForReason(USER_ID, expenseData.Reason);
        if (rule) {
            console.log(`[${idInfo}] Override matched: setting Category (${expenseData.Category} -> ${rule.category}) and Label (${expenseData.Label} -> ${rule.label})`);
            expenseData.Category = rule.category;
            expenseData.Label = rule.label;
        }

        console.log(`[${idInfo}] Successfully extracted expense:`, expenseData);
        expenseData.userId = USER_ID;
        expenseData.ReceivedAt = receivedAt || new Date().toISOString();

        if (!expenseData.Timestamp) {
            expenseData.Timestamp = new Date().toISOString();
        }

        // 1. Exact duplicate check
        const datePrefix = expenseData.Timestamp.substring(0, 10);
        const duplicate = await dbService.findDuplicateTransaction(USER_ID, expenseData.Amount, expenseData.Category, datePrefix, expenseData.Reason, expenseData.ReferenceNumber);
        if (duplicate) {
            console.log(`[${idInfo}] Duplicate expense detected. Skipping save.`);
            return true;
        }

        const newIsGeneric = isGeneric(expenseData.Label, expenseData.Reason);

        // 2. Fetch all matching transactions within the time window
        const rawMatches = await dbService.getDb().then(db => db.all(
            `SELECT * FROM transactions WHERE userId = ? AND AmountMinor = ? AND Category = ?`,
            [USER_ID, Math.round(Number(expenseData.Amount) * 100), expenseData.Category]
        ));

        const newTime = new Date(expenseData.Timestamp).getTime();
        const allMatches = rawMatches.filter(m => {
            const existingTime = new Date(m.Timestamp).getTime();
            const diffHours = Math.abs(newTime - existingTime) / (1000 * 60 * 60);
            const isETransfer = (expenseData.Type || '').toLowerCase().includes('transfer') || (expenseData.Label || '').toLowerCase().includes('transfer');
            const mIsETransfer = (m.Type || '').toLowerCase().includes('transfer') || (m.Label || '').toLowerCase().includes('transfer');
            return diffHours <= ((isETransfer || mIsETransfer) ? 720 : 48);
        });

        // 3. Fuzzy duplicate check (e.g. e-Transfer sent vs received)
        const fuzzyDuplicate = allMatches.find(m => {
            if (isGeneric(m.Label, m.Reason) || newIsGeneric) return false;
            if (m.ReferenceNumber && expenseData.ReferenceNumber && m.ReferenceNumber !== expenseData.ReferenceNumber) return false;
            const existingReason = m.Reason.toLowerCase();
            const newReason = expenseData.Reason.toLowerCase();
            return existingReason.includes(newReason) || newReason.includes(existingReason);
        });

        let activeId = null;

        if (fuzzyDuplicate) {
            console.log(`[${idInfo}] Fuzzy duplicate detected (complementary emails). Merging & replacing notification.`);
            const mergedUpdates = {
                Account: expenseData.Account || fuzzyDuplicate.Account,
                BankName: expenseData.BankName || fuzzyDuplicate.BankName,
                ReferenceNumber: expenseData.ReferenceNumber || fuzzyDuplicate.ReferenceNumber
            };
            await updateAgentTransaction(fuzzyDuplicate.id, mergedUpdates);
            activeId = fuzzyDuplicate.id;
            // Delete old Telegram message → send fresh complete one
            await replaceNotification({ ...fuzzyDuplicate, ...mergedUpdates });
        } else {
            // Sort matches by timestamp closeness
            const sortedMatches = [...allMatches].sort((a, b) =>
                Math.abs(new Date(a.Timestamp).getTime() - newTime) -
                Math.abs(new Date(b.Timestamp).getTime() - newTime)
            );

            const genericMatch = sortedMatches.find(m => isGeneric(m.Label, m.Reason));

            if (genericMatch && !newIsGeneric) {
                // Upgrade generic → specific: delete old message, send fresh
                console.log(`[${idInfo}] Upgrading generic to specific: ${expenseData.Reason}`);
                const specificUpdates = {
                    Label: expenseData.Label,
                    Reason: expenseData.Reason,
                    Type: expenseData.Type,
                    Account: expenseData.Account || genericMatch.Account,
                    BankName: expenseData.BankName || genericMatch.BankName,
                    ReferenceNumber: expenseData.ReferenceNumber || genericMatch.ReferenceNumber
                };
                await updateAgentTransaction(genericMatch.id, specificUpdates);
                activeId = genericMatch.id;
                // Delete old generic message → send one clean specific message
                await replaceNotification({ ...genericMatch, ...specificUpdates });

            } else if (newIsGeneric) {
                const existingSpecific = allMatches.find(m => !isGeneric(m.Label, m.Reason));
                if (existingSpecific) {
                    // Specific already exists — just silently update account/bank
                    console.log(`[${idInfo}] Generic alert for already-detailed transaction. Updating account info silently.`);
                    await updateAgentTransaction(existingSpecific.id, {
                        Account: expenseData.Account || existingSpecific.Account,
                        BankName: expenseData.BankName || existingSpecific.BankName
                    });
                    activeId = existingSpecific.id;
                } else {
                    // No specific yet — save generic and send a message (will be replaced later)
                    const newId = await dbService.addTransaction(expenseData);
                    activeId = newId;
                    console.log(`[${idInfo}] Saved generic. Sending placeholder notification.`);
                    await notifyAndSave({ ...expenseData, id: newId });
                }
            } else {
                // Brand new specific transaction
                const newId = await dbService.addTransaction(expenseData);
                activeId = newId;
                console.log(`[${idInfo}] Saved specific to SQLite successfully!`);
                await notifyAndSave({ ...expenseData, id: newId });
            }
        }

        // Account tracking
        if (expenseData.Account && expenseData.BankName) {
            const added = await dbService.trackAccount(USER_ID, expenseData.Account, expenseData.BankName, expenseData.Type, expenseData.Timestamp);
            if (added) console.log(`[${idInfo}] Added new account: ${expenseData.BankName} - ${expenseData.Account}`);
        }

        // Trigger auto-recurrence detection if we modified or added a transaction
        if (activeId) {
            try {
                await dbService.detectAndMarkRecurring(USER_ID, activeId);
            } catch (err) {
                console.error(`[${idInfo}] Error detecting recurrence:`, err.message);
            }
        }

        await writeAudit('email_processed', 'success', { messageId: idInfo, transactionId: activeId });
        return true;
    } catch (err) {
        await writeAudit('email_processed', 'error', { messageId: idInfo, error: err.message });
        console.error(`[${idInfo}] Unexpected error processing email:`, err);
        return false;
    }
}

async function onTelegramUpdate(update) {
    try {
        if (!isAuthorizedTelegramUpdate(update)) {
            console.warn('[Telegram] Ignored update from an unlinked chat.');
            return;
        }

        if (update.inline_query) {
            const queryId = update.inline_query.id;
            const queryText = update.inline_query.query.trim();
            const userId = USER_ID;
            
            let results = [];
            if (queryText.length > 0) {
                const txs = await dbService.getAllTransactionsForUser(userId, { search: queryText, limit: 15 });
                results = txs.map(tx => {
                    const isIncome = tx.Category === 'Income';
                    const sign = isIncome ? '+' : '-';
                    const webAppUrl = WEB_APP_URL;
                    const isHttps = webAppUrl.startsWith('https');
                    const replyMarkup = {
                        inline_keyboard: [
                            [
                                { text: "🏷️ Recategorize", callback_data: `recat:${tx.id}` },
                                { text: "💰 Mark Saving", callback_data: `save:${tx.id}` }
                            ]
                        ]
                    };
                    if (isHttps) replyMarkup.inline_keyboard.push([{ text: "📊 Open Dashboard", web_app: { url: webAppUrl } }]);

                    return {
                        type: 'article',
                        id: String(tx.id),
                        title: `${tx.Label || 'Transaction'} - ${sign}$${parseFloat(tx.Amount).toFixed(2)}`,
                        description: `Date: ${tx.Timestamp.split('T')[0]} | Category: ${tx.Category}`,
                        input_message_content: {
                            message_text: formatTransactionMessage(tx, 'new'),
                            parse_mode: 'MarkdownV2'
                        },
                        reply_markup: replyMarkup
                    };
                });
            }
            
            await answerTelegramInlineQuery(queryId, results);
            return;
        }

        if (update.callback_query) {
            const query = update.callback_query;
            const data = query.data;
            const messageId = query.message.message_id;
            
            if (data.startsWith('save:')) {
                const txId = data.split(':')[1];
                await updateAgentTransaction(txId, { Category: 'Saving', Label: 'Savings' });
                
                const db = await dbService.getDb();
                const tx = await db.get('SELECT * FROM transactions WHERE id = ? AND userId = ?', [txId, USER_ID]);
                if (tx && tx.Reason) {
                    await dbService.saveMerchantRule(tx.userId, tx.Reason, 'Saving', 'Savings');
                    const newText = formatTransactionMessage(tx, 'updated');
                    await editTelegramMessage(messageId, newText);
                }
            }
            else if (data.startsWith('recat:')) {
                const txId = data.split(':')[1];
                const replyMarkup = {
                    inline_keyboard: [
                        [
                            { text: "🛒 Groceries", callback_data: `setcat:${txId}:Expense:Groceries` },
                            { text: "🍔 Food", callback_data: `setcat:${txId}:Expense:Food & Dining` }
                        ],
                        [
                            { text: "🚗 Transport", callback_data: `setcat:${txId}:Expense:Transportation` },
                            { text: "🛍️ Shopping", callback_data: `setcat:${txId}:Expense:Shopping` }
                        ],
                        [
                            { text: "🏠 Bills", callback_data: `setcat:${txId}:Expense:Bills & Utilities` },
                            { text: "🔙 Cancel", callback_data: `cancel:${txId}` }
                        ]
                    ]
                };
                
                const text = query.message.text ? query.message.text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&') + "\n\n*Select a new category:*" : "*Select a new category:*";
                await editTelegramMessage(messageId, text, replyMarkup);
            }
            else if (data.startsWith('setcat:')) {
                const parts = data.split(':');
                const txId = parts[1];
                const newCat = parts[2];
                const newLabel = parts[3];
                
                await updateAgentTransaction(txId, { Category: newCat, Label: newLabel });
                
                const db = await dbService.getDb();
                const tx = await db.get('SELECT * FROM transactions WHERE id = ? AND userId = ?', [txId, USER_ID]);
                if (tx && tx.Reason) {
                    await dbService.saveMerchantRule(tx.userId, tx.Reason, newCat, newLabel);
                    const newText = formatTransactionMessage(tx, 'updated');
                    await editTelegramMessage(messageId, newText);
                }
            }
            else if (data.startsWith('cancel:')) {
                const txId = data.split(':')[1];
                const db = await dbService.getDb();
                const tx = await db.get('SELECT * FROM transactions WHERE id = ? AND userId = ?', [txId, USER_ID]);
                if (tx) {
                    const newText = formatTransactionMessage(tx);
                    const webAppUrl = WEB_APP_URL;
                    const isHttps = webAppUrl.startsWith('https');
                    const dashboardButton = isHttps ? { text: "📊 Open Dashboard", web_app: { url: webAppUrl } } : { text: "📊 Open Dashboard", url: webAppUrl };
                    
                    const replyMarkup = {
                        inline_keyboard: [
                            [
                                { text: "🏷️ Recategorize", callback_data: `recat:${tx.id}` },
                                { text: "💰 Mark Saving", callback_data: `save:${tx.id}` }
                            ],
                            [ dashboardButton ]
                        ]
                    };
                    await editTelegramMessage(messageId, newText, replyMarkup);
                }
            }
        }
        
        if (update.message && update.message.text) {
            const text = update.message.text;
            const messageId = update.message.message_id;
            
            if (text.startsWith('/summary') || text.startsWith('/recent')) {
                await setTelegramReaction(messageId, "👀");
                const webAppUrl = WEB_APP_URL;
                const isHttps = webAppUrl.startsWith('https');
                const dashboardButton = isHttps ? { text: "📊 Open Dashboard", web_app: { url: webAppUrl } } : { text: "📊 Open Dashboard", url: webAppUrl };
                await sendTelegramMessage(`Open the 📊 Dashboard to view insights and recent transactions\\!`, {
                    inline_keyboard: [[dashboardButton]]
                });
            }
        }
    } catch (e) {
        console.error('[Telegram] Error processing update:', e);
    }
}

if (AI_INGESTION_ENABLED) {
    if (!IMAP_USER || !IMAP_PASSWORD || !TELEGRAM_CHAT_ID) {
        throw new Error('IMAP_USER, IMAP_PASSWORD, and TELEGRAM_CHAT_ID are required when AI ingestion is enabled');
    }

    startTelegramPolling(onTelegramUpdate);
    const emailListener = new ImapService(IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD, onNewEmail);
    emailListener.start();
} else {
    console.log('AI ingestion is disabled. Set AI_INGESTION_ENABLED=true after completing account linking.');
}
