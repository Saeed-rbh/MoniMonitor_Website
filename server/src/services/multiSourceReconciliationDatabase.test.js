const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-multi-source-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
process.env.USER_ID = '';
const service = require('../database/dbService');
const { findTransactionMatch, mergeTransactionRows } = require('./transactionDeduplication');

test.after(async () => {
    await (await service.getDb()).close();
    fs.rmSync(directory, { recursive: true, force: true });
});

test('keeps one transaction and all email/Plaid payloads in either arrival order', async () => {
    const db = await service.getDb();
    for (const firstProvider of ['email', 'plaid']) {
        const userId = `arrival-${firstProvider}`;
        await service.createUser(userId, userId, 'unused');
        const row = { userId, Amount: 45, Currency: 'CAD', Category: 'Expense', Label: 'Shopping',
            Reason: 'Example Department Store', Account: '1234', BankName: 'RBC', AccountFlow: 'OUT',
            ReferenceNumber: 'ABC123456', Timestamp: '2026-09-20T12:00:00Z',
            SourceEmailKey: firstProvider === 'email' ? `${userId}:mail1` : null };
        const id = await service.addTransaction(row);
        await service.upsertTransactionSource({ userId, transactionId: id, provider: firstProvider,
            externalId: `${userId}:first`, rawPayload: { first: true } });
        const incoming = { ...row, Timestamp: '2026-09-21T12:00:00Z',
            SourceEmailKey: firstProvider === 'plaid' ? `${userId}:mail1` : null };
        const secondProvider = firstProvider === 'email' ? 'plaid' : 'email';
        const match = await findTransactionMatch(db, userId, incoming, { incomingProvider: secondProvider });
        assert.equal(match.id, id);
        await service.upsertTransactionSource({ userId, transactionId: id, provider: secondProvider,
            externalId: `${userId}:second`, rawPayload: { second: true } });
        await service.upsertTransactionSource({ userId, transactionId: id, provider: 'email',
            externalId: `${userId}:mail2`, rawPayload: { third: true } });
        assert.equal((await service.getTransactionBySourceEmailKey(userId, `${userId}:mail2`)).id, id);
        assert.equal((await db.get('SELECT COUNT(*) AS n FROM transactions WHERE userId = ?', [userId])).n, 1);
        assert.equal((await service.getTransactionSourcesForUser(id, userId)).length, 3);
    }
});

test('reconciles delayed transfer legs and exposes the sources of both accounts', async () => {
    const db = await service.getDb();
    const userId = 'transfer-sources';
    await service.createUser(userId, userId, 'unused');
    const accounts = [];
    for (const ref of ['1234', '5678']) {
        const result = await db.run(`INSERT INTO investment_accounts
            (userId, name, institution, accountType, accountRef, currency, cashMinor, createdAt, updatedAt)
            VALUES (?, ?, 'RBC', 'Chequing', ?, 'CAD', 100000, '2026-09-20', '2026-09-20')`, [userId, ref, ref]);
        accounts.push(result.lastID);
    }
    const ids = [];
    for (const [index, flow] of ['OUT', 'IN'].entries()) {
        const id = await service.addTransaction({ userId, Amount: 50, Currency: 'CAD',
            Category: flow === 'IN' ? 'Income' : 'Expense', Label: 'Personal Transfers',
            Reason: 'Funds transfer', AccountFlow: flow, Account: index ? '5678' : '1234', BankName: 'RBC',
            BalanceAccountId: accounts[index], Timestamp: `2026-09-${20 + index}T12:00:00Z` });
        ids.push(id);
        await service.upsertTransactionSource({ userId, transactionId: id, provider: 'plaid',
            externalId: `leg:${index}`, rawPayload: { account: index } });
        await service.reconcileIngestedTransaction(userId, id);
    }
    const legs = await db.all('SELECT * FROM transactions WHERE userId = ?', [userId]);
    assert.equal(legs.length, 2);
    assert.ok(legs.every(row => row.Category === 'Internal'));
    assert.equal(legs[0].ReferenceNumber, legs[1].ReferenceNumber);
    const sources = await service.getTransactionSourcesForUser(ids[0], userId);
    assert.equal(sources.length, 2);
    assert.deepEqual(new Set(sources.map(row => row.accountFlow)), new Set(['IN', 'OUT']));
});

test('pairs a refund ingested before the purchase and preserves pairing when merging copies', async () => {
    const db = await service.getDb();
    const userId = 'refund-sources';
    await service.createUser(userId, userId, 'unused');
    const row = { userId, Amount: 25, Currency: 'CAD', Reason: 'Walmart', Account: '1234', BankName: 'RBC',
        Timestamp: '2026-09-20T12:00:00Z' };
    const refundId = await service.addTransaction({ ...row, Category: 'Income', Label: 'Refunds & Reversals', AccountFlow: 'IN' });
    await service.reconcileIngestedTransaction(userId, refundId);
    const purchaseId = await service.addTransaction({ ...row, Category: 'Expense', Label: 'Shopping', AccountFlow: 'OUT' });
    await service.reconcileIngestedTransaction(userId, purchaseId);
    const duplicateId = await service.addTransaction({ ...row, Category: 'Expense', Label: 'Shopping', AccountFlow: 'OUT' });
    await db.withTransaction(async () => mergeTransactionRows(db,
        await service.getTransactionById(duplicateId, userId), await service.getTransactionById(purchaseId, userId)));
    const pairing = await db.get('SELECT * FROM refund_pairings WHERE refundTransactionId = ?', [refundId]);
    assert.equal(pairing.purchaseTransactionId, duplicateId);
});
