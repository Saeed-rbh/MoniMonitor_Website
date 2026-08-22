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
