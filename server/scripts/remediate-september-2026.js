const fs = require('fs');
const path = require('path');
const { getDb } = require('../src/database/db');
const { refreshMonthlySummary } = require('../src/database/monthlySummaries');

async function run() {
    const dbPath = path.join(__dirname, '..', 'monimonitor.sqlite');
    const backupPath = path.join(__dirname, '..', `monimonitor.before-september-2026-fix-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    
    console.log(`[Backup] Creating database snapshot: ${backupPath}...`);
    fs.copyFileSync(dbPath, backupPath);
    console.log('[Backup] Snapshot created successfully.');

    const db = await getDb();
    const userId = '1';

    await db.run('BEGIN IMMEDIATE');
    try {
        console.log('\n--- 1. REMAPPING AND CLEANING DUPLICATE INVESTMENT ACCOUNTS ---');
        // Canonical map based on accountRef / mask:
        // S0K7 / HQ656S0K7CAD -> 10 (TFSA)
        // 1832 / •••• 1832 -> 12 (Earnings)
        // 5X03 -> 16 (Line of Credit)
        // GH67 -> 17 (FHSA)
        // LZ12 / HQ5YZLZ12CAD -> 13 (Crypto)
        // WX05 -> 21 (Non-registered)
        // 1234 / •••• 1234 -> 11 (Future)
        // 1371 -> 15 (Car Expenses)
        // 0WK8 -> 14 (TFSA 0WK8)
        // 8237 / 6768237 -> 7 (CIBC Smart Account)
        // 6554 / 03481-5026554 -> 8 (RBC Chequing)
        // 2379 / 4510 **** **** 2379 -> 9 (RBC Credit Card)
        const refToCanonical = {
            'S0K7': 10,
            'HQ656S0K7CAD': 10,
            '1832': 12,
            '•••• 1832': 12,
            '5X03': 16,
            'GH67': 17,
            'LZ12': 13,
            'HQ5YZLZ12CAD': 13,
            'WX05': 21,
            '1234': 11,
            '•••• 1234': 11,
            '1371': 15,
            '0WK8': 14,
            '8237': 7,
            '6768237': 7,
            '6554': 8,
            '03481-5026554': 8,
            '2379': 9,
            '4510 **** **** 2379': 9,
        };

        console.log('Cleaning up duplicate holdings for accounts with id > 21...');
        const delHoldingsRes = await db.run('DELETE FROM investment_holdings WHERE accountId > 21');
        console.log(`Deleted ${delHoldingsRes.changes} duplicate rows from investment_holdings.`);

        const dupAccounts = await db.all('SELECT id, name, accountRef, institution FROM investment_accounts WHERE id > 21');
        console.log(`Found ${dupAccounts.length} duplicate investment accounts with id > 21.`);

        let remappedCount = 0;
        for (const dup of dupAccounts) {
            const canonicalId = refToCanonical[dup.accountRef];
            if (!canonicalId) {
                console.warn(`[Warning] No canonical ID found for duplicate account: ${dup.id} (${dup.name}, ref: ${dup.accountRef})`);
                continue;
            }

            await db.run('UPDATE transactions SET PortfolioAccountId = ? WHERE PortfolioAccountId = ?', [canonicalId, dup.id]);
            await db.run('UPDATE transactions SET BalanceAccountId = ? WHERE BalanceAccountId = ?', [canonicalId, dup.id]);
            await db.run('UPDATE portfolio_transactions SET accountId = ? WHERE accountId = ?', [canonicalId, dup.id]);
            await db.run('UPDATE account_balance_events SET accountId = ? WHERE accountId = ?', [canonicalId, dup.id]);
            await db.run('UPDATE plaid_accounts SET appAccountId = ? WHERE appAccountId = ?', [canonicalId, dup.id]);
            remappedCount++;
        }
        console.log(`Remapped references for ${remappedCount} duplicate accounts.`);

        const delRes = await db.run('DELETE FROM investment_accounts WHERE id > 21');
        console.log(`Deleted ${delRes.changes} duplicate rows from investment_accounts.`);

        console.log('\n--- 2. MERGING DUPLICATE CUPE PAYROLL DEPOSIT ---');
        // Canonical: 64034, Duplicate: 64101
        await db.run('UPDATE transaction_sources SET transactionId = 64034 WHERE transactionId = 64101');
        await db.run('DELETE FROM transactions WHERE id = 64101');
        await db.run(
            `UPDATE transactions
             SET Category = 'Income', Label = 'Employment Income', AccountFlow = 'IN',
                 BalanceAccountId = 7, BalanceAccountConfidence = 'HIGH'
             WHERE id = 64034`
        );
        console.log('Merged duplicate CUPE deposit (ID 64101 -> ID 64034).');

        console.log('\n--- 3. MERGING 15 DUPLICATE WEALTHSIMPLE RECURRING BUYS ---');
        const recurringPairs = [
            // Sept 15
            { dup: 64121, canonical: 64030 }, // XEQT
            { dup: 64122, canonical: 64029 }, // VFV
            { dup: 64123, canonical: 64031 }, // QQC
            // Sept 16
            { dup: 64118, canonical: 64046 }, // XEQT
            { dup: 64119, canonical: 64045 }, // QQC
            { dup: 64120, canonical: 64044 }, // VFV
            // Sept 17
            { dup: 64115, canonical: 64050 }, // XEQT
            { dup: 64116, canonical: 64049 }, // VFV
            { dup: 64117, canonical: 64048 }, // QQC
            // Sept 18
            { dup: 64112, canonical: 64057 }, // XEQT
            { dup: 64113, canonical: 64056 }, // QQC
            { dup: 64114, canonical: 64055 }, // VFV
            // Sept 25
            { dup: 64109, canonical: 64126 }, // XEQT
            { dup: 64110, canonical: 64125 }, // VFV
            { dup: 64111, canonical: 64124 }, // QQC
        ];

        for (const { dup, canonical } of recurringPairs) {
            await db.run('UPDATE transaction_sources SET transactionId = ? WHERE transactionId = ?', [canonical, dup]);
            await db.run('DELETE FROM transactions WHERE id = ?', [dup]);
            await db.run(
                `UPDATE transactions
                 SET PortfolioAccountId = 10, PortfolioConfidence = 'HIGH',
                     BalanceAccountId = 10, BalanceAccountConfidence = 'HIGH',
                     PortfolioAccountNumber = 'S0K7', Currency = 'CAD'
                 WHERE id = ?`,
                [canonical]
            );
        }
        console.log(`Merged ${recurringPairs.length} duplicate recurring buys into their canonical records.`);

        console.log('\n--- 4. BALANCING YORK UNIVERSITY PAY & INTERAC TRANSFER ---');
        // Update ID 64102: PAY YORK UNIVERSITY
        await db.run(
            `UPDATE transactions
             SET Label = 'Employment Income', BalanceAccountId = 7, BalanceAccountConfidence = 'HIGH'
             WHERE id = 64102`
        );
        console.log('Updated ID 64102 to Employment Income and BalanceAccountId = 7.');

        // Update ID 64127: Wealthsimple Earnings incoming leg
        await db.run(
            `UPDATE transactions
             SET BalanceAccountId = 12, BalanceAccountConfidence = 'HIGH',
                 Reason = 'Internal transfer: CIBC Chequing -> Wealthsimple Earnings'
             WHERE id = 64127`
        );
        console.log('Updated ID 64127 BalanceAccountId = 12 and reason.');

        // Insert missing CIBC Chequing OUT leg for 1981.34 CAD
        const existingCibcOut = await db.get(
            `SELECT id FROM transactions
             WHERE userId = ? AND AmountMinor = 198134 AND AccountFlow = 'OUT' AND BankName = 'CIBC'`
            , [userId]
        );
        if (!existingCibcOut) {
            const cibcOutRes = await db.run(
                `INSERT INTO transactions (
                    userId, Amount, AmountMinor, Currency, Category, Label,
                    Reason, Timestamp, Type, Account, BankName, ReferenceNumber,
                    AccountFlow, BalanceAccountId, BalanceAccountConfidence, Frequency
                ) VALUES (
                    ?, '1981.34', 198134, 'CAD', 'Internal', 'Internal Transfer',
                    'Internal transfer: CIBC Chequing -> Wealthsimple Earnings',
                    '2026-09-25T12:00:00.000Z', 'Chequing', '8237', 'CIBC',
                    'XFER-SELF-20260925-198134-64127', 'OUT', 7, 'HIGH', 'OneTime'
                )`,
                [userId]
            );
            console.log(`Inserted missing CIBC OUT leg for 1981.34 CAD (ID ${cibcOutRes.lastID}).`);
        } else {
            console.log(`CIBC OUT leg already exists (ID ${existingCibcOut.id}).`);
        }

        console.log('\n--- 5. BALANCING FUTURE -> TFSA TRANSFER ($42.89) ---');
        // Update ID 63965 (OUT leg from Future 1234)
        const tfsaTransferRef = 'XFER-ACT-20260902-134518-4289-1234-S0K7';
        await db.run(
            `UPDATE transactions
             SET Reason = 'Internal transfer: Future -> TFSA [XFER-ACT-20260902-134518-4289-1234-S0K7]',
                 ReferenceNumber = ?, BalanceAccountId = 11, BalanceAccountConfidence = 'HIGH'
             WHERE id = 63965`,
            [tfsaTransferRef]
        );

        // Check or insert TFSA IN leg
        let tfsaIn = await db.get(
            `SELECT id FROM transactions
             WHERE userId = ? AND AmountMinor = 4289 AND AccountFlow = 'IN' AND Category = 'Internal'`,
            [userId]
        );
        if (!tfsaIn) {
            const tfsaInRes = await db.run(
                `INSERT INTO transactions (
                    userId, Amount, AmountMinor, Currency, Category, Label,
                    Reason, Timestamp, Type, Account, BankName, ReferenceNumber,
                    AccountFlow, BalanceAccountId, BalanceAccountConfidence,
                    PortfolioAccountId, PortfolioAction, PortfolioConfidence, PortfolioAccountNumber,
                    Frequency
                ) VALUES (
                    ?, '42.89', 4289, 'CAD', 'Internal', 'Internal Transfer',
                    'Internal transfer: Future -> TFSA [XFER-ACT-20260902-134518-4289-1234-S0K7]',
                    '2026-09-02T13:45:18.000Z', 'TFSA', 'S0K7', 'Wealthsimple',
                    ?, 'IN', 10, 'HIGH',
                    10, 'TRANSFER', 'HIGH', 'S0K7',
                    'OneTime'
                )`,
                [userId, tfsaTransferRef]
            );
            tfsaIn = { id: tfsaInRes.lastID };
            console.log(`Inserted missing TFSA IN leg for 42.89 CAD (ID ${tfsaIn.id}).`);
        }

        // Move Plaid source 'OEVeNXAgZ8fPQNrQ7PD1uMYPyZZpmgiZxxALL' from 63965 to tfsaIn.id
        await db.run(
            `UPDATE transaction_sources
             SET transactionId = ?
             WHERE externalId = 'OEVeNXAgZ8fPQNrQ7PD1uMYPyZZpmgiZxxALL' AND provider = 'plaid_investments'`,
            [tfsaIn.id]
        );
        console.log(`Re-linked Plaid source OEVeNXAgZ8fPQNrQ7PD1uMYPyZZpmgiZxxALL to TFSA IN leg (ID ${tfsaIn.id}).`);

        console.log('\n--- 6. BACKFILLING BALANCE ACCOUNT IDS ON PLAID TRANSACTIONS ---');
        const balanceBackfills = [
            { id: 63961, balanceAccountId: 12 }, // WS 1832
            { id: 63962, balanceAccountId: 11 }, // WS 1234
            { id: 63976, balanceAccountId: 7 },  // CIBC 8237
            { id: 64003, balanceAccountId: 7 },  // CIBC 8237
            { id: 64035, balanceAccountId: 7 },  // CIBC 8237
            { id: 64036, balanceAccountId: 7 },  // CIBC 8237
        ];
        for (const item of balanceBackfills) {
            await db.run(
                'UPDATE transactions SET BalanceAccountId = ?, BalanceAccountConfidence = "HIGH" WHERE id = ?',
                [item.balanceAccountId, item.id]
            );
        }
        console.log(`Backfilled BalanceAccountId on ${balanceBackfills.length} Plaid transactions.`);

        console.log('\n--- 7. FIXING ACCOUNT FLOW NONE ON INTERNAL INFLOWS ---');
        await db.run("UPDATE transactions SET AccountFlow = 'IN' WHERE id IN (63952, 63954)");
        console.log('Updated AccountFlow to IN for ID 63952 and 63954.');

        console.log('\n--- 8. REFRESHING MONTHLY TRANSACTION SUMMARIES ---');
        await refreshMonthlySummary(db, userId, '2026-09');
        console.log('Refreshed monthly summary for 2026-09.');

        await db.run('COMMIT');
        console.log('\n=== REMEDIATION COMPLETED SUCCESSFULLY (TRANSACTION COMMITTED) ===\n');
    } catch (err) {
        await db.run('ROLLBACK');
        console.error('Remediation error, rolled back:', err);
        throw err;
    } finally {
        await db.close();
    }
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
