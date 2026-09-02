require('dotenv').config();
const { ImapService } = require('./src/services/imapService');
const { parseEmailWithGemini, formatETransferReason } = require('./src/services/aiService');
const dbService = require('./src/database/dbService');
const { SNAPSHOT_CAPTURED_AT } = require('./src/database/financialSnapshot');
const { normalizeTransactionSemantics } = require('./src/services/transactionSemantics');
const { sendTelegramMessage, deleteTelegramMessage, formatTransactionMessage, transactionActionKeyboard, editTelegramTransactionMessage, sendEphemeralCategoryPicker, sendTelegramDocument, startTelegramPolling, editTelegramMessage, setTelegramReaction, answerTelegramInlineQuery, answerTelegramCallbackQuery, e } = require('./src/services/telegramService');
const { startTelegramOutboxWorker } = require('./src/services/telegramOutboxWorker');

const IMAP_HOST = 'imap.gmail.com';
const IMAP_PORT = 993;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASSWORD = process.env.IMAP_PASSWORD;
const USER_ID = process.env.USER_ID;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID || process.env.TELEGRAM_CHAT_ID;
const AI_INGESTION_ENABLED = process.env.AI_INGESTION_ENABLED === "true";
const IMAP_INITIAL_SYNC_SINCE = process.env.IMAP_INITIAL_SYNC_SINCE || SNAPSHOT_CAPTURED_AT;
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
    if (!TELEGRAM_CHAT_ID || !TELEGRAM_USER_ID) return false;
    const chatId = update.callback_query?.message?.chat?.id ?? update.message?.chat?.id;
    const senderId = update.callback_query?.from?.id ?? update.message?.from?.id ?? update.inline_query?.from?.id;
    if (update.inline_query || (update.callback_query?.inline_message_id && chatId === undefined)) {
        // Telegram does not include a chat id in inline-query updates. Sender
        // authorization is therefore the strongest available check here.
        return senderId !== undefined && String(senderId) === String(TELEGRAM_USER_ID);
    }
    return chatId !== undefined && senderId !== undefined &&
        String(chatId) === String(TELEGRAM_CHAT_ID) && String(senderId) === String(TELEGRAM_USER_ID);
}

// A transaction is "generic" when its Reason or Label is a vague bank placeholder
const isGeneric = (l = "", r = "") => {
    const label = String(l || "").toLowerCase().trim();
    const reason = String(r || "").toLowerCase().trim();
    const genericLabels = [
        'bank deposit', 'deposit', 'deposits', 'cash & cheque deposits',
        'cash deposits', 'withdrawal', 'withdrawals', 'e-transfer out',
        'e-transfer in', 'other expense', 'other income', 'uncategorized'
    ];
    const genericReasons = [
        'withdrawal', 'deposit', 'deposit notice', 'bank withdrawal',
        'bank deposit', 'rbc royal bank deposit', 'rbc deposit',
        'interac e-transfer', 'e-transfer', 'electronic transfer',
        'funds transfer', 'transfer'
    ];
    return genericReasons.includes(reason) || (genericLabels.includes(label) && genericReasons.some(gr => reason.includes(gr)));
};

function enrichGenericEmailReason(transaction = {}) {
    if (!isGeneric(transaction.Label, transaction.Reason)) return transaction.Reason;
    const reason = String(transaction.Reason || transaction.Label || 'Bank transaction').trim();
    const accountText = String(transaction.Account || '').trim();
    const compactAccount = accountText.replace(/[^a-z0-9]/gi, '');
    const looksLikeReference = /[*•]/.test(accountText) || (/\d/.test(accountText) && compactAccount.length <= 20);
    const accountHint = looksLikeReference && compactAccount.length >= 4
        ? `••••${compactAccount.slice(-4)}`
        : accountText || null;
    const context = [transaction.BankName, transaction.Type, accountHint]
        .map((value) => String(value || '').trim())
        .filter((value, index, values) => value && values.indexOf(value) === index)
        .join(' ');
    if (!context) return reason;

    const normalized = reason.toLowerCase();
    if (normalized.includes('e-transfer') || normalized.includes('etransfer')) {
        if (transaction.AccountFlow === 'IN') return `${reason} received in ${context}`;
        if (transaction.AccountFlow === 'OUT') return `${reason} sent from ${context}`;
    }
    if (normalized === 'deposit' || normalized === 'transfer in') return `${reason} to ${context}`;
    if (normalized === 'withdrawal' || normalized === 'transfer out') return `${reason} from ${context}`;
    return `${reason} - ${context}`;
}

async function notifyAndSave(tx, { forceSilent = false } = {}) {
    const silent = forceSilent || isGeneric(tx.Label, tx.Reason) || parseFloat(tx.Amount) < 5.0;
    return dbService.enqueueTelegramOutbox('sendMessage', {
        text: formatTransactionMessage(tx),
        replyMarkup: transactionActionKeyboard(tx),
        silent,
        protectContent: true,
    }, { transactionId: tx.id });
}

/**
 * Deletes the old Telegram message for a transaction (if any), sends a fresh one,
 * and saves the new message_id.
 */
async function replaceNotification(tx) {
    if (tx.TelegramMessageId) {
        await deleteTelegramMessage(tx.TelegramMessageId);
    }
    // A replacement represents an update to an alert the user has already
    // seen, so do not generate a second Telegram notification.
    await notifyAndSave(tx, { forceSilent: true });
}

async function syncPortfolioFromEmail(transactionId, data, idInfo) {
    if (!transactionId) return { status: 'ignored' };
    const result = await dbService.applyEmailPortfolioActivity(USER_ID, transactionId, {
        accountId: data.PortfolioAccountId || data.BalanceAccountId,
        action: data.PortfolioAction,
        symbol: data.PortfolioSymbol,
        quantity: data.PortfolioQuantity,
        price: data.PortfolioPrice,
        toSymbol: data.PortfolioToSymbol,
        toQuantity: data.PortfolioToQuantity,
        accountFlow: data.AccountFlow,
        confidence: data.PortfolioConfidence === 'HIGH' || data.BalanceAccountConfidence === 'HIGH' ? 'HIGH' : data.PortfolioConfidence,
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

async function captureEmailSource(transactionId, sourceEmailKey, emailBody, rawEmailSource, receivedAt, parsedTransaction = null, idInfo = null) {
    if (!transactionId || !sourceEmailKey) return;
    await dbService.upsertTransactionSource({
        userId: USER_ID,
        provider: 'email',
        externalId: sourceEmailKey,
        transactionId,
        ownsTransaction: true,
        rawPayload: {
            source: 'email',
            rawMime: rawEmailSource || null,
            rawBody: String(emailBody || ''),
            receivedAt: receivedAt || null,
            messageId: idInfo || null,
            parsedTransaction,
        },
        contextPayload: {
            mailboxKey: sourceEmailKey.split(':').slice(0, 2).join(':'),
            sourceEmailKey,
        },
    });
}

function buildEmailIngestionSource(sourceEmailKey, emailBody, rawEmailSource, receivedAt, parsedTransaction, idInfo) {
    if (!sourceEmailKey) return null;
    return {
        provider: 'email',
        externalId: sourceEmailKey,
        rawPayload: {
            source: 'email', rawMime: rawEmailSource || null, rawBody: String(emailBody || ''),
            receivedAt: receivedAt || null, messageId: idInfo || null, parsedTransaction,
        },
        contextPayload: {
            mailboxKey: sourceEmailKey.split(':').slice(0, 2).join(':'),
            sourceEmailKey,
        },
    };
}

function buildTransactionNotification(transaction, suppressNotifications) {
    if (suppressNotifications) return null;
    return {
        action: 'sendMessage',
        payload: (transactionId) => {
            const tx = { ...transaction, id: transactionId };
            return {
                text: formatTransactionMessage(tx),
                replyMarkup: transactionActionKeyboard(tx),
                silent: isGeneric(tx.Label, tx.Reason) || parseFloat(tx.Amount) < 5.0,
                protectContent: true,
            };
        },
    };
}

async function onNewEmail(emailBody, idInfo, receivedAt, options = {}) {
    try {
        const {
            allowBeforeSnapshot = false,
            suppressNotifications = false,
            accountCutoffs = null,
            sourceEmailKey = null,
            rawEmailSource = null,
        } = options;
        const existingEmailTransaction = sourceEmailKey
            ? await dbService.getTransactionBySourceEmailKey(USER_ID, sourceEmailKey)
            : null;
        if (existingEmailTransaction && !isGeneric(existingEmailTransaction.Label, existingEmailTransaction.Reason)) {
            await captureEmailSource(
                existingEmailTransaction.id, sourceEmailKey, emailBody, rawEmailSource,
                receivedAt, null, idInfo
            );
            console.log(`[${idInfo}] Transaction was already saved for this email; completing the queue item.`);
            return true;
        }
        const receivedTime = new Date(receivedAt || 0).getTime();
        if (!allowBeforeSnapshot && Number.isFinite(receivedTime) && receivedTime < new Date(SNAPSHOT_CAPTURED_AT).getTime()) {
            console.log(`[${idInfo}] Email predates the financial snapshot; marking processed without analysis.`);
            return true;
        }
        console.log(`[${idInfo}] Sending to Gemini for analysis...`);

        // Bank accounts help classification; portfolio accounts allow a safe, explicit destination match.
        const [knownAccounts, investmentAccounts] = await Promise.all([
            dbService.getAccountsForUser(USER_ID),
            dbService.getInvestmentAccounts(USER_ID),
        ]);
        let expenseData = await parseEmailWithGemini(emailBody, knownAccounts, investmentAccounts);

        if (!expenseData) {
            console.log(`[${idInfo}] Parsing failed due to error or hallucination. Retrying later.`);
            return false;
        }

        if (expenseData.error) {
            console.log(`[${idInfo}] AI rejected email: ${expenseData.error}`);
            return true;
        }

        if (accountCutoffs) {
            const transactionTime = new Date(expenseData.Timestamp || receivedAt).getTime();
            const accountIds = [expenseData.BalanceAccountId, expenseData.PortfolioAccountId]
                .filter((value) => value !== null && value !== undefined)
                .map(String);
            const normalizedAccount = String(expenseData.Account || '').trim().toLowerCase();
            const cutoffValue = accountIds.map((id) => accountCutoffs.byId?.[id]).find(Boolean) ||
                accountCutoffs.byAlias?.[normalizedAccount] || null;

            if (!cutoffValue) {
                console.warn(`[${idInfo}] Replay skipped because its account could not be matched to an imported account.`);
                return true;
            }
            if (Number.isFinite(transactionTime) && transactionTime <= new Date(cutoffValue).getTime()) {
                console.log(`[${idInfo}] Transaction is already covered by the imported account cutoff; skipping.`);
                return true;
            }
        }

        // Apply learned merchant rules (user category/label overrides)
        const rule = await dbService.getMerchantRuleForReason(USER_ID, expenseData.Reason);
        if (rule) {
            console.log(`[${idInfo}] Override matched: setting Category (${expenseData.Category} -> ${rule.category}) and Label (${expenseData.Label} -> ${rule.label})`);
            expenseData.Category = rule.category;
            expenseData.Label = rule.label;
        }

        // Provider wording can make a credit-card payment look like an OUT
        // flow. On the card account it is an IN flow because it reduces debt.
        expenseData = normalizeTransactionSemantics(expenseData);

        // Format e-Transfer reasons to standard "E-Transfer - [Name]"
        expenseData.Reason = formatETransferReason(expenseData.Reason, expenseData.Label, expenseData.Type);
        expenseData.Reason = enrichGenericEmailReason(expenseData);
        const newIsGeneric = isGeneric(expenseData.Label, expenseData.Reason);

        console.log(`[${idInfo}] Successfully extracted expense:`, expenseData);
        expenseData.userId = USER_ID;
        expenseData.ReceivedAt = receivedAt || new Date().toISOString();
        expenseData.SourceEmailKey = sourceEmailKey;

        // Date-only values have no transaction time. Use the received email time
        // rather than showing a misleading midnight placeholder in the app.
        expenseData.Timestamp = resolveEmailTimestamp(expenseData.Timestamp, expenseData.ReceivedAt);
        const durableSource = buildEmailIngestionSource(
            sourceEmailKey, emailBody, rawEmailSource, receivedAt, expenseData, idInfo
        );

        // A stable account/card reference in a transaction is enough to add a new
        // account to the Accounts page. Vague emails without an identifier are
        // intentionally left unmatched to avoid inventing duplicate accounts.
        const accountResolution = await dbService.ensureTransactionAccount(USER_ID, expenseData);
        if (accountResolution.account) {
            expenseData.BalanceAccountId = accountResolution.account.id;
            expenseData.BalanceAccountConfidence = 'HIGH';
            if (expenseData.PortfolioAction) {
                expenseData.PortfolioAccountId = accountResolution.account.id;
                expenseData.PortfolioConfidence = 'HIGH';
            }
            if (accountResolution.created) {
                console.log(
                    `[${idInfo}] Automatically added account: ${accountResolution.account.name} (${accountResolution.account.accountRef}).`
                );
                await writeAudit('account_auto_created', 'success', {
                    accountId: accountResolution.account.id,
                    name: accountResolution.account.name,
                    institution: accountResolution.account.institution,
                    accountType: accountResolution.account.accountType,
                    accountRef: accountResolution.account.accountRef,
                });
            }
        }

        // 1. Exact duplicate check
        const datePrefix = expenseData.Timestamp.substring(0, 10);
        const detectedDuplicate = await dbService.findDuplicateTransaction(
            USER_ID, expenseData.Amount, expenseData.Category, datePrefix,
            expenseData.Reason, expenseData.ReferenceNumber, expenseData.Account,
            {
                BankName: expenseData.BankName,
                Type: expenseData.Type,
                AccountFlow: expenseData.AccountFlow,
                Currency: expenseData.Currency,
            }
        );
        const duplicate = existingEmailTransaction || detectedDuplicate;
        if (duplicate) {
            console.log(`[${idInfo}] Duplicate expense detected. Skipping save.`);
            let duplicateUpdates = sourceEmailKey && !duplicate.SourceEmailKey
                ? { SourceEmailKey: sourceEmailKey }
                : {};
            if (isGeneric(duplicate.Label, duplicate.Reason) && !newIsGeneric) {
                duplicateUpdates = {
                    ...duplicateUpdates,
                    Category: expenseData.Category || duplicate.Category,
                    Label: expenseData.Label,
                    Reason: expenseData.Reason,
                    Type: expenseData.Type || duplicate.Type,
                    Account: expenseData.Account || duplicate.Account,
                    BankName: expenseData.BankName || duplicate.BankName,
                    ReferenceNumber: expenseData.ReferenceNumber || duplicate.ReferenceNumber,
                    Timestamp: expenseData.Timestamp || duplicate.Timestamp,
                };
                console.log(`[${idInfo}] Upgrading generic duplicate to specific: ${expenseData.Reason}`);
            }
            if (Object.keys(duplicateUpdates).length) {
                await updateAgentTransaction(duplicate.id, duplicateUpdates);
            }
            await captureEmailSource(
                duplicate.id, sourceEmailKey, emailBody, rawEmailSource,
                receivedAt, expenseData, idInfo
            );
            await syncPortfolioFromEmail(duplicate.id, expenseData, idInfo);
            return true;
        }

        // 2. Fetch all matching transactions within the time window
        const rawMatches = await dbService.getDb().then(db => db.all(
            `SELECT * FROM transactions WHERE userId = ? AND AmountMinor = ? AND Category = ?`,
            [USER_ID, Math.round(Number(expenseData.Amount) * 100), expenseData.Category]
        ));

        const newTime = new Date(expenseData.Timestamp).getTime();

        const allMatches = rawMatches.filter(m => {
            const existingTime = new Date(m.Timestamp).getTime();
            const diffHours = Math.abs(newTime - existingTime) / (1000 * 60 * 60);
            return diffHours <= 48;
        });

        // Never merge two non-identical bank legs based only on amount and
        // similar text. Internal transfers are represented by both records and
        // are paired only after we have one OUT and one IN on different accounts.
        const fuzzyDuplicate = null;

        let activeId = null;

        if (fuzzyDuplicate) {
            console.log(`[${idInfo}] Fuzzy duplicate detected (complementary emails). Merging & replacing notification.`);
            const mergedUpdates = {
                Account: expenseData.Account || fuzzyDuplicate.Account,
                BankName: expenseData.BankName || fuzzyDuplicate.BankName,
                ReferenceNumber: expenseData.ReferenceNumber || fuzzyDuplicate.ReferenceNumber,
                SourceEmailKey: sourceEmailKey || fuzzyDuplicate.SourceEmailKey,
            };
            await updateAgentTransaction(fuzzyDuplicate.id, mergedUpdates);
            activeId = fuzzyDuplicate.id;
            // Delete old Telegram message → send fresh complete one
            if (!suppressNotifications) {
                await replaceNotification({ ...fuzzyDuplicate, ...expenseData, ...mergedUpdates, id: fuzzyDuplicate.id });
            }
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
                    Category: expenseData.Category || genericMatch.Category,
                    Label: expenseData.Label,
                    Reason: expenseData.Reason,
                    Type: expenseData.Type,
                    Account: expenseData.Account || genericMatch.Account,
                    BankName: expenseData.BankName || genericMatch.BankName,
                    ReferenceNumber: expenseData.ReferenceNumber || genericMatch.ReferenceNumber,
                    Timestamp: expenseData.Timestamp || genericMatch.Timestamp,
                    SourceEmailKey: sourceEmailKey || genericMatch.SourceEmailKey,
                };
                await updateAgentTransaction(genericMatch.id, specificUpdates);
                activeId = genericMatch.id;
                // Delete old generic message → send one clean specific message
                if (!suppressNotifications) {
                    await replaceNotification({ ...genericMatch, ...expenseData, ...specificUpdates, id: genericMatch.id });
                }

            } else if (newIsGeneric) {
                const existingSpecific = allMatches.find(m => !isGeneric(m.Label, m.Reason));
                if (existingSpecific) {
                    // Specific already exists — just silently update account/bank
                    console.log(`[${idInfo}] Generic alert for already-detailed transaction. Updating account info silently.`);
                    await updateAgentTransaction(existingSpecific.id, {
                        Account: expenseData.Account || existingSpecific.Account,
                        BankName: expenseData.BankName || existingSpecific.BankName,
                        SourceEmailKey: sourceEmailKey || existingSpecific.SourceEmailKey,
                    });
                    activeId = existingSpecific.id;
                } else {
                    // No specific yet — save generic and send a message (will be replaced later)
                    const newId = await dbService.commitEmailTransaction({
                        transaction: expenseData,
                        source: durableSource,
                        balance: { accountId: expenseData.BalanceAccountId },
                        outbox: buildTransactionNotification(expenseData, suppressNotifications),
                    });
                    activeId = newId;
                    console.log(`[${idInfo}] Saved generic. Sending placeholder notification.`);
                }
            } else {
                // Brand new specific transaction
                const newId = await dbService.commitEmailTransaction({
                    transaction: expenseData,
                    source: durableSource,
                    balance: { accountId: expenseData.BalanceAccountId },
                    outbox: buildTransactionNotification(expenseData, suppressNotifications),
                });
                activeId = newId;
                console.log(`[${idInfo}] Saved specific to SQLite successfully!`);
            }
        }

        await captureEmailSource(
            activeId, sourceEmailKey, emailBody, rawEmailSource,
            receivedAt, expenseData, idInfo
        );

        // Account tracking
        // Apply an explicit portfolio cash movement once, linked to the source transaction.
        if (activeId) {
            await syncPortfolioFromEmail(activeId, expenseData, idInfo);
            const accountPosting = await dbService.syncTransactionAccountBalance(USER_ID, activeId, {
                accountId: expenseData.BalanceAccountId,
                confidence: expenseData.BalanceAccountConfidence,
            });
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

        // Detect and reclassify Income/Expense transactions that are actually
        // the bank-side legs of an internal self-transfer (e.g. RBC deposit +
        // RBC withdrawal alerts that accompany an Interac self e-Transfer).
        if (activeId) {
            try {
                const reclassified = await dbService.detectAndReclassifyInternalCounterparts(USER_ID, activeId);
                for (const change of reclassified) {
                    await writeAudit('internal_reclassification', 'success', {
                        transactionId: change.id,
                        triggeredByTransactionId: activeId,
                        oldCategory: change.oldCategory,
                        oldLabel: change.oldLabel,
                        newCategory: change.newCategory,
                        newLabel: change.newLabel,
                    });
                    // Update the Telegram message for the reclassified transaction
                    if (!suppressNotifications) {
                        try {
                            const db = await dbService.getDb();
                            const reclassifiedTx = await db.get(
                                'SELECT * FROM transactions WHERE id = ? AND userId = ?',
                                [change.id, USER_ID]
                            );
                            if (reclassifiedTx && reclassifiedTx.TelegramMessageId) {
                                await editTelegramTransactionMessage(reclassifiedTx.TelegramMessageId, reclassifiedTx);
                                console.log(`[InternalPairing] Updated Telegram message ${reclassifiedTx.TelegramMessageId} for tx ${change.id}.`);
                            }
                        } catch (telegramErr) {
                            console.warn(`[InternalPairing] Could not update Telegram message for tx ${change.id}:`, telegramErr.message);
                        }
                    }
                }
            } catch (err) {
                console.error(`[${idInfo}] Error detecting internal counterparts:`, err.message);
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

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

async function sendMonthlyStatement(month) {
    const db = await dbService.getDb();
    const rows = await db.all(
        `SELECT Timestamp, Amount, Currency, Category, Label, Reason, Account, BankName, ReferenceNumber
         FROM transactions WHERE userId = ? AND substr(Timestamp, 1, 7) = ?
         ORDER BY Timestamp ASC, id ASC`,
        [USER_ID, month]
    );
    const headers = ['Timestamp', 'Amount', 'Currency', 'Category', 'Label', 'Reason', 'Account', 'BankName', 'ReferenceNumber'];
    const csv = [headers, ...rows.map((row) => headers.map((key) => row[key]))]
        .map((row) => row.map(csvCell).join(','))
        .join('\r\n');
    return sendTelegramDocument(
        `MoniMonitor-statement-${month}.csv`,
        `\uFEFF${csv}`,
        `MoniMonitor statement for ${month} (${rows.length} transactions).`,
        { silent: true, protectContent: true }
    );
}

async function onTelegramUpdate(update) {
    try {
        if (update.callback_query?.id) {
            // Telegram clients otherwise keep displaying a loading spinner even
            // when a subsequent database operation is slow or fails.
            await answerTelegramCallbackQuery(update.callback_query.id);
        }
        if (!isAuthorizedTelegramUpdate(update)) {
            console.warn('[Telegram] Ignored update from an unlinked chat or sender.');
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
                    const replyMarkup = {
                        inline_keyboard: [
                            [
                                { text: "🏷️ Recategorize", callback_data: `recat:${tx.id}` },
                                { text: "🔄 Internal Transfer", callback_data: `transfer:${tx.id}` }
                            ]
                        ]
                    };

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
            const messageId = query.message?.message_id ?? query.inline_message_id;
            
            if (data.startsWith('transfer:') || data.startsWith('save:')) {
                const txId = data.split(':')[1];
                const db = await dbService.getDb();
                const tx = await db.get('SELECT * FROM transactions WHERE id = ? AND userId = ?', [txId, USER_ID]);
                if (tx) {
                    const isOut = tx.AccountFlow === 'OUT' || tx.Category === 'Expense';
                    const sourceOrDest = tx.Account || tx.BankName || 'Account';
                    const newReason = isOut
                        ? `Internal transfer: ${sourceOrDest} -> Temporary`
                        : `Internal transfer: Temporary -> ${sourceOrDest}`;
                    const updates = {
                        Category: 'Internal',
                        Label: 'Internal Transfer',
                        Reason: newReason,
                        Account: tx.Account || 'Temporary'
                    };
                    if (isOut && !tx.AccountFlow) updates.AccountFlow = 'OUT';
                    if (!isOut && !tx.AccountFlow) updates.AccountFlow = 'IN';

                    await updateAgentTransaction(txId, updates);
                    
                    if (tx.Reason) {
                        await dbService.saveMerchantRule(tx.userId, tx.Reason, 'Internal', 'Internal Transfer');
                    }

                    // Attempt counterpart pairing immediately
                    try {
                        const reclassified = await dbService.detectAndReclassifyInternalCounterparts(USER_ID, txId);
                        for (const change of reclassified) {
                            await writeAudit('internal_reclassification', 'success', {
                                transactionId: change.id,
                                triggeredByTransactionId: txId,
                                oldCategory: change.oldCategory,
                                oldLabel: change.oldLabel,
                                newCategory: change.newCategory,
                                newLabel: change.newLabel,
                            });
                        }
                    } catch (pairErr) {
                        console.error('[InternalTransfer] Pairing error:', pairErr.message);
                    }

                    const updatedTx = await db.get('SELECT * FROM transactions WHERE id = ? AND userId = ?', [txId, USER_ID]);
                    if (updatedTx) {
                        await editTelegramTransactionMessage(updatedTx.TelegramMessageId || messageId, updatedTx);
                    }
                }
            }
            else if (data.startsWith('recat:')) {
                const txId = data.split(':')[1];
                const ephemeralResult = await sendEphemeralCategoryPicker(query, txId);
                if (ephemeralResult?.ok) return;
                const replyMarkup = {
                    inline_keyboard: [
                        [
                            { text: "🛒 Groceries", callback_data: `setcat:${txId}:Expense:Groceries` },
                            { text: "🍔 Dining", callback_data: `setcat:${txId}:Expense:Dining` }
                        ],
                        [
                            { text: "🚗 Transport", callback_data: `setcat:${txId}:Expense:Transportation` },
                            { text: "🛍️ Shopping", callback_data: `setcat:${txId}:Expense:Shopping` }
                        ],
                        [
                            { text: "🏠 Housing", callback_data: `setcat:${txId}:Expense:Housing & Utilities` },
                            { text: "🔙 Cancel", callback_data: `cancel:${txId}` }
                        ]
                    ]
                };
                
                const text = query.message?.text ? e(query.message.text) + "\n\n*Select a new category:*" : "*Select a new category:*";
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
                    await editTelegramTransactionMessage(tx.TelegramMessageId || messageId, tx);
                }
            }
            else if (data.startsWith('cancel:')) {
                const txId = data.split(':')[1];
                const db = await dbService.getDb();
                const tx = await db.get('SELECT * FROM transactions WHERE id = ? AND userId = ?', [txId, USER_ID]);
                if (tx) {
                    await editTelegramTransactionMessage(tx.TelegramMessageId || messageId, tx, 'new');
                }
            }
        }
        
        if (update.message && update.message.text) {
            const text = update.message.text;
            const messageId = update.message.message_id;

            const statementMatch = text.match(/^\/statement(?:\s+(\d{4}-\d{2}))?\s*$/i);
            if (statementMatch) {
                const month = statementMatch[1] || new Date().toISOString().slice(0, 7);
                await setTelegramReaction(messageId, '👀');
                const result = await sendMonthlyStatement(month);
                if (!result?.ok) {
                    await sendTelegramMessage(`I couldn't create the ${month} statement right now\\.`, null, true);
                }
                return;
            }
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

async function startAgent() {
    if (AI_INGESTION_ENABLED) {
        if (!IMAP_USER || !IMAP_PASSWORD || !TELEGRAM_CHAT_ID) {
            throw new Error('IMAP_USER, IMAP_PASSWORD, and TELEGRAM_CHAT_ID are required when AI ingestion is enabled');
        }

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
        startTelegramPolling(onTelegramUpdate);
        startTelegramOutboxWorker();
        const emailListener = new ImapService(
            IMAP_HOST,
            IMAP_PORT,
            IMAP_USER,
            IMAP_PASSWORD,
            onNewEmail,
            { initialSyncSince: IMAP_INITIAL_SYNC_SINCE, userId: USER_ID }
        );
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

module.exports = {
    startAgent, onNewEmail, notifyAndSave, onTelegramUpdate, enrichGenericEmailReason,
    isDateOnlyTimestamp, resolveEmailTimestamp, isAuthorizedTelegramUpdate,
};
