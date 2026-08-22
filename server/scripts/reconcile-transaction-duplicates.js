require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const dryRun = process.argv.includes('--dry-run');
const userIndex = process.argv.indexOf('--user');
const userId = userIndex >= 0 ? process.argv[userIndex + 1] : null;

// The database initializer also runs this migration for normal application
// starts. Disable that automatic pass here so this command controls whether
// the requested run is a preview or an apply.
process.env.MONIMONITOR_SKIP_TRANSACTION_RECONCILIATION = '1';

const { getDb } = require('../src/database/db');
const { reconcileTransactionDuplicates } = require('../src/services/transactionDeduplication');

(async () => {
    const db = await getDb();
    const summary = await reconcileTransactionDuplicates(db, userId, { dryRun });
    console.log(JSON.stringify({ dryRun, ...summary }, null, 2));
    await db.close();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
