const fs = require('fs');
const path = require('path');
const { getDb } = require('../src/database/db');
const { refreshMonthlySummary } = require('../src/database/monthlySummaries');

async function run() {
    const dbPath = path.join(__dirname, '..', 'monimonitor.sqlite');
    const backupPath = path.join(__dirname, '..', `monimonitor.before-multi-item-fix-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);

    console.log(`[Backup] Creating database snapshot: ${backupPath}...`);
    fs.copyFileSync(dbPath, backupPath);
    console.log('[Backup] Snapshot created successfully.');

    const db = await getDb();
    const userId = '1';

    await db.run('BEGIN IMMEDIATE');
    try {
        console.log('\n--- 1. CONSOLIDATING WEALTHSIMPLE PLAID ITEMS ---');
        const oldItemId = 'gBevNa74mZSBew6erB4Oh5vpB57K6kTXa7LRn';
        const newItemId = '0X5XwDd8E1uV56KQNbVnfxOZ6XwNEYCeo080R';

        // Check how many sources exist on old item
        const oldSources = await db.get('SELECT count(*) as count FROM transaction_sources WHERE itemId = ?', [oldItemId]);
        console.log(`[Plaid Items] Migrating ${oldSources.count} transaction sources from old item to new item...`);
        await db.run(
            'UPDATE transaction_sources SET itemId = ? WHERE itemId = ? AND userId = ?',
            [newItemId, oldItemId, userId]
        );

        // Delete old Plaid accounts and item
        const deletedOldAccts = await db.run('DELETE FROM plaid_accounts WHERE itemId = ? AND userId = ?', [oldItemId, userId]);
        const deletedOldItem = await db.run('DELETE FROM plaid_items WHERE itemId = ? AND userId = ?', [oldItemId, userId]);
        console.log(`[Plaid Items] Deleted ${deletedOldAccts.changes} old plaid_accounts and ${deletedOldItem.changes} duplicate plaid_items.`);

        console.log('\n--- 2. UPDATING PLAID ACCOUNTS MAPPING TO CANONICAL APP ACCOUNTS ---');
        // Map remaining Plaid accounts to canonical IDs
        const accountMappings = [
            { mask: '1832', appAccountId: 12 },
            { mask: '5X03', appAccountId: 16 },
            { mask: 'GH67', appAccountId: 17 },
            { mask: 'LZ12', appAccountId: 13 },
            { mask: 'S0K7', appAccountId: 10 },
            { mask: 'WX05', appAccountId: 21 },
            { mask: '8237', appAccountId: 7 },
        ];
        for (const m of accountMappings) {
            const res = await db.run(
                'UPDATE plaid_accounts SET appAccountId = ? WHERE mask = ? AND userId = ?',
                [m.appAccountId, m.mask, userId]
            );
            console.log(`[Plaid Accounts] Mask ${m.mask} -> appAccountId ${m.appAccountId} (rows updated: ${res.changes})`);
        }

        console.log('\n--- 3. REMAPPING AND PURGING ZOMBIE ACCOUNTS & HOLDINGS ---');
        // Remap any references from accounts > 21
        const refToCanonical = {
            'S0K7': 10,
            '1832': 12,
            '5X03': 16,
            'GH67': 17,
            'LZ12': 13,
            'WX05': 21,
            '1234': 11,
            '1371': 15,
            '0WK8': 14,
            '8237': 7,
            '6554': 8,
            '2379': 9,
        };

        const zombieAccounts = await db.all('SELECT id, name, accountRef FROM investment_accounts WHERE id > 21 AND userId = ?', [userId]);
        console.log(`[Zombie Accounts] Found ${zombieAccounts.length} zombie accounts.`);
        for (const za of zombieAccounts) {
            const canonicalId = refToCanonical[za.accountRef];
            if (canonicalId) {
                await db.run('UPDATE transactions SET BalanceAccountId = ? WHERE BalanceAccountId = ?', [canonicalId, za.id]);
                await db.run('UPDATE transactions SET PortfolioAccountId = ? WHERE PortfolioAccountId = ?', [canonicalId, za.id]);
                await db.run('UPDATE account_balance_events SET accountId = ? WHERE accountId = ?', [canonicalId, za.id]);
            }
        }

        const deletedHoldings = await db.run('DELETE FROM investment_holdings WHERE accountId > 21 AND userId = ?', [userId]);
        const deletedZombies = await db.run('DELETE FROM investment_accounts WHERE id > 21 AND userId = ?', [userId]);
        console.log(`[Cleanup] Deleted ${deletedHoldings.changes} duplicate holdings and ${deletedZombies.changes} zombie accounts.`);

        console.log('\n--- 4. MERGING DUPLICATE TRANSACTIONS ---');
        const duplicateMerges = [
            // CUPE payroll duplicate from CIBC Plaid connection
            { duplicateId: 64134, canonicalId: 64034, description: 'CUPE Local 3903 payroll ($1,271.18 on 2026-09-15)' },
            // Wealthsimple Earnings Interest duplicates
            { duplicateId: 64106, canonicalId: 63335, description: 'Wealthsimple Earnings Interest ($0.16 on 2026-08-01)' },
            { duplicateId: 64107, canonicalId: 63031, description: 'Wealthsimple Earnings Interest ($0.12 on 2026-07-01)' },
            // Toyota Financial vehicle financing duplicates
            { duplicateId: 63981, canonicalId: 63034, description: 'Toyota Financial financing ($628.75 on 2026-07-02)' },
            { duplicateId: 63983, canonicalId: 63332, description: 'Toyota Financial financing ($628.75 on 2026-08-04)' },
        ];

        for (const m of duplicateMerges) {
            const dup = await db.get('SELECT * FROM transactions WHERE id = ?', [m.duplicateId]);
            const canon = await db.get('SELECT * FROM transactions WHERE id = ?', [m.canonicalId]);
            if (dup && canon) {
                console.log(`[Merge] Merging ${m.description} (ID ${m.duplicateId} -> ID ${m.canonicalId})...`);
                // Move sources to canonical
                await db.run(
                    'UPDATE transaction_sources SET transactionId = ?, ownsTransaction = 0 WHERE transactionId = ?',
                    [m.canonicalId, m.duplicateId]
                );
                // Delete duplicate transaction
                await db.run('DELETE FROM transactions WHERE id = ?', [m.duplicateId]);
                // Delete balance events for duplicate
                await db.run('DELETE FROM account_balance_events WHERE sourceTransactionId = ?', [m.duplicateId]);
                console.log(`[Merge] Successfully merged ID ${m.duplicateId} into ID ${m.canonicalId}.`);
            } else {
                console.log(`[Merge] Skipping ${m.description} - already merged or missing.`);
            }
        }

        // Ensure canonical transaction attributes
        await db.run(`
            UPDATE transactions
            SET Category = 'Income', Label = 'Employment Income', BankName = 'CIBC', Account = '8237',
                BalanceAccountId = 7, BalanceAccountConfidence = 'HIGH', AccountFlow = 'IN'
            WHERE id = 64034
        `);
        await db.run(`
            UPDATE transactions
            SET BalanceAccountId = 12, BalanceAccountConfidence = 'HIGH', AccountFlow = 'IN'
            WHERE id IN (63031, 63335)
        `);
        await db.run(`
            UPDATE transactions
            SET BalanceAccountId = 7, BalanceAccountConfidence = 'HIGH', AccountFlow = 'OUT'
            WHERE id IN (63034, 63332)
        `);

        console.log('\n--- 5. RECONCILING AUTHORITATIVE BALANCES & HOLDINGS ---');
        // Canonical balances:
        // Account 7 (CIBC Smart Account): $2,558.84
        await db.run(`
            UPDATE investment_accounts
            SET cashMinor = 255884, currency = 'CAD', accountRef = '8237', name = 'CIBC Smart Account •8237',
                accountType = 'Chequing', updatedAt = ?
            WHERE id = 7
        `, [new Date().toISOString()]);

        // Account 8 (RBC Chequing): $885.33
        await db.run(`
            UPDATE investment_accounts
            SET cashMinor = 88533, currency = 'CAD', accountRef = '6554', name = 'RBC Chequing',
                accountType = 'Chequing', updatedAt = ?
            WHERE id = 8
        `, [new Date().toISOString()]);

        // Account 9 (RBC Visa): $329.64
        await db.run(`
            UPDATE investment_accounts
            SET cashMinor = 32964, currency = 'CAD', accountRef = '2379', name = 'RBC Visa',
                accountType = 'Credit Card', updatedAt = ?
            WHERE id = 9
        `, [new Date().toISOString()]);

        // Account 10 (Wealthsimple TFSA): Cash $1,186.38
        await db.run(`
            UPDATE investment_accounts
            SET cashMinor = 118638, currency = 'CAD', accountRef = 'S0K7', name = 'Wealthsimple TFSA •S0K7',
                accountType = 'TFSA', updatedAt = ?
            WHERE id = 10
        `, [new Date().toISOString()]);

        // Account 11 (Future): $42.89
        await db.run(`
            UPDATE investment_accounts
            SET cashMinor = 4289, currency = 'CAD', accountRef = '1234', name = 'Future',
                accountType = 'Savings', updatedAt = ?
            WHERE id = 11
        `, [new Date().toISOString()]);

        // Account 12 (Wealthsimple Earnings): $2,173.55
        await db.run(`
            UPDATE investment_accounts
            SET cashMinor = 217355, currency = 'CAD', accountRef = '1832', name = 'Wealthsimple Earnings •1832',
                accountType = 'Chequing', updatedAt = ?
            WHERE id = 12
        `, [new Date().toISOString()]);

        // Account 13 (Wealthsimple Crypto): $0
        await db.run(`
            UPDATE investment_accounts
            SET cashMinor = 0, currency = 'CAD', accountRef = 'LZ12', name = 'Wealthsimple Crypto •LZ12',
                accountType = 'Crypto', updatedAt = ?
            WHERE id = 13
        `, [new Date().toISOString()]);

        // Account 16 (Line of Credit): $0
        await db.run(`
            UPDATE investment_accounts
            SET cashMinor = 0, currency = 'CAD', accountRef = '5X03', name = 'Wealthsimple Line of Credit •5X03',
                accountType = 'Other', updatedAt = ?
            WHERE id = 16
        `, [new Date().toISOString()]);

        // Account 17 (FHSA): $0
        await db.run(`
            UPDATE investment_accounts
            SET cashMinor = 0, currency = 'CAD', accountRef = 'GH67', name = 'Wealthsimple FHSA •GH67',
                accountType = 'Savings', updatedAt = ?
            WHERE id = 17
        `, [new Date().toISOString()]);

        // Account 21 (Non-registered): $42,000.00
        await db.run(`
            UPDATE investment_accounts
            SET cashMinor = 4200000, currency = 'CAD', accountRef = 'WX05', name = 'Wealthsimple Non-registered •WX05',
                accountType = 'Savings', updatedAt = ?
            WHERE id = 21
        `, [new Date().toISOString()]);

        // Authoritative Holdings for TFSA (Account 10):
        console.log('[Holdings] Updating TFSA Account 10 authoritative holdings...');
        await db.run('DELETE FROM investment_holdings WHERE accountId = 10 AND userId = ?', [userId]);

        const canonicalHoldings = [
            {
                symbol: 'VFVXF',
                name: 'Vanguard Investments Canada Inc - Vanguard S&P 500 Index ETF',
                quantity: 22.3329,
                averageCostMinor: 16345,
                priceMinor: 19311,
                averageCostMicros: 163445410,
                priceMicros: 193110000,
                currency: 'CAD',
                updatedAt: '2026-09-25',
            },
            {
                symbol: 'QQC',
                name: 'Invesco Canada Ltd - CI Invesco NASDAQ 100 Index ETF (CAD Units)',
                quantity: 51.152,
                averageCostMinor: 4383,
                priceMinor: 5153,
                averageCostMicros: 43827221,
                priceMicros: 51530000,
                currency: 'CAD',
                updatedAt: '2026-09-25',
            },
            {
                symbol: 'XEQT',
                name: 'BlackRock Asset Management Canada Ltd - iShares Core Equity ETF Portfolio',
                quantity: 59.8852,
                averageCostMinor: 4065,
                priceMinor: 4597,
                averageCostMicros: 40654786,
                priceMicros: 45970000,
                currency: 'CAD',
                updatedAt: '2026-09-25',
            },
        ];

        for (const h of canonicalHoldings) {
            await db.run(`
                INSERT INTO investment_holdings
                    (userId, accountId, symbol, name, quantity, averageCostMinor, priceMinor, currency, updatedAt, averageCostMicros, priceMicros)
                VALUES (?, 10, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [userId, h.symbol, h.name, h.quantity, h.averageCostMinor, h.priceMinor, h.currency, h.updatedAt, h.averageCostMicros, h.priceMicros]);
            console.log(`[Holdings] Inserted ${h.symbol}: ${h.quantity} units @ $${(h.priceMinor / 100).toFixed(2)}`);
        }

        console.log('\n--- 6. RECALCULATING MONTHLY SUMMARIES ---');
        for (const month of ['2026-07', '2026-08', '2026-09']) {
            await refreshMonthlySummary(db, userId, month);
            const summary = await db.get('SELECT * FROM monthly_transaction_summaries WHERE userId = ? AND month = ?', [userId, month]);
            console.log(`[Summary ${month}] Income: $${(summary.totalIncomeMinor / 100).toFixed(2)}, Expense: $${(summary.totalExpenseMinor / 100).toFixed(2)}, Transactions: ${summary.transactionCount}`);
        }

        await db.run('COMMIT');
        console.log('\n=== REMEDIATION COMMITTED SUCCESSFULLY ===');
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('[Error] Remediation failed and rolled back:', error);
        throw error;
    }
}

run().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
