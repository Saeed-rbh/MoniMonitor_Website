const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-late-transfer-'));
process.env.MONIMONITOR_DB_PATH = path.join(testDirectory, 'test.sqlite');
process.env.USER_ID = 'late-transfer-user';

const dbService = require('../database/dbService');
const { reconcileHistoricalInternalTransfers } = require('../database/historicalTransferReconciliation');

test.before(async () => {
    await dbService.createUser(process.env.USER_ID, 'late-transfer-owner', 'test-password-hash');
});

test.after(async () => {
    const db = await dbService.getDb();
    await db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('pairs a TFSA transfer leg that arrives after the first reconciliation run', async () => {
    const outgoingId = await dbService.addTransaction({
        userId: process.env.USER_ID,
        Amount: 10,
        AmountMinor: 1000,
        Currency: 'CAD',
        Category: 'Expense',
        Label: 'Personal Transfers',
        Reason: 'Transfer out',
        Timestamp: '2026-08-21T12:00:00.000Z',
        Type: 'Chequing',
        Account: '1234',
        BankName: 'Wealthsimple (Canada)',
        AccountFlow: 'OUT',
    });
    const db = await dbService.getDb();
    const first = await reconcileHistoricalInternalTransfers(db, process.env.USER_ID);
    assert.equal(first.matched, 0);

    const incomingId = await dbService.addTransaction({
        userId: process.env.USER_ID,
        Amount: 10,
        AmountMinor: 1000,
        Currency: 'CAD',
        Category: 'Investment',
        Label: 'Asset Distribution',
        Reason: 'Transfer in',
        Timestamp: '2026-08-21T12:00:00.000Z',
        Type: 'tfsa',
        Account: 'S0K7',
        BankName: 'Wealthsimple (Canada)',
        PortfolioAction: 'TRANSFER',
        AccountFlow: 'NONE',
    });

    const second = await reconcileHistoricalInternalTransfers(db, process.env.USER_ID);
    assert.equal(second.matched, 1);
    assert.equal(second.alreadyApplied, true);
    const outgoing = await dbService.getTransactionById(outgoingId, process.env.USER_ID);
    const incoming = await dbService.getTransactionById(incomingId, process.env.USER_ID);
    assert.equal(outgoing.Category, 'Internal');
    assert.equal(incoming.Category, 'Internal');
    assert.equal(outgoing.ReferenceNumber, incoming.ReferenceNumber);

    await db.run(
        `UPDATE transactions SET Category = 'Investment', Label = 'Asset Distribution', Reason = 'Transfer in'
         WHERE id = ?`,
        [incomingId]
    );
    const repaired = await reconcileHistoricalInternalTransfers(db, process.env.USER_ID);
    assert.equal(repaired.restored, 1);
    assert.equal((await dbService.getTransactionById(incomingId, process.env.USER_ID)).Category, 'Internal');
});

test('finalizes a user-confirmed pending transfer when Plaid later sends the TFSA leg', async () => {
    const outgoingId = await dbService.addTransaction({
        userId: process.env.USER_ID,
        Amount: 25,
        AmountMinor: 2500,
        Currency: 'CAD',
        Category: 'Internal',
        Label: 'Internal Transfer',
        Reason: 'Internal transfer: Future -> TFSA (awaiting Plaid)',
        ReferenceNumber: 'XFER-PENDING-20260822-2500-pending',
        Timestamp: '2026-08-22T12:00:00.000Z',
        Type: 'Chequing',
        Account: '1234',
        BankName: 'Wealthsimple (Canada)',
        AccountFlow: 'OUT',
    });
    const incomingId = await dbService.addTransaction({
        userId: process.env.USER_ID,
        Amount: 25,
        AmountMinor: 2500,
        Currency: 'CAD',
        Category: 'Investment',
        Label: 'Asset Distribution',
        Reason: 'Transfer in',
        Timestamp: '2026-08-22T12:00:00.000Z',
        Type: 'tfsa',
        Account: 'S0K7',
        BankName: 'Wealthsimple (Canada)',
        PortfolioAction: 'TRANSFER',
        AccountFlow: 'NONE',
    });

    const db = await dbService.getDb();
    const result = await reconcileHistoricalInternalTransfers(db, process.env.USER_ID);
    assert.equal(result.matched, 1);
    const outgoing = await dbService.getTransactionById(outgoingId, process.env.USER_ID);
    const incoming = await dbService.getTransactionById(incomingId, process.env.USER_ID);
    assert.match(outgoing.ReferenceNumber, /^XFER-HIST-/);
    assert.equal(incoming.ReferenceNumber, outgoing.ReferenceNumber);
    assert.equal(incoming.Category, 'Internal');
});

test('reclassifies owner-named e-transfers and links them to existing account legs', async () => {
    const db = await dbService.getDb();
    const userId = 'self-transfer-user';
    await db.run(
        `INSERT OR IGNORE INTO users (id, username, password, createdAt)
         VALUES (?, ?, ?, ?)`,
        [userId, 'saeedarabha', 'test-password', new Date().toISOString()]
    );
    await db.run(
        `INSERT INTO investment_accounts
            (userId, name, institution, accountType, accountRef, currency, cashMinor, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?), (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
            userId, 'CIBC Chequing', 'CIBC', 'Chequing', '6768237', 'CAD', new Date().toISOString(), new Date().toISOString(),
            userId, 'Future', 'Wealthsimple', 'Savings', '•••• 1234', 'CAD', new Date().toISOString(), new Date().toISOString(),
        ]
    );

    const outgoingId = await dbService.addTransaction({
        userId,
        Amount: 3000,
        AmountMinor: 300000,
        Currency: 'CAD',
        Category: 'Internal',
        Label: 'Internal Transfer',
        Reason: 'Internal transfer: CIBC Chequing -> Future',
        ReferenceNumber: 'XFER-EXISTING-3000',
        Timestamp: '2026-06-29T16:00:00.000Z',
        Account: 'CIBC Chequing',
        BankName: 'CIBC',
        AccountFlow: 'OUT',
    });
    const incomingId = await dbService.addTransaction({
        userId,
        Amount: 3000,
        AmountMinor: 300000,
        Currency: 'CAD',
        Category: 'Internal',
        Label: 'Internal Transfer',
        Reason: 'Internal transfer: CIBC Chequing -> Future',
        ReferenceNumber: 'XFER-EXISTING-3000',
        Timestamp: '2026-06-29T16:00:00.000Z',
        Account: 'Future',
        BankName: 'Wealthsimple',
        AccountFlow: 'IN',
    });
    const selfInId = await dbService.addTransaction({
        userId,
        Amount: 3000,
        AmountMinor: 300000,
        Currency: 'CAD',
        Category: 'Income',
        Label: 'Personal Transfers Received',
        Reason: 'SAEED ARABHA - INTERAC e-Transfer®',
        Timestamp: '2026-06-26T12:00:00.000Z',
        Account: '1234',
        BankName: 'Wealthsimple (Canada)',
        AccountFlow: 'IN',
    });
    const selfOutId = await dbService.addTransaction({
        userId,
        Amount: 3000,
        AmountMinor: 300000,
        Currency: 'CAD',
        Category: 'Expense',
        Label: 'Personal Transfers',
        Reason: 'E-TRANSFER 106010575055 Saeed@wealthsimple',
        Timestamp: '2026-06-29T12:00:00.000Z',
        Account: '8237',
        BankName: 'CIBC',
        AccountFlow: 'OUT',
    });
    const externalId = await dbService.addTransaction({
        userId,
        Amount: 3000,
        AmountMinor: 300000,
        Currency: 'CAD',
        Category: 'Income',
        Label: 'Personal Transfers Received',
        Reason: 'E-Transfer - Jane Doe',
        Timestamp: '2026-06-26T12:00:00.000Z',
        Account: '1234',
        BankName: 'Wealthsimple (Canada)',
        AccountFlow: 'IN',
    });

    const result = await reconcileHistoricalInternalTransfers(db, userId);
    assert.equal(result.selfReclassified, 2);
    assert.equal(result.selfLinked, 2);

    const selfIn = await dbService.getTransactionById(selfInId, userId);
    const selfOut = await dbService.getTransactionById(selfOutId, userId);
    const external = await dbService.getTransactionById(externalId, userId);
    assert.equal(selfIn.Category, 'Internal');
    assert.equal(selfOut.Category, 'Internal');
    assert.equal(selfIn.ReferenceNumber, 'XFER-EXISTING-3000');
    assert.equal(selfOut.ReferenceNumber, 'XFER-EXISTING-3000');
    assert.equal(external.Category, 'Income');
    assert.equal(outgoingId > 0, true);
    assert.equal(incomingId > 0, true);
});

test('collapses exact duplicate TFSA rows before pairing a Transfer out expense', async () => {
    const userId = process.env.USER_ID;
    const db = await dbService.getDb();
    const outgoingId = await dbService.addTransaction({
        userId, Amount: 12, AmountMinor: 1200, Currency: 'CAD',
        Category: 'Expense', Label: 'Personal Transfers', Reason: 'Transfer out',
        Timestamp: '2026-08-30T12:00:00.000Z', Type: 'Chequing', Account: '1234',
        BankName: 'Wealthsimple (Canada)', AccountFlow: 'OUT',
    });
    const incoming = {
        userId, Amount: 12, AmountMinor: 1200, Currency: 'CAD',
        Category: 'Investment', Label: 'Asset Distribution', Reason: 'Transfer in',
        Timestamp: '2026-08-30T12:00:00.000Z', Type: 'tfsa', Account: 'S0K7',
        BankName: 'Wealthsimple (Canada)', PortfolioAction: 'TRANSFER',
        PortfolioAccountId: 10, AccountFlow: 'NONE',
    };
    const firstIncomingId = await dbService.addTransaction(incoming);
    const duplicateIncomingId = await dbService.addTransaction(incoming);

    const result = await reconcileHistoricalInternalTransfers(db, userId);
    assert.equal(result.matched, 1);
    assert.equal((await dbService.getTransactionById(outgoingId, userId)).Category, 'Internal');
    assert.equal((await dbService.getTransactionById(firstIncomingId, userId)).Category, 'Internal');
    assert.equal(await dbService.getTransactionById(duplicateIncomingId, userId), undefined);
});

test('collapses exact duplicate TFSA rows before pairing a Transfer out expense', async () => {
    const userId = process.env.USER_ID;
    const db = await dbService.getDb();
    const outgoingId = await dbService.addTransaction({
        userId, Amount: 12, AmountMinor: 1200, Currency: 'CAD',
        Category: 'Expense', Label: 'Personal Transfers', Reason: 'Transfer out',
        Timestamp: '2026-08-30T12:00:00.000Z', Type: 'Chequing', Account: '1234',
        BankName: 'Wealthsimple (Canada)', AccountFlow: 'OUT',
    });
    const incoming = {
        userId, Amount: 12, AmountMinor: 1200, Currency: 'CAD',
        Category: 'Investment', Label: 'Asset Distribution', Reason: 'Transfer in',
        Timestamp: '2026-08-30T12:00:00.000Z', Type: 'tfsa', Account: 'S0K7',
        BankName: 'Wealthsimple (Canada)', PortfolioAction: 'TRANSFER',
        PortfolioAccountId: 10, AccountFlow: 'NONE',
    };
    const firstIncomingId = await dbService.addTransaction(incoming);
    const duplicateIncomingId = await dbService.addTransaction(incoming);

    const result = await reconcileHistoricalInternalTransfers(db, userId);
    assert.equal(result.matched, 1);
    assert.equal((await dbService.getTransactionById(outgoingId, userId)).Category, 'Internal');
    assert.equal((await dbService.getTransactionById(firstIncomingId, userId)).Category, 'Internal');
    assert.equal(await dbService.getTransactionById(duplicateIncomingId, userId), undefined);
});

test('links an owner-named incoming transfer to its opposite account leg and uses canonical account names', async () => {
    const db = await dbService.getDb();
    const userId = 'recent-self-transfer-user';
    await db.run(
        `INSERT OR IGNORE INTO users (id, username, password, createdAt)
         VALUES (?, ?, ?, ?)`,
        [userId, 'recentowner', 'test-password', new Date().toISOString()]
    );
    await db.run(
        `INSERT INTO investment_accounts
            (userId, name, institution, accountType, accountRef, currency, cashMinor, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?), (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
            userId, 'RBC Chequing', 'RBC', 'Chequing', '03481-5026554', 'CAD', new Date().toISOString(), new Date().toISOString(),
            userId, 'Future', 'Wealthsimple', 'Savings', '•••• 1234', 'CAD', new Date().toISOString(), new Date().toISOString(),
        ]
    );

    const outgoingId = await dbService.addTransaction({
        userId,
        Amount: 4500,
        AmountMinor: 450000,
        Currency: 'CAD',
        Category: 'Internal',
        Label: 'Internal Transfer',
        Reason: 'Internal transfer: ********6554 -> own account',
        ReferenceNumber: 'XFER-SELF-20260826-450000-out',
        Timestamp: '2026-08-26T00:00:00.000Z',
        Account: '********6554',
        BankName: 'RBC Royal Bank',
        AccountFlow: 'OUT',
    });
    const incomingId = await dbService.addTransaction({
        userId,
        Amount: 4500,
        AmountMinor: 450000,
        Currency: 'CAD',
        Category: 'Internal',
        Label: 'Internal Transfer',
        Reason: 'RECENT OWNER - INTERAC e-Transfer®',
        Timestamp: '2026-08-26T12:00:00.000Z',
        Account: '1234',
        BankName: 'Wealthsimple (Canada)',
        AccountFlow: 'IN',
    });

    const result = await reconcileHistoricalInternalTransfers(db, userId);
    assert.equal(result.selfReclassified, 0);
    assert.equal(result.selfLinked, 1);
    assert.deepEqual(new Set(result.affectedTransactionIds), new Set([outgoingId, incomingId]));

    const outgoing = await dbService.getTransactionById(outgoingId, userId);
    const incoming = await dbService.getTransactionById(incomingId, userId);
    assert.equal(incoming.Category, 'Internal');
    assert.equal(outgoing.Reason, 'Internal transfer: RBC Chequing -> Future');
    assert.equal(incoming.Reason, outgoing.Reason);
    assert.equal(incoming.ReferenceNumber, outgoing.ReferenceNumber);
});
