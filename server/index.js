require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { ZodError } = require("zod");
const dbService = require("./src/database/dbService");
const { createRateLimit } = require("./src/middleware/rateLimit");
const { parseTransaction, transactionUpdateSchema } = require("./src/validation/transaction");
const { validateTelegramInitData } = require("./src/services/telegramAuthService");

const app = express();
const PORT = Number(process.env.PORT || 3001);
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.JWT_SECRET && isProduction) {
    throw new Error("JWT_SECRET must be configured in production");
}

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString("hex");
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID || process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_APP_USER_ID = process.env.USER_ID;
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.disable("x-powered-by");
app.use((req, res, next) => {
    res.set({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
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
app.use(express.json({ limit: "100kb" }));

const authRateLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentication required" });

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        return next();
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

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/register", authRateLimit, async (req, res) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    const { password } = req.body || {};
    if (!credentialsAreValid(username, password)) {
        return res.status(400).json({ error: "Use a username of 3-64 characters and a password of at least 12 characters" });
    }

    try {
        const existingUser = await dbService.getUserByUsername(username);
        if (existingUser) return res.status(409).json({ error: "Unable to create account with those credentials" });

        const hashedPassword = await bcrypt.hash(password, 12);
        await dbService.createUser(crypto.randomUUID(), username, hashedPassword);
        return res.status(201).json({ message: "Account created" });
    } catch (error) {
        console.error("Register error:", error);
        return res.status(500).json({ error: "Unable to create account" });
    }
});

app.post("/login", authRateLimit, async (req, res) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    const { password } = req.body || {};
    if (typeof password !== "string" || !username) return res.status(401).json({ error: "Invalid username or password" });

    try {
        const user = await dbService.getUserByUsername(username);
        const valid = user && await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: "Invalid username or password" });

        const accessToken = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        return res.json({ accessToken, user: { id: user.id, username: user.username } });
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({ error: "Unable to sign in" });
    }
});

app.post("/telegram-auth", authRateLimit, async (req, res) => {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_USER_ID || !TELEGRAM_APP_USER_ID) {
        return res.status(503).json({ error: "Telegram authentication is not configured" });
    }

    try {
        const telegramUser = validateTelegramInitData(req.body?.initData, TELEGRAM_BOT_TOKEN);
        if (String(telegramUser.id) !== String(TELEGRAM_USER_ID)) {
            return res.status(403).json({ error: "This Telegram account is not authorized" });
        }

        const user = await dbService.getUserById(TELEGRAM_APP_USER_ID);
        if (!user) return res.status(403).json({ error: "Telegram account is not linked" });

        const accessToken = jwt.sign(
            { userId: user.id, username: user.username, telegramUserId: String(telegramUser.id) },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );
        return res.json({ accessToken, user: { id: user.id, username: user.username } });
    } catch {
        return res.status(401).json({ error: "Unable to verify Telegram identity" });
    }
});
app.get("/transactions", authenticateToken, async (req, res) => {
    try {
        const filters = {
            category: req.query.category,
            label: req.query.label,
            account: req.query.account,
            from: req.query.from,
            to: req.query.to,
            search: req.query.search,
            page: req.query.page,
            limit: req.query.limit,
        };
        return res.json(await dbService.getAllTransactionsForUser(req.user.userId, filters));
    } catch (error) {
        return sendValidationError(res, error);
    }
});

app.post("/transactions", authenticateToken, async (req, res) => {
    try {
        const transaction = parseTransaction(req.body || {});
        const id = await dbService.addTransaction({ ...transaction, userId: req.user.userId });
        await dbService.detectAndMarkRecurring(req.user.userId, id).catch((error) => console.error("Recurrence detection error:", error.message));
        return res.status(201).json({ message: "Created", data: { ...transaction, id } });
    } catch (error) {
        return sendValidationError(res, error);
    }
});

app.put("/transactions/:id", authenticateToken, async (req, res) => {
    try {
        const existing = await dbService.getTransactionById(req.params.id, req.user.userId);
        if (!existing) return res.status(404).json({ error: "Transaction not found" });

        const updates = transactionUpdateSchema.parse(req.body || {});
        await dbService.updateTransactionForUser(req.params.id, req.user.userId, updates);
        const finalTx = await dbService.getTransactionById(req.params.id, req.user.userId);

        if (updates.Category || updates.Label) {
            const genericLabels = ["withdrawal", "deposit", "bank withdrawal", "bank deposit", "other"];
            const cleanLabel = finalTx.Label?.toLowerCase().trim();
            if (finalTx.Reason && cleanLabel && !genericLabels.includes(cleanLabel)) {
                await dbService.saveMerchantRule(req.user.userId, finalTx.Reason, finalTx.Category, finalTx.Label);
            }
        }

        await dbService.detectAndMarkRecurring(req.user.userId, req.params.id).catch((error) => console.error("Recurrence detection error:", error.message));
        return res.json({ message: "Updated", data: finalTx });
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
    'Chequing', 'Savings', 'Credit Card', 'TFSA', 'RRSP', 'Brokerage', '401(k)', 'IRA', 'Other',
]);

app.get("/settings", authenticateToken, async (req, res) => {
    try {
        return res.json(await dbService.getUserSettings(req.user.userId) || {
            currency: "USD", timezone: null, notificationsEnabled: 1,
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
    const { category, month, amountMinor, currency = "USD" } = req.body || {};
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
    const { name, targetMinor, currentMinor = 0, currency = "USD", targetDate = null } = req.body || {};
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

app.get('/portfolio', authenticateToken, async (req, res) => {
    try { return res.json(await dbService.getPortfolioSummary(req.user.userId)); }
    catch (error) { return sendValidationError(res, error); }
});

app.post('/portfolio/accounts', authenticateToken, async (req, res) => {
    const { name, institution = null, accountType, currency = 'USD', cashMinor = 0 } = req.body || {};
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
        currency = 'USD',
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

app.get("/accounts", authenticateToken, async (req, res) => {
    try {
        return res.json(await dbService.getAccountsForUser(req.user.userId));
    } catch (error) {
        return sendValidationError(res, error);
    }
});

// Compatibility endpoint for the current frontend. New integrations should use /transactions.
app.post("/MoniMonitor_ToDB", authenticateToken, async (req, res) => {
    const { status, record_entry, record_type, ...filters } = req.body || {};
    try {
        if (status === "read") return res.json(await dbService.getAllTransactionsForUser(req.user.userId, filters));
        if (status !== "record") return res.status(400).json({ error: "Invalid status" });

        const transaction = parseTransaction({ ...record_entry, Type: record_type || record_entry?.Type });
        const id = await dbService.addTransaction({ ...transaction, userId: req.user.userId });
        await dbService.detectAndMarkRecurring(req.user.userId, id).catch((error) => console.error("Recurrence detection error:", error.message));
        return res.status(201).json({ message: "Created", data: { ...transaction, id } });
    } catch (error) {
        return sendValidationError(res, error);
    }
});

app.use((error, _req, res, _next) => {
    if (error.message === "Origin is not allowed by CORS") return res.status(403).json({ error: "Origin is not allowed" });
    console.error("Unhandled API error:", error);
    return res.status(500).json({ error: "Unexpected server error" });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`API server listening on http://localhost:${PORT}`);
    });
}

module.exports = app;