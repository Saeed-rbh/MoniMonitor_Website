const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-email-'));
process.env.MONIMONITOR_DB_PATH = path.join(directory, 'test.sqlite');
process.env.USER_ID = 'email-test';
process.env.AI_INGESTION_ENABLED = 'false';
const ai = require('./aiService');
let extraction;
ai.parseEmailWithGemini = async () => ({ ...extraction });
const service = require('../database/dbService');
const { onNewEmail } = require('../../email_agent');
const { ImapService } = require('./imapService');
let db;
test.before(async () => {
    db = await service.getDb();
    await service.createUser('email-test', 'email-test', 'unused');
    await service.createInvestmentAccount('email-test', {
        name: 'Test Checking', institution: 'Test', accountType: 'Chequing', currency: 'USD', cashMinor: 10000,
    });
    await db.run("UPDATE investment_accounts SET accountRef = '12345678'");
});
test.after(async () => { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
async function ingest(key, changes = {}) {
    extraction = { Amount: 10, Category: 'Expense', Label: 'Food', Reason: 'Cafe',
        Timestamp: '2026-11-01T12:00:00Z', Currency: 'USD', Account: '12345678', BankName: 'Test',
        Type: 'Debit', ...changes };
    await db.run(`INSERT OR IGNORE INTO email_ingestion (sourceKey, body, receivedAt, updatedAt)
        VALUES (?, 'email', '2026-11-01', '2026-11-01')`, [key]);
    return onNewEmail('email', key, '2026-11-01T12:00:00Z');
}
test('source replay and concurrent delivery produce a single transaction and balance effect', async () => {
    assert.deepEqual(await Promise.all([ingest('one'), ingest('one')]), [true, true]);
    assert.equal((await db.get('SELECT COUNT(*) n FROM transactions')).n, 1);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts')).cashMinor, 9000);
    assert.equal((await db.get('SELECT COUNT(*) n FROM email_notifications')).n, 1);
});
test('identical legitimate purchases remain separate; stable references deduplicate', async () => {
    await ingest('two');
    assert.equal((await db.get('SELECT COUNT(*) n FROM transactions')).n, 2);
    await ingest('three', { ReferenceNumber: 'ref-1' });
    await ingest('four', { ReferenceNumber: 'ref-1' });
    assert.equal((await db.get('SELECT COUNT(*) n FROM transactions')).n, 3);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts')).cashMinor, 7000);
});
test('a posting failure rolls back transaction, source completion and notification; retry succeeds', async () => {
    const original = service.syncTransactionAccountBalance;
    service.syncTransactionAccountBalance = async () => { throw new Error('simulated crash'); };
    try { assert.equal(await ingest('crash'), false); }
    finally { service.syncTransactionAccountBalance = original; }
    assert.equal((await db.get('SELECT COUNT(*) n FROM transactions')).n, 3);
    assert.equal((await db.get("SELECT status FROM email_ingestion WHERE sourceKey = 'crash'")).status, 'pending');
    assert.equal(await ingest('crash'), true);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts')).cashMinor, 6000);
});
test('unknown account is recorded for review rather than posting to a bank-only match', async () => {
    await ingest('unknown', { Account: 'unknown' });
    assert.equal((await db.get("SELECT status FROM email_ingestion WHERE sourceKey = 'unknown'")).status, 'review_required');
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts')).cashMinor, 6000);
});
test('an existing reference transaction with a missed posting is repaired on delivery', async () => {
    await service.addTransaction({ userId: 'email-test', Amount: 2, Currency: 'USD', Category: 'Expense',
        Label: 'Food', Reason: 'Cafe', Timestamp: '2026-11-01T12:00:00Z', Account: '12345678',
        BankName: 'Test', ReferenceNumber: 'legacy-gap' });
    const before = (await db.get('SELECT COUNT(*) n FROM transactions')).n;
    await ingest('legacy-retry', { Amount: 2, ReferenceNumber: 'legacy-gap' });
    assert.equal((await db.get('SELECT COUNT(*) n FROM transactions')).n, before);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts')).cashMinor, 5800);
});
test('currency mismatch cannot post into the matching account', async () => {
    await ingest('cad', { Currency: 'CAD' });
    assert.equal((await db.get("SELECT status FROM email_ingestion WHERE sourceKey = 'cad'")).status, 'review_required');
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts')).cashMinor, 5800);
});
test('discovery uses UIDs and includes read messages; journal replay does not fetch them again', async () => {
    const imap = Object.create(ImapService.prototype);
    imap.host = 'test'; imap.user = 'test';
    let fetches = 0;
    imap.client = {
        mailbox: { uidValidity: 42 },
        search: async (query, options) => { assert.deepEqual(query, { all: true }); assert.equal(options.uid, true); return [1]; },
        fetchOne: async (uid, fields, options) => {
            assert.equal(options.uid, true); fetches++;
            return { source: Buffer.from('Subject: Alert\r\n\r\nBody'), internalDate: new Date() };
        },
    };
    imap.onNewEmail = async () => true;
    await imap.processUnseenBatch();
    await imap.processUnseenBatch();
    assert.equal(fetches, 1);
    imap.client.mailbox.uidValidity = 43;
    await imap.processUnseenBatch();
    assert.equal(fetches, 2);
});


test('internal transfer posts both cash legs once, including complementary bank alerts', async () => {
    const destination = await service.createInvestmentAccount('email-test', {
        name: 'Savings', institution: 'Test', accountType: 'Savings', currency: 'USD', cashMinor: 0,
    });
    const input = { Amount: 5, Category: 'Saving', Label: 'Savings', PortfolioAction: 'TRANSFER',
        TransferFromAccountId: 1, TransferToAccountId: destination.id, TransferConfidence: 'HIGH',
        ReferenceNumber: 'transfer-1' };
    const before = (await db.get('SELECT cashMinor FROM investment_accounts WHERE id = 1')).cashMinor;
    await ingest('transfer-source', input);
    await ingest('transfer-destination', { ...input, Account: 'destination' });
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = 1')).cashMinor, before - 500);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [destination.id])).cashMinor, 500);
    assert.equal((await db.get("SELECT COUNT(*) n FROM portfolio_transactions WHERE kind = 'EMAIL_TRANSFER'")).n, 1);
    assert.equal((await db.get("SELECT COUNT(*) n FROM transactions WHERE ReferenceNumber = 'transfer-1'")).n, 1);
});
test('incomplete internal transfer cannot change either account', async () => {
    const before = (await db.get('SELECT SUM(cashMinor) n FROM investment_accounts')).n;
    await ingest('transfer-incomplete', { Category: 'Saving', Label: 'Savings', PortfolioAction: 'TRANSFER',
        TransferFromAccountId: 1, TransferConfidence: 'HIGH' });
    assert.equal((await db.get('SELECT SUM(cashMinor) n FROM investment_accounts')).n, before);
    assert.equal((await db.get("SELECT status FROM email_ingestion WHERE sourceKey = 'transfer-incomplete'")).status, 'review_required');
});
test('investment buy and sell update cash and fractional holdings once; insufficient cash needs review', async () => {
    const account = await service.createInvestmentAccount('email-test', {
        name: 'Brokerage', institution: 'Broker', accountType: 'Brokerage', currency: 'USD', cashMinor: 1000,
    });
    const buy = { Amount: 5, Category: 'Saving', Label: 'Investment', Account: 'broker', BankName: 'Broker',
        PortfolioAccountId: account.id, PortfolioConfidence: 'HIGH', PortfolioAction: 'BUY',
        PortfolioSymbol: 'ABC', PortfolioQuantity: 0.5, PortfolioPrice: 10 };
    await ingest('buy', buy);
    await ingest('buy', buy);
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 500);
    assert.equal((await db.get('SELECT quantity FROM investment_holdings WHERE accountId = ?', [account.id])).quantity, 0.5);
    await ingest('sell', { ...buy, Amount: 2.5, PortfolioAction: 'SELL', PortfolioQuantity: 0.25 });
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 750);
    assert.equal((await db.get('SELECT quantity FROM investment_holdings WHERE accountId = ?', [account.id])).quantity, 0.25);
    await ingest('buy-too-large', { ...buy, Amount: 20, PortfolioQuantity: 2 });
    assert.equal((await db.get("SELECT status FROM email_ingestion WHERE sourceKey = 'buy-too-large'")).status, 'review_required');
    assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id = ?', [account.id])).cashMinor, 750);
});

test('complementary deposit and Interac alerts share one financial effect; repeated notices require review', async () => {
 await db.run("UPDATE investment_accounts SET institution='RBC Royal Bank' WHERE id=1");
 const existingCash=(await db.get('SELECT cashMinor FROM investment_accounts WHERE id=1')).cashMinor;
 const body1='From: "RBC" <rbcroyalbankalerts@alerts.rbc.com>\nSubject: Deposit Notice\nAccount: 12345678';
 const body2='From: "Interac" <notify@payments.interac.ca>\nSubject: Interac e-Transfer: deposited';
 async function deliver(key,body,time,reference) {
  extraction={Amount:'3',Currency:'USD',Category:'Income',Label:'Bank Deposit',Reason:'Deposit',Account:'12345678',BankName:'RBC Royal Bank',Timestamp:time,ReferenceNumber:reference};
  await db.run('INSERT INTO email_ingestion (sourceKey,body,receivedAt,updatedAt) VALUES (?,?,?,?)',[key,body,time,time]);
  assert.equal(await onNewEmail(body,key,time),true);
 }
 await deliver('notice',body1,'2026-11-01T15:00:00Z',null);
 await deliver('interac',body2,'2026-11-01T15:02:00Z','confirmed-3');
 const first=await db.get("SELECT transactionId FROM email_ingestion WHERE sourceKey='notice'");
 assert.equal((await db.get("SELECT transactionId FROM email_ingestion WHERE sourceKey='interac'")).transactionId,first.transactionId);
 assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=1')).cashMinor,existingCash+300);
 await deliver('ambiguous-notice',body1,'2026-11-01T16:00:00Z',null);
 assert.equal((await db.get("SELECT status FROM email_ingestion WHERE sourceKey='ambiguous-notice'")).status,'review_required');
 assert.equal((await db.get('SELECT cashMinor FROM investment_accounts WHERE id=1')).cashMinor,existingCash+300);
});

test('email transactions post immediately even when extraction says pending', async () => {
    const before = await service.getDb().then(db => db.get('SELECT cashMinor FROM investment_accounts WHERE id = 1'));
    await ingest('email-post-immediately', { Amount: 1, PostingStatus: 'pending', ReferenceNumber: 'post-now' });
    const tx = await db.get("SELECT * FROM transactions WHERE ReferenceNumber = 'post-now'");
    assert.equal(tx.PostingStatus, 'posted');
    const after = await db.get('SELECT cashMinor FROM investment_accounts WHERE id = 1');
    assert.equal(after.cashMinor, before.cashMinor - 100);
    assert.equal((await db.get("SELECT status FROM email_ingestion WHERE sourceKey = 'email-post-immediately'")).status, 'applied');
});
