const SNAPSHOT_ID = 'financial-snapshot-2026-08-11';
const SNAPSHOT_CAPTURED_AT = '2026-08-11T18:45:00.000Z';

const accounts = [
    { name: 'CIBC Chequing', institution: 'CIBC', accountType: 'Chequing', account: '6768237', cashMinor: 95336 },
    { name: 'RBC Chequing', institution: 'RBC', accountType: 'Chequing', account: '03481-5026554', cashMinor: 114184 },
    { name: 'RBC Visa', institution: 'RBC', accountType: 'Credit Card', account: '4510 **** **** 2379', cashMinor: 160955 },
    { name: 'TFSA', institution: 'Wealthsimple', accountType: 'TFSA', account: 'TFSA', cashMinor: 85017 },
    { name: 'Future', institution: 'Wealthsimple', accountType: 'Savings', account: '•••• 1234', cashMinor: 4033034 },
    { name: 'Earnings', institution: 'Wealthsimple', accountType: 'Savings', account: '•••• 1832', cashMinor: 15819 },
];

// Per-share values are derived from the displayed market value and all-time return.
// Micros preserve enough precision for the screenshot totals to round to the cent.
const tfsaHoldings = [
    { symbol: 'QQC', quantity: 44.8032, averageCostMicros: 43118572, priceMicros: 48700093 },
    { symbol: 'VFV', quantity: 20.7006, averageCostMicros: 161373100, priceMicros: 190630223 },
    { symbol: 'XEQT', quantity: 53.0986, averageCostMicros: 40012731, priceMicros: 45910062 },
];

async function applyFinancialSnapshot(db, userId) {
    if (!userId) {
        console.warn(`[Snapshot ${SNAPSHOT_ID}] USER_ID is not configured; reset skipped.`);
        return false;
    }

    await db.exec(`
        CREATE TABLE IF NOT EXISTS app_migrations (
            id TEXT PRIMARY KEY,
            userId TEXT NOT NULL,
            appliedAt TEXT NOT NULL,
            details TEXT
        )
    `);

    const migrationId = `${SNAPSHOT_ID}:${userId}`;
    await db.exec('BEGIN IMMEDIATE');
    try {
        if (await db.get('SELECT id FROM app_migrations WHERE id = ?', [migrationId])) {
            await db.exec('COMMIT');
            return false;
        }

        const user = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) {
            await db.exec('ROLLBACK');
            console.warn(`[Snapshot ${SNAPSHOT_ID}] User ${userId} does not exist; reset skipped.`);
            return false;
        }

        // Clear the previous analysis state while retaining processed email UIDs so
        // historical messages cannot be imported again after the reset.
        await db.run('DELETE FROM portfolio_transactions WHERE userId = ?', [userId]);
        await db.run('DELETE FROM transactions WHERE userId = ?', [userId]);
        await db.run('DELETE FROM merchant_rules WHERE userId = ?', [userId]);
        await db.run('DELETE FROM investment_holdings WHERE userId = ?', [userId]);
        await db.run('DELETE FROM investment_accounts WHERE userId = ?', [userId]);
        await db.run('DELETE FROM accounts WHERE userId = ?', [userId]);

        let tfsaAccountId = null;
        for (const account of accounts) {
            await db.run(
                `INSERT INTO accounts (userId, Account, BankName, Type, FirstSeen)
                 VALUES (?, ?, ?, ?, ?)`,
                [userId, account.account, account.institution, account.accountType, SNAPSHOT_CAPTURED_AT]
            );
            const result = await db.run(
                `INSERT INTO investment_accounts
                    (userId, name, institution, accountType, currency, cashMinor, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, 'CAD', ?, ?, ?)`,
                [userId, account.name, account.institution, account.accountType, account.cashMinor,
                    SNAPSHOT_CAPTURED_AT, SNAPSHOT_CAPTURED_AT]
            );
            if (account.name === 'TFSA') tfsaAccountId = result.lastID;
        }

        for (const holding of tfsaHoldings) {
            await db.run(
                `INSERT INTO investment_holdings
                    (userId, accountId, symbol, name, quantity, averageCostMinor, averageCostMicros,
                     priceMinor, priceMicros, currency, updatedAt)
                 VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'CAD', ?)`,
                [userId, tfsaAccountId, holding.symbol, holding.quantity,
                    Math.round(holding.averageCostMicros / 10000), holding.averageCostMicros,
                    Math.round(holding.priceMicros / 10000), holding.priceMicros, SNAPSHOT_CAPTURED_AT]
            );
        }

        const appliedAt = new Date().toISOString();
        await db.run(
            `INSERT INTO app_migrations (id, userId, appliedAt, details) VALUES (?, ?, ?, ?)`,
            [migrationId, userId, appliedAt, JSON.stringify({ accounts: accounts.length, holdings: tfsaHoldings.length })]
        );
        await db.run(
            `INSERT INTO agent_audit_log (userId, action, status, details, createdAt)
             VALUES (?, 'financial_snapshot_reset', 'success', ?, ?)`,
            [userId, JSON.stringify({ snapshotId: SNAPSHOT_ID, capturedAt: SNAPSHOT_CAPTURED_AT }), appliedAt]
        );
        await db.exec('COMMIT');
        console.log(`[Snapshot ${SNAPSHOT_ID}] Reset complete for user ${userId}.`);
        return true;
    } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
    }
}

module.exports = { SNAPSHOT_CAPTURED_AT, applyFinancialSnapshot };
