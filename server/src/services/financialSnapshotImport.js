const { z } = require('zod');

const minor = z.number().int().refine(Number.isSafeInteger);
const text = z.string().trim().min(1).max(120);
const schema = z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    capturedAt: z.iso.datetime(),
    accounts: z.array(z.object({
        name: text, institution: text,
        accountType: z.enum(['Chequing', 'Savings', 'Credit Card', 'TFSA', 'RRSP', 'Brokerage', 'Crypto', '401(k)', 'IRA', 'Other']),
        accountRef: text, currency: z.literal('CAD'), cashMinor: minor,
    }).strict()).min(1).max(100),
    holdings: z.array(z.object({
        accountRef: text, symbol: z.string().regex(/^[A-Z0-9.\-]{1,15}$/),
        quantity: z.number().finite().positive(),
        averageCostMicros: z.number().int().nonnegative().refine(Number.isSafeInteger),
        priceMicros: z.number().int().nonnegative().refine(Number.isSafeInteger),
    }).strict()).max(1000).default([]),
}).strict();

function parseSnapshot(input) {
    const snapshot = schema.parse(input);
    const refs = new Set(snapshot.accounts.map((account) => account.accountRef));
    if (refs.size !== snapshot.accounts.length) throw new Error('Snapshot account references must be unique');
    const holdings = new Set();
    for (const holding of snapshot.holdings) {
        if (!refs.has(holding.accountRef)) throw new Error('Holding references an unknown snapshot account');
        const key = `${holding.accountRef}:${holding.symbol}`;
        if (holdings.has(key)) throw new Error('Duplicate snapshot holding');
        holdings.add(key);
    }
    return snapshot;
}

async function assertEmptyFinancialState(db, userId) {
    if (!await db.get('SELECT id FROM users WHERE id = ?', [userId])) throw new Error('Snapshot owner does not exist');
    for (const table of ['transactions', 'accounts', 'investment_accounts', 'portfolio_transactions', 'account_balance_events']) {
        if (await db.get(`SELECT 1 FROM ${table} WHERE userId = ? LIMIT 1`, [userId])) {
            throw new Error('Snapshot import requires an empty financial account; existing history will never be deleted');
        }
    }
}

async function importSnapshot(db, userId, input, createBackup) {
    const snapshot = parseSnapshot(input);
    await assertEmptyFinancialState(db, userId);
    if (typeof createBackup !== 'function') throw new Error('A verified safety backup is required');
    const backup = await createBackup('manual');
    if (!backup?.fileName) throw new Error('Safety backup was not created');
    return db.withTransaction(async () => {
        await assertEmptyFinancialState(db, userId);
        const accountIds = new Map();
        for (const account of snapshot.accounts) {
            await db.run('INSERT INTO accounts (userId, Account, BankName, Type, FirstSeen) VALUES (?, ?, ?, ?, ?)',
                [userId, account.accountRef, account.institution, account.accountType, snapshot.capturedAt]);
            const result = await db.run(`INSERT INTO investment_accounts
                (userId, name, institution, accountType, accountRef, currency, cashMinor, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, account.name, account.institution, account.accountType, account.accountRef,
                account.currency, account.cashMinor, snapshot.capturedAt, snapshot.capturedAt]);
            accountIds.set(account.accountRef, result.lastID);
        }
        for (const holding of snapshot.holdings) {
            await db.run(`INSERT INTO investment_holdings
                (userId, accountId, symbol, quantity, averageCostMinor, averageCostMicros, priceMinor, priceMicros, currency, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CAD', ?)`,
            [userId, accountIds.get(holding.accountRef), holding.symbol, holding.quantity,
                Math.round(holding.averageCostMicros / 10000), holding.averageCostMicros,
                Math.round(holding.priceMicros / 10000), holding.priceMicros, snapshot.capturedAt]);
        }
        await db.run(`INSERT INTO agent_audit_log (userId, action, status, details, createdAt)
            VALUES (?, 'financial_snapshot_import', 'success', ?, ?)`,
        [userId, JSON.stringify({ snapshotId: snapshot.id, capturedAt: snapshot.capturedAt,
            accounts: snapshot.accounts.length, holdings: snapshot.holdings.length, safetyBackup: backup.fileName }), new Date().toISOString()]);
        return { snapshotId: snapshot.id, accounts: snapshot.accounts.length, holdings: snapshot.holdings.length, safetyBackup: backup.fileName };
    });
}

module.exports = { parseSnapshot, assertEmptyFinancialState, importSnapshot };
