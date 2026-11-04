const { recordAgentState } = require('./src/services/operationalStatus');
require('dotenv').config();
const { ImapService } = require('./src/services/imapService');
const { parseEmailWithGemini } = require('./src/services/aiService');
const dbService = require('./src/database/dbService');
const { normalizeEmailEvidence, parseStructuredEmail } = require('./src/services/emailEvidence');
const { withDatabaseTransaction } = require('./src/database/db');
const { sendTelegramMessage, deleteTelegramMessage, formatTransactionMessage, startTelegramPolling, editTelegramMessage, setTelegramReaction, answerTelegramInlineQuery, isInvestmentNotification } = require('./src/services/telegramService');

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

    const silent = isInvestmentNotification(tx) ||
        isGeneric(tx.Label, tx.Reason) || parseFloat(tx.Amount) < 5.0;

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

async function queueNotification(transactionId) {
    const db = await dbService.getDb();
    await db.run('INSERT OR IGNORE INTO email_notifications (transactionId, updatedAt) VALUES (?, ?)',
        [transactionId, new Date().toISOString()]);
}

let drainingNotifications = false;
async function drainNotifications() {
    if (drainingNotifications) return;
    drainingNotifications = true;
    try {
        const db = await dbService.getDb();
        const jobs = await db.all('SELECT transactionId FROM email_notifications');
        for (const job of jobs) {
            const tx = await dbService.getTransactionById(job.transactionId, USER_ID);
            if (!tx || tx.TelegramMessageId || await notifyAndSave(tx)) {
                await db.run('DELETE FROM email_notifications WHERE transactionId = ?', [job.transactionId]);
            }
        }
    } catch (error) { console.error('[Notifications] Retry pending:', error.message); }
    finally { drainingNotifications = false; }
}

async function syncPortfolioFromEmail(transactionId, data, idInfo) {
    if (!transactionId) return { status: 'ignored' };
    const result = await dbService.applyEmailPortfolioActivity(USER_ID, transactionId, {
        fromAccountId: data.TransferFromAccountId,
        toAccountId: data.TransferToAccountId,
        transferConfidence: data.TransferConfidence,
        accountId: data.PortfolioAccountId || data.BalanceAccountId,
        action: data.PortfolioAction,
        symbol: data.PortfolioSymbol,
        quantity: data.PortfolioQuantity,
        price: data.PortfolioPrice,
        confidence: data.PortfolioAccountId ? data.PortfolioConfidence : data.BalanceAccountConfidence,
    });
    if (result.status === 'applied') {
        console.log(
            `[${idInfo}] Portfolio ${result.action.toLowerCase()} applied to account ${result.accountId}: ${result.amountMinor} minor units.`
        );
        await writeAudit('portfolio_email_update', 'success', {
            transactionId, accountId: result.accountId, action: result.action,
            amountMinor: result.amountMinor, symbol: result.symbol || null,
            quantity: result.quantity || null, priceMinor: result.priceMinor || null,
        });
    } else if (result.status === 'review_required' || result.status === 'unmatched_account') {
        console.warn(`[${idInfo}] Portfolio email requires review: ${result.reason || result.status}`);
        await writeAudit('portfolio_email_update', 'review_required', {
            transactionId, proposedAccountId: data.PortfolioAccountId,
            proposedAction: data.PortfolioAction, reason: result.reason || result.status,
        });
    }
    return result;
}

async function onNewEmail(emailBody, idInfo, receivedAt) {
    try {
        const initialDb = await dbService.getDb();
        const initialJob = await initialDb.get('SELECT status FROM email_ingestion WHERE sourceKey = ?', [idInfo]);
        if (initialJob && initialJob.status !== 'pending') return true;
        console.log(`[${idInfo}] Sending to Gemini for analysis...`);

        // Bank accounts help classification; portfolio accounts allow a safe, explicit destination match.
        const [knownAccounts, investmentAccounts] = await Promise.all([
            dbService.getAccountsForUser(USER_ID),
            dbService.getInvestmentAccounts(USER_ID),
        ]);
        const aliases = await initialDb.all('SELECT * FROM email_account_aliases WHERE userId = ?', [USER_ID]);
        const structuredData = parseStructuredEmail(emailBody, investmentAccounts, aliases, receivedAt);
        const parsedData = structuredData || await parseEmailWithGemini(emailBody, knownAccounts, investmentAccounts);
        let expenseData = !structuredData && parsedData && !parsedData.error
            ? normalizeEmailEvidence(parsedData, emailBody, investmentAccounts, aliases) : parsedData;

        if (!expenseData) {
            console.log(`[${idInfo}] Parsing failed due to error or hallucination. Retrying later.`);
            return false;
        }

        if (expenseData.error) {
            console.log(`[${idInfo}] AI rejected email: ${expenseData.error}`);
            await initialDb.run("UPDATE email_ingestion SET status = 'ignored', lastError = ? WHERE sourceKey = ?", [expenseData.error, idInfo]);
            return true;
        }

        expenseData = await require('./src/services/reviewedEmailRoutes').routeEmailForUser(
            initialDb, USER_ID, expenseData, emailBody, investmentAccounts);

        return await withDatabaseTransaction(async () => {
        const jobDb = await dbService.getDb();
        const job = await jobDb.get('SELECT * FROM email_ingestion WHERE sourceKey = ?', [idInfo]);
        if (job && job.status !== 'pending') return true;
        // Apply learned merchant rules (user category/label overrides)
        const rule = await dbService.getMerchantRuleForReason(USER_ID, expenseData.Reason);
        if (rule && !expenseData.PortfolioAction) {
            console.log(`[${idInfo}] Override matched: setting Category (${expenseData.Category} -> ${rule.category}) and Label (${expenseData.Label} -> ${rule.label})`);
            expenseData.Category = rule.category;
            expenseData.Label = rule.label;
        }

        console.log(`[${idInfo}] Successfully extracted expense:`, expenseData);
        expenseData.PostingStatus = 'posted';
        expenseData.userId = USER_ID;
        expenseData.ReceivedAt = receivedAt || new Date().toISOString();

        if (!expenseData.Timestamp) {
            expenseData.Timestamp = new Date().toISOString();
        }

        // 1. Exact duplicate check
        // Source replay is definitive. A bank reference is scoped to account/currency;
        // identical purchases without a reference must remain separate transactions.
        const transferDuplicate = expenseData.PortfolioAction === 'TRANSFER' && expenseData.ReferenceNumber
            ? await jobDb.get(`SELECT * FROM transactions WHERE userId = ? AND ReferenceNumber = ?
                AND PortfolioAction = 'TRANSFER' AND TransferFromAccountId = ? AND TransferToAccountId = ?
                AND Currency = ? AND AmountMinor = ?`, [USER_ID, expenseData.ReferenceNumber,
                expenseData.TransferFromAccountId, expenseData.TransferToAccountId,
                expenseData.Currency || 'USD', Math.round(Number(expenseData.Amount) * 100)]) : null;
        const duplicate = transferDuplicate || (job?.transactionId
            ? await dbService.getTransactionById(job.transactionId, USER_ID)
            : expenseData.ReferenceNumber && expenseData.Account
                ? await jobDb.get(`SELECT * FROM transactions WHERE userId = ? AND ReferenceNumber = ?
                    AND Account = ? AND Currency = ? AND AmountMinor = ? AND Category = ?`,
                    [USER_ID, expenseData.ReferenceNumber, expenseData.Account, expenseData.Currency || 'USD',
                        Math.round(Number(expenseData.Amount) * 100), expenseData.Category])
                : null);

        let complementary = null;
        if (!duplicate && expenseData.NotificationKind) {
            const candidates = await jobDb.all(`SELECT * FROM transactions WHERE userId = ? AND AmountMinor = ?
                AND Currency = ? AND Category = ? AND NotificationKind IS NOT NULL`,
                [USER_ID, Math.round(Number(expenseData.Amount) * 100), expenseData.Currency, expenseData.Category]);
            const nearby = candidates.filter(t => {
                const gap = Math.abs(new Date(t.ReceivedAt) - new Date(receivedAt)) / 60000;
                const sameBank = (t.BankName || '').toLowerCase() === (expenseData.BankName || '').toLowerCase();
                const left = String(t.Account || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                const right = String(expenseData.Account || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                const sameAccount = left.length >= 4 && right.length >= 4 && left.slice(-4) === right.slice(-4);
                const conflictingRefs = t.ReferenceNumber && expenseData.ReferenceNumber && t.ReferenceNumber !== expenseData.ReferenceNumber;
                return !conflictingRefs && sameBank && (sameAccount || !expenseData.Account) && gap <= 360;
            });
            const pairs = nearby.filter(t => t.NotificationKind !== expenseData.NotificationKind &&
                (t.NotificationKind === 'interac' || expenseData.NotificationKind === 'interac') &&
                Math.abs(new Date(t.ReceivedAt) - new Date(receivedAt)) <= 15 * 60000 &&
                t.Account && expenseData.Account);
            if (pairs.length === 1 && nearby.length === 1) complementary = pairs[0];
            else if (nearby.length) {
                await jobDb.run("UPDATE email_ingestion SET status = 'review_required', lastError = ?, updatedAt = ? WHERE sourceKey = ?",
                    ['Possible complementary or repeated bank alert; candidate transactions: ' + nearby.map(t => t.id).join(','), new Date().toISOString(), idInfo]);
                return true;
            }
        }

        const newIsGeneric = isGeneric(expenseData.Label, expenseData.Reason);

        // 2. Fetch all matching transactions within the time window
        const rawMatches = await dbService.getDb().then(db => db.all(
            `SELECT * FROM transactions WHERE userId = ? AND AmountMinor = ? AND Category = ?`,
            [USER_ID, Math.round(Number(expenseData.Amount) * 100), expenseData.Category]
        ));

        const newTime = new Date(expenseData.Timestamp).getTime();
        const allMatches = rawMatches.filter(m => {
            if (!expenseData.ReferenceNumber || m.ReferenceNumber !== expenseData.ReferenceNumber ||
                !expenseData.Account || m.Account !== expenseData.Account ||
                m.Currency !== (expenseData.Currency || 'USD')) return false;
            const existingTime = new Date(m.Timestamp).getTime();
            const diffHours = Math.abs(newTime - existingTime) / (1000 * 60 * 60);
            const isETransfer = (expenseData.Type || '').toLowerCase().includes('transfer') || (expenseData.Label || '').toLowerCase().includes('transfer');
            const mIsETransfer = (m.Type || '').toLowerCase().includes('transfer') || (m.Label || '').toLowerCase().includes('transfer');
            return diffHours <= ((isETransfer || mIsETransfer) ? 720 : 48);
        });

        // 3. Fuzzy duplicate check (e.g. e-Transfer sent vs received)
        const fuzzyDuplicate = duplicate || complementary || allMatches.find(m => {
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
            await queueNotification(fuzzyDuplicate.id);
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
                await queueNotification(genericMatch.id);

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
                    await queueNotification(newId);
                }
            } else {
                // Brand new specific transaction
                const newId = await dbService.addTransaction(expenseData);
                activeId = newId;
                console.log(`[${idInfo}] Saved specific to SQLite successfully!`);
                await queueNotification(newId);
            }
        }

        let needsReview = false;
        const reviewReasons = [];
        // Account tracking
        // Apply an explicit portfolio cash movement once, linked to the source transaction.
        if (activeId) {
            const portfolioResult = await syncPortfolioFromEmail(activeId, expenseData, idInfo);
            needsReview = ['review_required', 'unmatched_account'].includes(portfolioResult.status);
            if (needsReview) reviewReasons.push(portfolioResult.reason || portfolioResult.status);
            const accountPosting = await dbService.syncTransactionAccountBalance(USER_ID, activeId, {
                accountId: expenseData.BalanceAccountId,
                confidence: expenseData.BalanceAccountConfidence,
            });
            const accountNeedsReview = ['review_required', 'unmatched_account', 'ambiguous_account'].includes(accountPosting.status);
            if (accountNeedsReview) reviewReasons.push(accountPosting.reason || accountPosting.status);
            needsReview ||= accountNeedsReview;
            if (accountPosting.status === 'applied') {
                console.log(
                    `[${idInfo}] Posted transaction to ${accountPosting.accountName}: ${accountPosting.deltaMinor} minor units.`
                );
                await writeAudit('account_balance_update', 'success', {
                    transactionId: activeId, accountId: accountPosting.accountId,
                    deltaMinor: accountPosting.deltaMinor, cashMinor: accountPosting.cashMinor,
                });
            } else if (accountPosting.status === 'ambiguous_account' || accountPosting.status === 'unmatched_account') {
                console.warn(`[${idInfo}] Transaction saved but account posting was ${accountPosting.status}.`);
                await writeAudit('account_balance_update', 'review_required', {
                    transactionId: activeId, reason: accountPosting.status,
                });
            }
        }
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

        await jobDb.run("UPDATE email_ingestion SET status = ?, lastError = ?, transactionId = ?, updatedAt = ? WHERE sourceKey = ?", [needsReview ? 'review_required' : 'applied', needsReview ? [...new Set(reviewReasons)].join('; ') : null, activeId, new Date().toISOString(), idInfo]);
        await writeAudit('email_processed', 'success', { messageId: idInfo, transactionId: activeId });
        return true;
        });
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
                await dbService.editTransaction(USER_ID, txId, { Category: 'Saving', Label: 'Savings' });
                
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
                
                await dbService.editTransaction(USER_ID, txId, { Category: newCat, Label: newLabel });
                
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

let reconciling = false;
async function retryUnpostedBalances() {
    if (reconciling) return;
    reconciling = true;
    try {
        await dbService.reconcileEmailPortfolioActivities(USER_ID);
        await dbService.reconcileTransactionAccountBalances(USER_ID);
        const db = await dbService.getDb();
        await db.run(`UPDATE email_ingestion SET status = 'applied', lastError = NULL, updatedAt = ?
            WHERE status = 'review_required' AND transactionId IN (
                SELECT t.id FROM transactions t WHERE t.userId = ?
                AND ((t.PortfolioAction IS NULL AND EXISTS (
                    SELECT 1 FROM account_balance_events e WHERE e.sourceTransactionId = t.id))
                    OR (t.PortfolioAction IS NOT NULL AND EXISTS (
                    SELECT 1 FROM portfolio_transactions p WHERE p.sourceTransactionId = t.id))))`,
            [new Date().toISOString(), USER_ID]);
    } catch (error) { console.error('[Balances] Reconciliation retry pending:', error.message); }
    finally { reconciling = false; }
}

async function startAgent() {
    if (AI_INGESTION_ENABLED) {
        if (!IMAP_USER || !IMAP_PASSWORD) {
            throw new Error('IMAP_USER and IMAP_PASSWORD are required when AI ingestion is enabled');
        }

        await recordAgentState({ connected: false, lastError: null, lastScanAt: null });
        setInterval(() => recordAgentState({}).catch(error => console.error('[Agent heartbeat]', error.message)), 30_000).unref();
        const portfolioReconciled = await dbService.reconcileEmailPortfolioActivities(USER_ID);
        const portfolioApplied = portfolioReconciled.filter((result) => result.status === 'applied');
        if (portfolioReconciled.length) {
            console.log(`[Portfolio] Reconciled ${portfolioApplied.length}/${portfolioReconciled.length} unapplied activity record(s).`);
            for (const result of portfolioReconciled.filter((item) => item.status !== 'applied' && item.status !== 'duplicate')) {
                console.warn(`[Portfolio] Transaction ${result.transactionId}: ${result.status}${result.reason ? ` (${result.reason})` : ''}.`);
            }
        }

        const reconciled = await dbService.reconcileTransactionAccountBalances(USER_ID);
        const applied = reconciled.filter((result) => result.status === 'applied');
        if (reconciled.length) {
            console.log(`[Account balances] Reconciled ${applied.length}/${reconciled.length} unposted transaction(s).`);
            for (const result of reconciled.filter((item) => item.status !== 'applied' && item.status !== 'not_balance_posting')) {
                console.warn(`[Account balances] Transaction ${result.transactionId}: ${result.status}.`);
            }
        }
        setInterval(retryUnpostedBalances, 60_000).unref();
        await drainNotifications();
        setInterval(drainNotifications, 60_000).unref();
        startTelegramPolling(onTelegramUpdate);
        const emailListener = new ImapService(IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD, async (...args) => {
            const result = await onNewEmail(...args);
            await drainNotifications();
            return result;
        });
        await emailListener.start();
    } else {
        console.log('AI ingestion is disabled. Set AI_INGESTION_ENABLED=true after completing account linking.');
    }
}

if (require.main === module) {
    startAgent().catch((error) => {
        console.error('[Agent] Startup failed:', error);
        process.exitCode = 1;
    });
}

module.exports = { onNewEmail };
