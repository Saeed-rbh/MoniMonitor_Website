const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-deposit-protocol-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
process.env.USER_ID = '';
const service = require('../database/dbService');
const { mergeTransactionRows } = require('./transactionDeduplication');
const { findInvestmentFallbackMatch } = require('./plaidService');
test.after(async () => { await (await service.getDb()).close(); fs.rmSync(directory, { recursive: true, force: true }); });

async function fixture(userId) {
    await service.createUser(userId, userId, 'unused');
    return service.createInvestmentAccount(userId, { name: 'RBC Chequing', institution: 'RBC',
        accountType: 'Chequing', accountRef: '6554', currency: 'CAD', cashMinor: 10000 });
}
function notice(userId, account, key, interac = false) {
    return { userId, Amount: 34, AmountMinor: 3400, Currency: 'CAD', Category: 'Income',
        Label: interac ? 'Personal Transfers Received' : 'Cash & Cheque Deposits',
        Reason: interac ? 'E-Transfer - Jane Doe' : 'Deposit to RBC Royal Bank Checking Account ••••6554',
        Type: interac ? 'e-Transfer' : 'Checking Account', ReferenceNumber: interac ? 'C1AaMcwFCnMw' : null,
        Account: '6554', BankName: 'RBC', AccountFlow: 'IN', Timestamp: '2026-09-30T21:35:00Z',
        ReceivedAt: '2026-09-30T21:35:00Z', SourceEmailKey: `${userId}:${key}`,
        BalanceAccountId: account.id, BalanceAccountConfidence: 'HIGH' };
}
async function ingest(row) {
    return service.commitEmailTransaction({ transaction: row, balance: { accountId: row.BalanceAccountId },
        source: { externalId: row.SourceEmailKey, rawPayload: { parsedTransaction: row } } });
}
test('one balance credit and both sources survive either arrival order and retries', async () => {
    const db = await service.getDb();
    for (const first of [false, true]) {
        const userId = `arrival-${first}`, account = await fixture(userId);
        const a = notice(userId, account, '1', first), b = notice(userId, account, '2', !first);
        const id = await ingest(a);
        assert.equal(await ingest(b), id);
        assert.equal(await ingest(b), id);
        assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 13400);
        assert.equal((await service.getTransactionSourcesForUser(id, userId)).length, 2);
        assert.equal((await db.get('SELECT COUNT(*) n FROM transactions WHERE userId = ?', [userId])).n, 1);
    }
});
test('multiple equal deposits hold the incoming confirmation through later reconciliation', async () => {
    const db = await service.getDb(), userId = 'ambiguous-deposits', account = await fixture(userId);
    await ingest(notice(userId, account, '1'));
    await ingest(notice(userId, account, '2'));
    const id = await ingest(notice(userId, account, '3', true));
    assert.equal((await db.get('SELECT reason FROM transaction_ingestion_reviews WHERE transactionId = ?', [id])).reason, 'possible_duplicate');
    assert.equal((await service.syncTransactionAccountBalance(userId, id)).status, 'review_required');
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 16800);
});
test('merging historical deposit copies reverses only the extra manual credit', async () => {
    const db = await service.getDb(), userId = 'historical-deposit', account = await fixture(userId);
    const ids = [];
    for (const interac of [false, true]) {
        const row = notice(userId, account, String(interac), interac);
        const id = await service.addTransaction(row); ids.push(id);
        await service.syncTransactionAccountBalance(userId, id, { accountId: account.id, confidence: 'HIGH' });
    }
    await db.withTransaction(async () => mergeTransactionRows(db,
        await service.getTransactionById(ids[1], userId), await service.getTransactionById(ids[0], userId)));
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 13400);
});
test('investment fallback cannot match BUY to DIVIDEND even on same account, symbol and amount', async () => {
    const userId = 'investment-conflict', account = await fixture(userId);
    const row = { ...notice(userId, account, 'dividend'), Category: 'Investment', PortfolioAction: 'DIVIDEND',
        PortfolioSymbol: 'XEQT', PortfolioAccountId: account.id, PortfolioQuantity: null };
    await service.addTransaction(row);
    assert.equal(await findInvestmentFallbackMatch(userId, { ...row, PortfolioAction: 'BUY', PortfolioQuantity: 0.1334 }), null);
});

test('merging duplicates preserves an authoritative bank balance snapshot', async () => {
    const db = await service.getDb(), userId = 'snapshot-deposit', account = await fixture(userId);
    const ids = [];
    for (const interac of [false, true]) {
        const id = await service.addTransaction(notice(userId, account, String(interac), interac));
        ids.push(id);
        await service.syncTransactionAccountBalance(userId, id, { accountId: account.id, confidence: 'HIGH' });
    }
    await db.run("UPDATE investment_accounts SET cashMinor = 50000, balanceRevision = 2, balanceSource = 'plaid' WHERE id = ?", [account.id]);
    await db.withTransaction(async () => mergeTransactionRows(db,
        await service.getTransactionById(ids[1], userId), await service.getTransactionById(ids[0], userId)));
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 50000);
});

test('monthly repair is scoped and idempotent, retaining both raw deposit emails', async () => {
    const { planRepair, applyPlan } = require('../../scripts/repair-month-duplicates');
    const db = await service.getDb(), userId = 'monthly-repair', account = await fixture(userId);
    const ids = [];
    for (const interac of [false, true]) {
        const row = notice(userId, account, String(interac), interac);
        const id = await service.addTransaction(row); ids.push(id);
        await service.upsertTransactionSource({ userId, transactionId: id, provider: 'email',
            externalId: row.SourceEmailKey, rawPayload: { rawBody: 'saved original email', parsedTransaction: row } });
        await service.syncTransactionAccountBalance(userId, id, { accountId: account.id, confidence: 'HIGH' });
    }
    const outside = await service.addTransaction({ ...notice(userId, account, 'outside'), Timestamp: '2026-08-30T21:35:00Z' });
    await service.enqueueTelegramOutbox('sendMessage', { text: 'deposit notification receipt' }, { transactionId: ids[0] });
    const plan = await planRepair(db, userId, '2026-09');
    assert.equal(plan.merges.length, 1);
    await db.withTransaction(() => applyPlan(db, userId, '2026-09', plan));
    assert.equal((await service.getTransactionSourcesForUser(ids[1], userId)).length, 2);
    assert.equal((await db.get('SELECT transactionId FROM telegram_outbox WHERE transactionId = ?', [ids[1]])).transactionId, ids[1]);
    assert.ok(await service.getTransactionById(outside, userId));
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 13400);
    const second = await planRepair(db, userId, '2026-09');
    assert.equal(second.merges.length, 0);
    assert.equal(second.accountCorrections.length, 0);
    assert.equal(second.timestampCorrections.length, 0);
});

test('a compatible bank confirmation resolves an ambiguous investment account hold', async () => {
    const { confirmInvestmentAccount } = require('./plaidService');
    const db = await service.getDb(), userId = 'bank-confirmation', account = await fixture(userId);
    const row = { ...notice(userId, account, 'trade'), Category: 'Investment', Label: 'ETF & Stock Purchase',
        PortfolioAction: 'BUY', PortfolioSymbol: 'XEQT', PortfolioQuantity: 0.133,
        BalanceAccountId: null, PortfolioAccountId: null, IngestionReviewReason: 'ambiguous_account' };
    const id = await ingest(row);
    await confirmInvestmentAccount(userId, id, { ...row, PortfolioAccountId: account.id,
        BalanceAccountId: account.id, PortfolioQuantity: 0.1334 });
    assert.ok((await db.get('SELECT resolvedAt FROM transaction_ingestion_reviews WHERE transactionId = ?', [id])).resolvedAt);
    assert.equal((await service.getTransactionById(id, userId)).PortfolioAccountId, account.id);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 10000);
});

test('currency discrepancies require exact investment evidence and never match a different action', async () => {
    const { findInvestmentCurrencyConflict } = require('./plaidService');
    const userId = 'currency-discrepancy', account = await fixture(userId);
    const row = { ...notice(userId, account, 'trade'), Category: 'Investment', PortfolioAction: 'BUY',
        PortfolioSymbol: 'VFV', PortfolioQuantity: 0.0519, PortfolioAccountId: account.id };
    const id = await service.addTransaction(row);
    assert.equal((await findInvestmentCurrencyConflict(userId, { ...row, Currency: 'USD' })).id, id);
    assert.equal(await findInvestmentCurrencyConflict(userId, { ...row, Currency: 'USD', PortfolioAction: 'DIVIDEND' }), null);
    assert.equal(await findInvestmentCurrencyConflict(userId, { ...row, Currency: 'USD', PortfolioQuantity: 1 }), null);
});
