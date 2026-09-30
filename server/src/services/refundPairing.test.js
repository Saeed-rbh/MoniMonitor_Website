const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const {
    normalizeMerchantName,
    isRefundTransaction,
    findPurchaseCandidateForRefund,
    pairRefundTransaction,
    pairTransactionOnIngestion,
    reconcileRefundPairings,
    getRefundPairingForTransaction,
} = require('./refundPairing');

async function createTestDb() {
    const db = await open({
        filename: ':memory:',
        driver: sqlite3.Database,
    });
    db.withTransaction = async (fn) => {
        await db.run('BEGIN');
        try {
            const res = await fn(db);
            await db.run('COMMIT');
            return res;
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }
    };
    await db.exec(`
        CREATE TABLE transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            Amount REAL,
            AmountMinor INTEGER,
            Currency TEXT,
            Category TEXT,
            Label TEXT,
            Reason TEXT,
            Timestamp TEXT,
            ReceivedAt TEXT,
            Type TEXT,
            Account TEXT,
            BankName TEXT,
            ReferenceNumber TEXT,
            Frequency TEXT,
            TelegramMessageId INTEGER,
            PortfolioAction TEXT,
            PortfolioAccountId INTEGER,
            PortfolioConfidence TEXT,
            PortfolioSymbol TEXT,
            PortfolioQuantity REAL,
            PortfolioPrice REAL,
            BalanceAccountConfidence TEXT,
            PortfolioAccountNumber TEXT,
            PortfolioToSymbol TEXT,
            PortfolioToQuantity REAL,
            AccountFlow TEXT,
            SourceEmailKey TEXT,
            BalanceAccountId INTEGER
        );

        CREATE TABLE IF NOT EXISTS refund_pairings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            refundTransactionId INTEGER NOT NULL UNIQUE,
            purchaseTransactionId INTEGER NOT NULL,
            amountMinor INTEGER NOT NULL,
            matchType TEXT NOT NULL,
            confidence TEXT NOT NULL,
            pairedAt TEXT NOT NULL,
            FOREIGN KEY (refundTransactionId) REFERENCES transactions(id) ON DELETE CASCADE,
            FOREIGN KEY (purchaseTransactionId) REFERENCES transactions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS monthly_transaction_summaries (
            userId TEXT NOT NULL,
            month TEXT NOT NULL,
            incomeMinor INTEGER NOT NULL DEFAULT 0,
            expensesMinor INTEGER NOT NULL DEFAULT 0,
            savingsMinor INTEGER NOT NULL DEFAULT 0,
            transactionCount INTEGER NOT NULL DEFAULT 0,
            updatedAt TEXT NOT NULL,
            PRIMARY KEY (userId, month)
        );

        CREATE TABLE IF NOT EXISTS monthly_summary_dirty (
            userId TEXT NOT NULL,
            month TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1,
            changedAt TEXT NOT NULL,
            PRIMARY KEY (userId, month)
        );
    `);
    return db;
}

describe('refundPairing service', () => {
    test('leaves cross-card, cross-currency, and equally plausible purchases unpaired', async () => {
        const db = await createTestDb();
        try {
            await db.run(`INSERT INTO transactions (id, userId, AmountMinor, Currency, Category, Reason, Timestamp, Account, BankName, BalanceAccountId)
                VALUES (1, 'u', 10000, 'CAD', 'Expense', 'Walmart', '2026-09-20T12:00:00Z', '1234', 'RBC', 1)`);
            const refund = { id: 99, userId: 'u', AmountMinor: 5000, Currency: 'CAD', Category: 'Income',
                Label: 'Refunds & Reversals', Reason: 'Walmart', Timestamp: '2026-09-21T12:00:00Z',
                Account: '5678', BankName: 'RBC', BalanceAccountId: 2 };
            assert.equal(await findPurchaseCandidateForRefund(db, 'u', refund), null);
            assert.equal(await findPurchaseCandidateForRefund(db, 'u', { ...refund, Account: '1234', BalanceAccountId: 1, Currency: 'USD' }), null);
            await db.run(`INSERT INTO transactions (id, userId, AmountMinor, Currency, Category, Reason, Timestamp, Account, BankName, BalanceAccountId)
                SELECT 2, userId, AmountMinor, Currency, Category, Reason, Timestamp, Account, BankName, BalanceAccountId FROM transactions WHERE id = 1`);
            assert.equal(await findPurchaseCandidateForRefund(db, 'u', { ...refund, Account: '1234', BalanceAccountId: 1 }), null);
        } finally { await db.close(); }
    });
    test('normalizeMerchantName correctly extracts core merchant identities', () => {
        assert.equal(normalizeMerchantName('AMAZON.COM PMTS - CA'), 'amazon');
        assert.equal(normalizeMerchantName('AMZN Mktp CA'), 'amazon');
        assert.equal(normalizeMerchantName('WALMART.CA'), 'walmart');
        assert.equal(normalizeMerchantName('Groceries - Walmart'), 'walmart');
        assert.equal(normalizeMerchantName('GOOGLE *SERVICES'), 'google');
        assert.equal(normalizeMerchantName('GOOGLE *TEMPORARY HOLD'), 'google');
        assert.equal(normalizeMerchantName('Refund or credit - Temu'), 'temu');
        assert.equal(normalizeMerchantName('SERVICE CHARGE DISCOUNT'), 'service charge');
        assert.equal(normalizeMerchantName('Payment or purchase - DANIER'), 'danier');
    });

    test('isRefundTransaction correctly flags refunds and excludes transfers or payroll', () => {
        assert.equal(isRefundTransaction({ Label: 'Refunds & Reversals', Reason: 'WALMART.CA' }), true);
        assert.equal(isRefundTransaction({ Category: 'Income', Reason: 'SERVICE CHARGE DISCOUNT' }), true);
        assert.equal(isRefundTransaction({ AccountFlow: 'IN', Reason: 'You received a credit.' }), true);
        assert.equal(isRefundTransaction({ Category: 'Income', Label: 'Employment Income', Reason: 'York University' }), false);
        assert.equal(isRefundTransaction({ Category: 'Internal', Label: 'Internal Transfer', Reason: 'Internal transfer' }), false);
        assert.equal(isRefundTransaction({ Category: 'Expense', Reason: 'Groceries' }), false);
    });

    test('pairs exact refund with original purchase on the same credit card', async () => {
        const db = await createTestDb();
        const userId = 'user-1';

        // 1. Insert original Walmart purchase
        const pRes = await db.run(`
            INSERT INTO transactions (userId, Amount, AmountMinor, Category, Label, Reason, Timestamp, Account, BankName, BalanceAccountId)
            VALUES (?, 44.72, 4472, 'Expense', 'Shopping', 'WALMART.CA', '2026-09-20T14:00:00.000Z', '************2379', 'RBC Royal Bank', 9)
        `, [userId]);
        const purchaseId = pRes.lastID;

        // 2. Insert Walmart refund
        const rRes = await db.run(`
            INSERT INTO transactions (userId, Amount, AmountMinor, Category, Label, Reason, Timestamp, Account, BankName, BalanceAccountId, AccountFlow)
            VALUES (?, 44.72, 4472, 'Income', 'Refunds & Reversals', 'WALMART.CA', '2026-09-20T16:00:00.000Z', '************2379', 'RBC Royal Bank', 9, 'IN')
        `, [userId]);
        const refundId = rRes.lastID;

        const refundTx = await db.get('SELECT * FROM transactions WHERE id = ?', [refundId]);
        const result = await pairRefundTransaction(db, userId, refundTx);

        assert.equal(result.status, 'paired');
        assert.equal(result.purchaseId, purchaseId);
        assert.equal(result.refundId, refundId);
        assert.equal(result.matchType, 'EXACT_AMOUNT');
        assert.equal(result.confidence, 'HIGH');

        // Check reference stored in refund_pairings
        const pairing = await getRefundPairingForTransaction(db, userId, refundId);
        assert.ok(pairing);
        assert.equal(pairing.purchaseTransactionId, purchaseId);
        assert.equal(pairing.amountMinor, 4472);
        assert.equal(pairing.purchaseReason, 'WALMART.CA');
    });

    test('pairs Amazon purchase with differently named refund alert (AMZN Mktp vs AMAZON.COM PMTS)', async () => {
        const db = await createTestDb();
        const userId = 'user-1';

        const pRes = await db.run(`
            INSERT INTO transactions (userId, Amount, AmountMinor, Category, Label, Reason, Timestamp, Account, BankName, BalanceAccountId)
            VALUES (?, 30.50, 3050, 'Expense', 'Shopping', 'AMZN Mktp CA', '2026-09-23T20:04:27.000Z', '************2379', 'RBC Royal Bank', 9)
        `, [userId]);
        const purchaseId = pRes.lastID;

        const rRes = await db.run(`
            INSERT INTO transactions (userId, Amount, AmountMinor, Category, Label, Reason, Timestamp, Account, BankName, BalanceAccountId, AccountFlow)
            VALUES (?, 30.50, 3050, 'Income', 'Refunds & Reversals', 'AMAZON.COM PMTS - CA', '2026-09-23T20:10:54.000Z', '************2379', 'RBC Royal Bank', 9, 'IN')
        `, [userId]);
        const refundId = rRes.lastID;

        const refundTx = await db.get('SELECT * FROM transactions WHERE id = ?', [refundId]);
        const result = await pairRefundTransaction(db, userId, refundTx);

        assert.equal(result.status, 'paired');
        assert.equal(result.purchaseId, purchaseId);
        assert.equal(result.refundId, refundId);
    });

    test('prevents double-refunding a purchase beyond its amount', async () => {
        const db = await createTestDb();
        const userId = 'user-1';

        // Original purchase for $30.50
        const pRes = await db.run(`
            INSERT INTO transactions (userId, Amount, AmountMinor, Category, Label, Reason, Timestamp, Account, BankName, BalanceAccountId)
            VALUES (?, 30.50, 3050, 'Expense', 'Shopping', 'AMZN Mktp CA', '2026-09-23T20:00:00.000Z', '************2379', 'RBC Royal Bank', 9)
        `, [userId]);
        const purchaseId = pRes.lastID;

        // First refund for $30.50
        const r1Res = await db.run(`
            INSERT INTO transactions (userId, Amount, AmountMinor, Category, Label, Reason, Timestamp, Account, BankName, BalanceAccountId, AccountFlow)
            VALUES (?, 30.50, 3050, 'Income', 'Refunds & Reversals', 'AMAZON.COM PMTS - CA', '2026-09-23T20:10:00.000Z', '************2379', 'RBC Royal Bank', 9, 'IN')
        `, [userId]);
        const refund1Id = r1Res.lastID;

        // Second refund for $30.50 (e.g. separate transaction)
        const r2Res = await db.run(`
            INSERT INTO transactions (userId, Amount, AmountMinor, Category, Label, Reason, Timestamp, Account, BankName, BalanceAccountId, AccountFlow)
            VALUES (?, 30.50, 3050, 'Income', 'Refunds & Reversals', 'AMAZON.COM PMTS - CA', '2026-09-26T18:00:00.000Z', '************2379', 'RBC Royal Bank', 9, 'IN')
        `, [userId]);
        const refund2Id = r2Res.lastID;

        // Pair first refund -> should succeed
        const res1 = await pairRefundTransaction(db, userId, await db.get('SELECT * FROM transactions WHERE id = ?', [refund1Id]));
        assert.equal(res1.status, 'paired');
        assert.equal(res1.purchaseId, purchaseId);

        // Pair second refund -> should NOT double-pair with the already fully refunded purchase
        const res2 = await pairRefundTransaction(db, userId, await db.get('SELECT * FROM transactions WHERE id = ?', [refund2Id]));
        assert.equal(res2.status, 'unmatched');
    });

    test('reconcileRefundPairings scans and pairs multiple historical refunds in batch', async () => {
        const db = await createTestDb();
        const userId = 'user-1';

        // Insert 2 purchases
        await db.run(`
            INSERT INTO transactions (id, userId, Amount, AmountMinor, Category, Label, Reason, Timestamp, Account, BankName, BalanceAccountId)
            VALUES (101, ?, 10.00, 1000, 'Expense', 'Shopping', 'TEMU', '2026-02-20T10:00:00.000Z', '************2379', 'RBC Royal Bank', 9),
                   (102, ?, 16.95, 1695, 'Expense', 'Financial Charges', 'SERVICE CHARGE', '2026-08-31T10:00:00.000Z', '8237', 'CIBC', 7)
        `, [userId, userId]);

        // Insert 2 matching refunds
        await db.run(`
            INSERT INTO transactions (id, userId, Amount, AmountMinor, Category, Label, Reason, Timestamp, Account, BankName, BalanceAccountId, AccountFlow)
            VALUES (201, ?, 10.00, 1000, 'Income', 'Refunds & Reversals', 'Refund or credit - Temu', '2026-02-21T10:00:00.000Z', '************2379', 'RBC Royal Bank', 9, 'IN'),
                   (202, ?, 16.95, 1695, 'Income', 'Refunds & Reversals', 'SERVICE CHARGE DISCOUNT', '2026-08-31T12:00:00.000Z', '8237', 'CIBC', 7, 'IN')
        `, [userId, userId]);

        const summary = await reconcileRefundPairings(db, userId);
        assert.equal(summary.scannedCount, 2);
        assert.equal(summary.pairedCount, 2);

        const pair1 = await getRefundPairingForTransaction(db, userId, 201);
        assert.equal(pair1.purchaseTransactionId, 101);

        const pair2 = await getRefundPairingForTransaction(db, userId, 202);
        assert.equal(pair2.purchaseTransactionId, 102);
    });

    test('pairTransactionOnIngestion automatically pairs when an expense arrives after its refund', async () => {
        const db = await createTestDb();
        const userId = 'user-1';

        // 1. A refund arrives first (e.g. fast credit alert)
        const rRes = await db.run(`
            INSERT INTO transactions (userId, Amount, AmountMinor, Category, Label, Reason, Timestamp, Account, BankName, BalanceAccountId, AccountFlow)
            VALUES (?, 2.00, 200, 'Income', 'Refunds & Reversals', 'GOOGLE *SERVICES', '2026-09-23T13:00:52.000Z', '************2379', 'RBC Royal Bank', 9, 'IN')
        `, [userId]);
        const refundId = rRes.lastID;

        // 2. An expense arrives 3 seconds later (hold email processed after credit alert)
        const pRes = await db.run(`
            INSERT INTO transactions (userId, Amount, AmountMinor, Category, Label, Reason, Timestamp, Account, BankName, BalanceAccountId)
            VALUES (?, 2.00, 200, 'Expense', 'Digital Services', 'GOOGLE *TEMPORARY HOLD', '2026-09-23T13:00:55.000Z', '************2379', 'RBC Royal Bank', 9)
        `, [userId]);
        const purchaseId = pRes.lastID;

        const purchaseTx = await db.get('SELECT * FROM transactions WHERE id = ?', [purchaseId]);
        const pairResult = await pairTransactionOnIngestion(db, userId, purchaseTx);

        assert.ok(pairResult);
        assert.equal(pairResult.status, 'paired');
        assert.equal(pairResult.purchaseId, purchaseId);
        assert.equal(pairResult.refundId, refundId);
    });
});
