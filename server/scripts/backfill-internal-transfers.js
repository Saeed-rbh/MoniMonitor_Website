/**
 * backfill-internal-transfers.js
 *
 * One-time script to retroactively detect and reclassify Income/Expense
 * transactions that are actually the bank-side legs of an existing Internal
 * self-transfer (e.g. the RBC deposit / withdrawal alerts that accompany an
 * Interac self e-Transfer notification already stored as 'Internal').
 *
 * Only pairs Internal transactions that:
 *   1. Have ReceivedAt set (i.e. came from a real email, not a ledger import)
 *   2. Do NOT have a Reason starting with "Internal transfer:" (those are
 *      portfolio import entries with no matching bank-alert counterpart)
 *
 * Usage:
 *   node scripts/backfill-internal-transfers.js
 *   node scripts/backfill-internal-transfers.js --dry-run   (preview only, no changes)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const dbService = require('../src/database/dbService');

const USER_ID = process.env.USER_ID;
const DRY_RUN = process.argv.includes('--dry-run');
const WINDOW_MS = 2 * 60 * 60 * 1000; // 2-hour pairing window (same as real-time logic)

async function main() {
    if (!USER_ID) {
        console.error('USER_ID is not set in .env — cannot proceed.');
        process.exit(1);
    }

    const db = await dbService.getDb();
    console.log(`[Backfill] Running${DRY_RUN ? ' (DRY RUN — no changes will be saved)' : ''} for userId=${USER_ID}`);
    console.log(`[Backfill] Pairing window: ${WINDOW_MS / 3600000} hours\n`);

    // Only consider email-sourced Internal transactions (not ledger imports)
    const internals = await db.all(
        `SELECT * FROM transactions
         WHERE userId = ? AND Category = 'Internal'
           AND ReceivedAt IS NOT NULL
           AND Reason NOT LIKE 'Internal transfer:%'
         ORDER BY Timestamp ASC`,
        [USER_ID]
    );

    console.log(`[Backfill] Found ${internals.length} email-sourced Internal transaction(s) to check.`);

    let totalReclassified = 0;
    // Track reclassified IDs to avoid double-reclassifying when multiple internals match the same counterpart
    const alreadyReclassified = new Set();

    for (const internal of internals) {
        const internalTime = new Date(internal.Timestamp).getTime();
        if (!Number.isFinite(internalTime)) continue;

        // Find Income/Expense counterparts from real emails with the same amount within the window
        const counterparts = await db.all(
            `SELECT * FROM transactions
             WHERE userId = ? AND AmountMinor = ? AND Currency = ?
               AND Category IN ('Income', 'Expense')
               AND ReceivedAt IS NOT NULL
               AND id != ?`,
            [USER_ID, internal.AmountMinor, internal.Currency || 'CAD', internal.id]
        );

        for (const cp of counterparts) {
            if (alreadyReclassified.has(cp.id)) continue;
            const cpTime = new Date(cp.Timestamp).getTime();
            if (!Number.isFinite(cpTime)) continue;
            if (Math.abs(internalTime - cpTime) > WINDOW_MS) continue;

            console.log(
                `[Backfill] ${DRY_RUN ? '[DRY RUN] Would reclassify' : 'Reclassifying'} ` +
                `tx ${cp.id} (${cp.Category}/${cp.Label}, $${cp.Amount} ${cp.Currency}, ` +
                `${cp.Timestamp.slice(0, 16)}) → Internal/Internal Transfer` +
                `  ← paired with Internal tx ${internal.id} (${internal.Reason}, ${internal.Timestamp.slice(0, 16)})`
            );

            if (!DRY_RUN) {
                await db.run(
                    `UPDATE transactions SET Category = 'Internal', Label = 'Internal Transfer'
                     WHERE id = ? AND userId = ?`,
                    [cp.id, USER_ID]
                );
            }

            alreadyReclassified.add(cp.id);
            totalReclassified++;
        }
    }

    console.log(`\n[Backfill] Done. ${totalReclassified} transaction(s) ${DRY_RUN ? 'would be' : 'were'} reclassified.`);
}

main().catch((err) => {
    console.error('[Backfill] Unexpected error:', err);
    process.exit(1);
});
