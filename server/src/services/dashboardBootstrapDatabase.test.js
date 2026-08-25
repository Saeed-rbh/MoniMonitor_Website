const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-dashboard-bootstrap-'));
process.env.MONIMONITOR_DB_PATH = path.join(testDirectory, 'test.sqlite');
process.env.USER_ID = '';

const dbService = require('../database/dbService');

test.after(async () => {
    const db = await dbService.getDb();
    await db.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('returns compact monthly totals and only the requested month transactions', async () => {
    const userId = 'dashboard-bootstrap-user';
    const db = await dbService.getDb();
    await db.run(
        'INSERT INTO users (id, username, password, createdAt) VALUES (?, ?, ?, ?)',
        [userId, 'dashboard-bootstrap', 'not-used', new Date().toISOString()]
    );

    await dbService.addTransaction({
        userId, Amount: 2000, AmountMinor: 200000, Category: 'Income', Label: 'Deposit',
        Reason: 'Pay', Timestamp: '2026-08-05T12:00:00.000Z', Account: 'Chequing',
    });
    await dbService.addTransaction({
        userId, Amount: 125, AmountMinor: 12500, Category: 'Expense', Label: 'Groceries',
        Reason: 'Store', Timestamp: '2026-08-06T12:00:00.000Z', Account: 'Credit Card',
    });
    await dbService.addTransaction({
        userId, Amount: 50, AmountMinor: 5000, Category: 'Expense', Label: 'Dining',
        Reason: 'Cafe', Timestamp: '2026-07-06T12:00:00.000Z', Account: 'Credit Card',
    });

    const payload = await dbService.getDashboardBootstrapForUser(userId, '2026-08');

    assert.equal(payload.currentMonth, '2026-08');
    assert.equal(payload.transactions.length, 2);
    assert.ok(payload.transactions.every((transaction) => transaction.Timestamp.startsWith('2026-08')));
    assert.deepEqual(
        payload.byMonth.map(({ month, count }) => ({ month, count })),
        [{ month: '2026-08', count: 2 }, { month: '2026-07', count: 1 }]
    );
    assert.ok(JSON.stringify(payload).length < 5000);
});
