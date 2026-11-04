// User-confirmed routing is separate from model guesses and statistical learning.
// A route applies only to an exact sender, template, account label and currency.
const identity = value => String(value || '').trim().toLowerCase();
const field = (body, name) => String(body || '').match(new RegExp(`^${name}:[ \\t]*([^\\r\\n]+)`, 'im'))?.[1]?.trim();

async function ensureReviewedEmailRoutes(db) {
    await db.exec(`CREATE TABLE IF NOT EXISTS reviewed_email_routes (
        userId TEXT NOT NULL, sender TEXT NOT NULL, subject TEXT NOT NULL,
        accountLabel TEXT NOT NULL, currency TEXT NOT NULL, accountId INTEGER NOT NULL,
        evidence TEXT NOT NULL, reviewedAt TEXT NOT NULL,
        PRIMARY KEY (userId, sender, subject, accountLabel, currency)
    )`);
}

function applyReviewedEmailRoute(transaction, body, accounts, routes) {
    const from = field(body, 'From') || '';
    const sender = from.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] || from;
    const subject = field(body, 'Subject');
    const label = field(body, 'Account');
    // Trade routing must never change the destination of a cash transfer.
    if (!['BUY', 'SELL'].includes(transaction.PortfolioAction) ||
        identity(sender) !== 'notifications@o.wealthsimple.com' ||
        identity(subject) !== 'your order has been filled' || !label) return transaction;
    const matches = routes.filter(route => identity(route.sender) === identity(sender) &&
        identity(route.subject) === identity(subject) && identity(route.accountLabel) === identity(label) &&
        route.currency === transaction.Currency && route.evidence && route.reviewedAt);
    if (new Set(matches.map(route => Number(route.accountId))).size !== 1) return transaction;
    const account = accounts.find(account => Number(account.id) === Number(matches[0].accountId));
    if (!account || account.currency !== transaction.Currency ||
        !/^wealthsimple$/i.test(String(account.institution).trim()) ||
        identity(account.accountType) !== identity(label) ||
        /\b(?:archived|closed)\b/i.test(account.name || '')) return transaction;
    return { ...transaction, Account: account.accountRef, PortfolioAccountNumber: account.accountRef,
        PortfolioAccountId: account.id, BalanceAccountId: account.id,
        PortfolioConfidence: 'HIGH', BalanceAccountConfidence: 'HIGH',
        ...(['ambiguous_account'].includes(transaction.IngestionReviewReason) ? { IngestionReviewReason: null } : {}) };
}

async function routeEmailForUser(db, userId, transaction, body, accounts) {
    await ensureReviewedEmailRoutes(db);
    const routes = await db.all('SELECT * FROM reviewed_email_routes WHERE userId = ?', [String(userId)]);
    return applyReviewedEmailRoute(transaction, body, accounts, routes);
}

module.exports = { ensureReviewedEmailRoutes, applyReviewedEmailRoute, routeEmailForUser };
