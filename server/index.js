require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { ZodError } = require("zod");
const dbService = require("./src/database/dbService");
const { createRateLimit } = require("./src/middleware/rateLimit");
const { requireConfiguredOwner } = require("./src/middleware/ownerAuthorization");
const { createRegistrationAuthorization } = require("./src/middleware/registrationAuthorization");
const { requirePrivateBackupNetwork, isLoopbackAddress } = require("./src/middleware/privateNetwork");
const { requireSingleTenant, singleTenantEnabled, singleTenantUserId } = require("./src/middleware/singleTenantAuthorization");
const { registerAuthRoutes } = require('./src/routes/authRoutes');
const { registerBackupRoutes } = require('./src/routes/backupRoutes');
const { registerIntegrationRoutes } = require('./src/routes/integrationRoutes');
const { registerTransactionRoutes } = require('./src/routes/transactionRoutes');
const { registerPortfolioRoutes } = require('./src/routes/portfolioRoutes');
const { parseTransaction, transactionUpdateSchema } = require("./src/validation/transaction");
const { validateTelegramInitData, normalizeTelegramPhotoUrl } = require("./src/services/telegramAuthService");
const backupService = require("./src/services/backupService");
const { getMonthlyInsightBrief } = require("./src/services/monthlyInsightService");
const { getExpenseForecast } = require("./src/services/timesFmForecastService");
const { buildCashFlowWidgetPayload } = require("./src/services/cashFlowWidgetService");
const plaidService = require("./src/services/plaidService");
const { startTelegramOutboxWorker, getTelegramOutboxWorkerHealth } = require("./src/services/telegramOutboxWorker");
const { getAllSubsystemHealth } = require("./src/services/subsystemHealth");

const app = express();
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT || 3001);
const isProduction = process.env.NODE_ENV === "production";
const agentStatus = {
    enabled: process.env.AI_INGESTION_ENABLED === "true",
    state: process.env.AI_INGESTION_ENABLED === "true" ? "starting" : "disabled",
};
const cashFlowWidgetCache = new Map();
const CASH_FLOW_WIDGET_CACHE_MS = 60 * 1000;

if (!process.env.JWT_SECRET) {
    if (isProduction) {
        throw new Error("JWT_SECRET must be configured in production");
    } else {
        console.warn("[WARNING] JWT_SECRET is not configured in environment. Using an ephemeral development key; sessions reset when the server restarts.");
    }
}

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
if (isProduction && singleTenantEnabled() && !singleTenantUserId()) {
    throw new Error("BACKUP_OWNER_USER_ID (or USER_ID) must identify the single-tenant owner in production");
}
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID || process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_APP_USER_ID = singleTenantUserId() || process.env.USER_ID;
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

if (isProduction || process.env.ENFORCE_HTTPS === "true") {
    app.use((req, res, next) => {
        const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
        if (!isHttps && req.headers.host && !isLoopbackAddress(req.socket?.remoteAddress)) {
            return res.redirect(301, `https://${req.headers.host}${req.url}`);
        }
        next();
    });
}

app.disable("x-powered-by");
app.use((req, res, next) => {
    const headers = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.plaid.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; frame-src https://cdn.plaid.com; connect-src 'self' http: https: ws: wss:;",
    };
    if (isProduction || process.env.ENFORCE_HTTPS === "true") {
        headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
    }
    res.set(headers);
    next();
});

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Origin is not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({
    limit: "100kb",
    verify(req, _res, buffer) {
        if (req.path === "/plaid/webhook") req.rawBody = Buffer.from(buffer);
    },
}));

const authRateLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const insightRateLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 180 });
const requireRegistrationOpen = createRegistrationAuthorization({
    getUserCount: dbService.getUserCount,
});
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentication required" });

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        return requireSingleTenant(req, res, next);
    } catch {
        return res.status(401).json({ error: "Invalid or expired session" });
    }
};

const credentialsAreValid = (username, password) => (
    typeof username === "string" && username.trim().length >= 3 && username.trim().length <= 64 &&
    typeof password === "string" && password.length >= 12 && password.length <= 256
);

const sendValidationError = (res, error) => {
    if (error instanceof ZodError) return res.status(400).json({ error: "Invalid request data" });
    console.error("Request error:", error);
    return res.status(500).json({ error: "Unable to process this request" });
};

app.get("/health", async (_req, res) => {
    try {
        const db = await dbService.getDb();
        await db.get("SELECT 1 AS ready");
        const queues = await dbService.getQueueHealth();
        const subsystems = getAllSubsystemHealth();
        const hasDeadLetters = (queues.email.dead || 0) > 0 || (queues.telegram.dead || 0) > 0;
        const agentFailed = agentStatus.enabled && agentStatus.state === "failed";
        const outbox = getTelegramOutboxWorkerHealth();
        const status = agentFailed ? "unavailable" : (hasDeadLetters || outbox.lastError ? "degraded" : "ok");
        return res.json({
            status,
            database: { state: "ready" },
            agent: {
                enabled: agentStatus.enabled,
                state: agentStatus.state,
            },
            telegramOutbox: outbox,
            queues,
            subsystems,
        });
    } catch (error) {
        console.error("Database health check failed:", error);
        return res.status(503).json({ status: "unavailable" });
    }
});

registerAuthRoutes(app, {
    authRateLimit, requireRegistrationOpen, credentialsAreValid, dbService, crypto, bcrypt, jwt,
    jwtSecret: JWT_SECRET, jwtExpiresIn: JWT_EXPIRES_IN,
    telegramBotToken: TELEGRAM_BOT_TOKEN, telegramUserId: TELEGRAM_USER_ID, telegramAppUserId: TELEGRAM_APP_USER_ID,
    validateTelegramInitData, normalizeTelegramPhotoUrl, singleTenantEnabled, singleTenantUserId,
});
registerTransactionRoutes(app, {
    authenticateToken, dbService, plaidService, sendValidationError,
    cashFlowWidgetCache, cashFlowWidgetCacheMs: CASH_FLOW_WIDGET_CACHE_MS, buildCashFlowWidgetPayload, parseTransaction,
});

registerIntegrationRoutes(app, { authenticateToken, authRateLimit, plaidService, sendValidationError });

app.put("/transactions/:id", authenticateToken, async (req, res) => {
    try {
        const existing = await dbService.getTransactionById(req.params.id, req.user.userId);
        if (!existing) return res.status(404).json({ error: "Transaction not found" });

        const { BalanceAccountId = null, ...updateInput } = req.body || {};
        if (!BalanceAccountId && Object.keys(updateInput).length === 0) {
            return res.status(400).json({ error: "No transaction or account changes supplied" });
        }
        const updates = Object.keys(updateInput).length ? transactionUpdateSchema.parse(updateInput) : {};
        if (Object.keys(updates).length) {
            await dbService.updateTransactionForUser(req.params.id, req.user.userId, updates);
        }
        const finalTx = await dbService.getTransactionById(req.params.id, req.user.userId);
        const accountResolution = await dbService.ensureTransactionAccount(req.user.userId, {
            ...finalTx,
            BalanceAccountId,
            BalanceAccountConfidence: BalanceAccountId ? "HIGH" : null,
        });
        const resolvedAccountId = BalanceAccountId || accountResolution.account?.id || null;
        const accountPosting = await dbService.syncTransactionAccountBalance(req.user.userId, req.params.id, {
            accountId: resolvedAccountId, confidence: resolvedAccountId ? "HIGH" : null,
        });

        if (updates.Category || updates.Label) {
            const genericLabels = ["withdrawal", "deposit", "bank withdrawal", "bank deposit", "other", "other expense", "other income"];
            const cleanLabel = finalTx.Label?.toLowerCase().trim();
            if (finalTx.Reason && cleanLabel && !genericLabels.includes(cleanLabel)) {
                await dbService.saveMerchantRule(req.user.userId, finalTx.Reason, finalTx.Category, finalTx.Label);
            }
        }

        await dbService.detectAndMarkRecurring(req.user.userId, req.params.id).catch((error) => console.error("Recurrence detection error:", error.message));
        await dbService.detectAndReclassifyInternalCounterparts(req.user.userId, req.params.id).catch((error) => console.error("Internal counterpart error:", error.message));
        const finalUpdatedTx = await dbService.getTransactionById(req.params.id, req.user.userId);
        return res.json({ message: "Updated", data: finalUpdatedTx || finalTx, accountPosting, accountResolution });
    } catch (error) {
        return sendValidationError(res, error);
    }
});

app.delete("/transactions/:id", authenticateToken, async (req, res) => {
    try {
        const deleted = await dbService.deleteTransaction(req.params.id, req.user.userId);
        if (!deleted) return res.status(404).json({ error: "Transaction not found" });
        return res.json({ message: "Deleted" });
    } catch (error) {
        return sendValidationError(res, error);
    }
});

const validCurrency = (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value);
const validMonth = (value) => typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
const validMinorAmount = (value) => Number.isSafeInteger(value) && value >= 0;
const validText = (value, max = 120) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const validQuantity = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const investmentAccountTypes = new Set([
    'Chequing', 'Savings', 'Credit Card', 'TFSA', 'RRSP', 'Brokerage', 'Crypto', '401(k)', 'IRA', 'Other',
]);

app.get("/settings", authenticateToken, async (req, res) => {
    try {
        return res.json(await dbService.getUserSettings(req.user.userId) || {
            currency: "CAD", timezone: null, notificationsEnabled: 1,
        });
    } catch (error) { return sendValidationError(res, error); }
});

app.put("/settings", authenticateToken, async (req, res) => {
    const { currency, timezone = null, notificationsEnabled = true } = req.body || {};
    if (!validCurrency(currency) || (timezone !== null && (typeof timezone !== "string" || timezone.length > 64)) || typeof notificationsEnabled !== "boolean") {
        return res.status(400).json({ error: "Invalid settings" });
    }
    try {
        return res.json(await dbService.saveUserSettings(req.user.userId, { currency, timezone, notificationsEnabled }));
    } catch (error) { return sendValidationError(res, error); }
});

app.get("/budgets", authenticateToken, async (req, res) => {
    if (!validMonth(req.query.month)) return res.status(400).json({ error: "month must be YYYY-MM" });
    try { return res.json(await dbService.getBudgetsForUser(req.user.userId, req.query.month)); }
    catch (error) { return sendValidationError(res, error); }
});

app.put("/budgets", authenticateToken, async (req, res) => {
    const { category, month, amountMinor, currency = "CAD" } = req.body || {};
    if (typeof category !== "string" || category.trim().length < 1 || category.length > 100 || !validMonth(month) || !Number.isSafeInteger(amountMinor) || amountMinor < 0 || !validCurrency(currency)) {
        return res.status(400).json({ error: "Invalid budget" });
    }
    try { return res.json(await dbService.saveBudget(req.user.userId, { category: category.trim(), month, amountMinor, currency })); }
    catch (error) { return sendValidationError(res, error); }
});

app.get("/goals", authenticateToken, async (req, res) => {
    try { return res.json(await dbService.getGoalsForUser(req.user.userId)); }
    catch (error) { return sendValidationError(res, error); }
});

app.post("/goals", authenticateToken, async (req, res) => {
    const { name, targetMinor, currentMinor = 0, currency = "CAD", targetDate = null } = req.body || {};
    if (typeof name !== "string" || name.trim().length < 1 || name.length > 120 || !Number.isSafeInteger(targetMinor) || targetMinor <= 0 || !Number.isSafeInteger(currentMinor) || currentMinor < 0 || !validCurrency(currency) || (targetDate !== null && (typeof targetDate !== "string" || targetDate.length > 32))) {
        return res.status(400).json({ error: "Invalid goal" });
    }
    try { return res.status(201).json(await dbService.createGoal(req.user.userId, { name: name.trim(), targetMinor, currentMinor, currency, targetDate })); }
    catch (error) { return sendValidationError(res, error); }
});

app.put("/goals/:id", authenticateToken, async (req, res) => {
    const { name, targetMinor, currentMinor, currency, targetDate } = req.body || {};
    const updates = {};
    if (name !== undefined) {
        if (typeof name !== "string" || name.trim().length < 1 || name.length > 120) return res.status(400).json({ error: "Invalid goal" });
        updates.name = name.trim();
    }
    if (targetMinor !== undefined) {
        if (!Number.isSafeInteger(targetMinor) || targetMinor <= 0) return res.status(400).json({ error: "Invalid goal" });
        updates.targetMinor = targetMinor;
    }
    if (currentMinor !== undefined) {
        if (!Number.isSafeInteger(currentMinor) || currentMinor < 0) return res.status(400).json({ error: "Invalid goal" });
        updates.currentMinor = currentMinor;
    }
    if (currency !== undefined) {
        if (!validCurrency(currency)) return res.status(400).json({ error: "Invalid goal" });
        updates.currency = currency;
    }
    if (targetDate !== undefined) {
        if (targetDate !== null && (typeof targetDate !== "string" || targetDate.length > 32)) return res.status(400).json({ error: "Invalid goal" });
        updates.targetDate = targetDate;
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No goal changes supplied" });
    try {
        const goal = await dbService.updateGoal(req.user.userId, req.params.id, updates);
        if (!goal) return res.status(404).json({ error: "Goal not found" });
        return res.json(goal);
    } catch (error) { return sendValidationError(res, error); }
});

app.delete("/goals/:id", authenticateToken, async (req, res) => {
    try {
        if (!await dbService.deleteGoal(req.user.userId, req.params.id)) return res.status(404).json({ error: "Goal not found" });
        return res.json({ message: "Goal deleted" });
    } catch (error) { return sendValidationError(res, error); }
});

registerPortfolioRoutes(app, { authenticateToken, dbService, sendValidationError });

app.post('/portfolio/accounts', authenticateToken, async (req, res) => {
    const { name, institution = null, accountType, currency = 'CAD', cashMinor = 0 } = req.body || {};
    if (!validText(name) || !investmentAccountTypes.has(accountType) || !validCurrency(currency) ||
        !validMinorAmount(cashMinor) || (institution !== null && (typeof institution !== 'string' || institution.length > 120))) {
        return res.status(400).json({ error: 'Invalid investment account' });
    }
    try {
        const account = await dbService.createInvestmentAccount(req.user.userId, {
            name: name.trim(), institution: institution?.trim() || null, accountType, currency, cashMinor,
        });
        return res.status(201).json(account);
    } catch (error) { return sendValidationError(res, error); }
});

app.put('/portfolio/accounts/:id', authenticateToken, async (req, res) => {
    const updates = {};
    const { name, institution, accountType, currency, cashMinor } = req.body || {};
    if (name !== undefined) {
        if (!validText(name)) return res.status(400).json({ error: 'Invalid account name' });
        updates.name = name.trim();
    }
    if (institution !== undefined) {
        if (institution !== null && (typeof institution !== 'string' || institution.length > 120)) return res.status(400).json({ error: 'Invalid institution' });
        updates.institution = institution?.trim() || null;
    }
    if (accountType !== undefined) {
        if (!investmentAccountTypes.has(accountType)) return res.status(400).json({ error: 'Invalid account type' });
        updates.accountType = accountType;
    }
    if (currency !== undefined) {
        if (!validCurrency(currency)) return res.status(400).json({ error: 'Invalid currency' });
        updates.currency = currency;
    }
    if (cashMinor !== undefined) {
        if (!validMinorAmount(cashMinor)) return res.status(400).json({ error: 'Invalid cash balance' });
        updates.cashMinor = cashMinor;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No account changes supplied' });
    try {
        const account = await dbService.updateInvestmentAccount(req.user.userId, req.params.id, updates);
        if (!account) return res.status(404).json({ error: 'Investment account not found' });
        return res.json(account);
    } catch (error) { return sendValidationError(res, error); }
});

app.delete('/portfolio/accounts/:id', authenticateToken, async (req, res) => {
    try {
        if (!await dbService.deleteInvestmentAccount(req.user.userId, req.params.id)) {
            return res.status(404).json({ error: 'Investment account not found' });
        }
        return res.json({ message: 'Investment account deleted' });
    } catch (error) { return sendValidationError(res, error); }
});

app.put('/portfolio/accounts/:id/holdings', authenticateToken, async (req, res) => {
    const {
        symbol, name = null, quantity, averageCostMinor = 0, priceMinor = 0,
        averageCostMicros = averageCostMinor * 10000,
        priceMicros = priceMinor * 10000,
        currency = 'CAD',
    } = req.body || {};
    const normalizedSymbol = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    if (!/^[A-Z0-9.\-]{1,15}$/.test(normalizedSymbol) || !validQuantity(quantity) ||
        !validMinorAmount(averageCostMinor) || !validMinorAmount(priceMinor) ||
        !validMinorAmount(averageCostMicros) || !validMinorAmount(priceMicros) || !validCurrency(currency) ||
        (name !== null && (typeof name !== 'string' || name.length > 120))) {
        return res.status(400).json({ error: 'Invalid holding' });
    }
    try {
        const holding = await dbService.upsertInvestmentHolding(req.user.userId, req.params.id, {
            symbol: normalizedSymbol, name: name?.trim() || null, quantity,
            averageCostMinor, averageCostMicros, priceMinor, priceMicros, currency,
        });
        if (!holding) return res.status(404).json({ error: 'Investment account not found' });
        return res.json(holding);
    } catch (error) { return sendValidationError(res, error); }
});

app.delete('/portfolio/accounts/:accountId/holdings/:holdingId', authenticateToken, async (req, res) => {
    try {
        const deleted = await dbService.deleteInvestmentHolding(
            req.user.userId, req.params.accountId, req.params.holdingId
        );
        if (!deleted) return res.status(404).json({ error: 'Holding not found' });
        return res.json({ message: 'Holding deleted' });
    } catch (error) { return sendValidationError(res, error); }
});
app.get("/summary", authenticateToken, async (req, res) => {
    try {
        return res.json(await dbService.getSummaryForUser(req.user.userId));
    } catch (error) {
        return sendValidationError(res, error);
    }
});

app.get("/dashboard-bootstrap", authenticateToken, async (req, res) => {
    const month = String(req.query.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "month must be YYYY-MM" });
    }
    try {
        res.set("Cache-Control", "private, no-cache");
        return res.json(await dbService.getDashboardBootstrapForUser(req.user.userId, month));
    } catch (error) {
        return sendValidationError(res, error);
    }
});

app.get("/accounts", authenticateToken, async (req, res) => {
    try {
        return res.json(await dbService.getAccountsForUser(req.user.userId));
    } catch (error) {
        return sendValidationError(res, error);
    }
});

app.get("/insights/monthly", authenticateToken, insightRateLimit, async (req, res) => {
    if (!validMonth(req.query.month)) {
        return res.status(400).json({ error: "month must be YYYY-MM" });
    }
    try {
        return res.json(await getMonthlyInsightBrief(req.user.userId, req.query.month, {
            refresh: req.query.refresh === "true",
        }));
    } catch (error) {
        return sendValidationError(res, error);
    }
});

app.get("/insights/expense-forecast", authenticateToken, insightRateLimit, async (req, res) => {
    try {
        return res.json(await getExpenseForecast(req.user.userId));
    } catch (error) {
        if (["INSUFFICIENT_HISTORY", "BIGQUERY_NOT_CONFIGURED"].includes(error.code)) {
            return res.status(422).json({ code: error.code, error: error.message });
        }
        console.error("TimesFM forecast error:", error.message);
        return res.status(503).json({ code: "TIMESFM_FAILED", error: "Unable to generate a TimesFM forecast right now." });
    }
});

registerBackupRoutes(app, {
    authenticateToken, requireConfiguredOwner, requirePrivateBackupNetwork, backupService, sendValidationError,
});

// Compatibility endpoint for the current frontend. New integrations should use /transactions.
app.post("/MoniMonitor_ToDB", authenticateToken, async (req, res) => {
    const { status, record_entry, record_type, ...filters } = req.body || {};
    try {
        if (status === "read") {
            const transactions = await dbService.getAllTransactionsForUser(req.user.userId, filters);
            res.json(transactions);

            setImmediate(() => {
                plaidService.syncUserItems(req.user.userId).catch((error) => {
                    console.error("Background Plaid sync error:", error.message);
                });
            });
            return;
        }
        if (status !== "record") return res.status(400).json({ error: "Invalid status" });

        const { BalanceAccountId = null, ...recordInput } = record_entry || {};
        const transaction = parseTransaction({ ...recordInput, Type: record_type || recordInput.Type });
        const id = await dbService.addTransaction({ ...transaction, userId: req.user.userId });
        const accountResolution = await dbService.ensureTransactionAccount(req.user.userId, {
            ...transaction,
            BalanceAccountId,
            BalanceAccountConfidence: BalanceAccountId ? 'HIGH' : null,
        });
        const resolvedAccountId = BalanceAccountId || accountResolution.account?.id || null;
        const accountPosting = await dbService.syncTransactionAccountBalance(req.user.userId, id, {
            accountId: resolvedAccountId, confidence: resolvedAccountId ? 'HIGH' : null,
        });
        await dbService.detectAndMarkRecurring(req.user.userId, id).catch((error) => console.error("Recurrence detection error:", error.message));
        return res.status(201).json({ message: "Created", data: { ...transaction, id }, accountPosting, accountResolution });
    } catch (error) {
        return sendValidationError(res, error);
    }
});

app.use((error, _req, res, _next) => {
    if (error.message === "Origin is not allowed by CORS") return res.status(403).json({ error: "Origin is not allowed" });
    console.error("Unhandled API error:", error);
    return res.status(500).json({ error: "Unexpected server error" });
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception thrown:", error);
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`API server listening on http://localhost:${PORT}`);
        plaidService.migrateAccessTokenEncryption()
            .then(({ migrated }) => {
                if (migrated) console.log(`[Plaid] Re-encrypted ${migrated} stored access token(s) with the dedicated key.`);
            })
            .catch((error) => console.error("Plaid token encryption migration failed:", error.message));
        dbService.migrateAndPruneRawEmailSources()
            .then(({ encrypted, pruned }) => {
                if (encrypted || pruned) console.log(`[Sources] Encrypted ${encrypted} and pruned ${pruned} raw email source(s).`);
            })
            .catch((error) => console.error("Raw email source protection migration failed:", error.message));
        backupService.startAutomaticBackups();
        plaidService.startAutomaticReconciliation();
        plaidService.startAutomaticMarketPriceRefresh();
        plaidService.startPlaidWebhookWorker();
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
            startTelegramOutboxWorker();
        }
        if (process.env.AI_INGESTION_ENABLED === 'true') {
            const { startAgent } = require('./email_agent');
            startAgent()
                .then(() => {
                    agentStatus.state = "ready";
                    console.log("[Agent] Email and Telegram agent is ready.");
                })
                .catch((error) => {
                    agentStatus.state = "failed";
                    console.error('[Agent] Startup failed:', error);
                });
        }
    });
}

module.exports = app;
