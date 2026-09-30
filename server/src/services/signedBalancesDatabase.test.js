const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { protectConnection } = require('../database/transactionConnection');
const { migrateSignedBalances } = require('../database/signedBalanceMigration');
const { portfolioByCurrency } = require('../../../shared/currency.cjs');

async function legacyDatabase(t) {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    protectConnection(db);
    t.after(() => db.close());
    await db.exec(`PRAGMA foreign_keys = ON;
        CREATE TABLE investment_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT,
            cashMinor INTEGER NOT NULL DEFAULT 0 CHECK(cashMinor >= 0));
        CREATE TABLE holdings (id INTEGER PRIMARY KEY, accountId INTEGER REFERENCES investment_accounts(id) ON DELETE CASCADE);
        CREATE TABLE changes (accountId INTEGER);
        CREATE INDEX account_names ON investment_accounts(name);
        CREATE TRIGGER account_change AFTER UPDATE ON investment_accounts BEGIN INSERT INTO changes VALUES (new.id); END;
        CREATE VIEW balances AS SELECT id, cashMinor FROM investment_accounts;
        CREATE TRIGGER balance_edit INSTEAD OF UPDATE ON balances BEGIN
            UPDATE investment_accounts SET cashMinor = new.cashMinor WHERE id = old.id; END;
        INSERT INTO investment_accounts (id, name, cashMinor) VALUES (1, 'Cash', 100), (10, 'Deleted', 0);
        DELETE FROM investment_accounts WHERE id = 10;
        INSERT INTO holdings VALUES (1, 1);`);
    return db;
}

test('signed migration preserves references, schema objects, deleted ID sequence and reruns safely', async (t) => {
    const db = await legacyDatabase(t);
    await db.withSchemaMigration(() => migrateSignedBalances(db));
    assert.deepEqual(await db.all('SELECT * FROM holdings'), [{ id: 1, accountId: 1 }]);
    assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
    assert.equal((await db.get('PRAGMA foreign_keys')).foreign_keys, 1);
    await db.run('UPDATE balances SET cashMinor = -125 WHERE id = 1');
    assert.deepEqual(await db.get('SELECT * FROM balances'), { id: 1, cashMinor: -125 });
    assert.deepEqual(await db.all('SELECT * FROM changes'), [{ accountId: 1 }]);
    assert.ok(await db.get("SELECT name FROM sqlite_master WHERE name = 'account_names'"));
    assert.equal((await db.run("INSERT INTO investment_accounts (name) VALUES ('Next')")).lastID, 11);
    await assert.rejects(db.run('UPDATE investment_accounts SET cashMinor = ? WHERE id = 1', [Number.MAX_SAFE_INTEGER + 1]), /CHECK/);
    await assert.rejects(db.run('UPDATE investment_accounts SET cashMinor = 1.5 WHERE id = 1'), /CHECK/);
    await db.withSchemaMigration(() => migrateSignedBalances(db));
    assert.equal((await db.get('SELECT cashMinor FROM balances WHERE id = 1')).cashMinor, -125);
});

test('schema failure restores original schema, views and foreign-key enforcement', async (t) => {
    const db = await legacyDatabase(t);
    await assert.rejects(db.withSchemaMigration(async () => {
        await migrateSignedBalances(db);
        throw new Error('interrupted migration');
    }), /interrupted migration/);
    assert.equal((await db.get('PRAGMA foreign_keys')).foreign_keys, 1);
    assert.equal((await db.get('SELECT cashMinor FROM balances')).cashMinor, 100);
    await assert.rejects(db.run('UPDATE investment_accounts SET cashMinor = -1'), /CHECK/);
    await assert.rejects(db.run('INSERT INTO holdings VALUES (2, 999)'), /FOREIGN KEY/);
});

test('schema transaction rejects dangling references before committing', async (t) => {
    const db = await legacyDatabase(t);
    await assert.rejects(db.withSchemaMigration(async () => {
        await migrateSignedBalances(db);
        await db.run('INSERT INTO holdings VALUES (2, 999)');
    }), /invalid foreign-key/);
    assert.deepEqual(await db.all('SELECT * FROM holdings'), [{ id: 1, accountId: 1 }]);
    assert.equal((await db.get('PRAGMA foreign_keys')).foreign_keys, 1);
});

test('external writes wait until schema migration restores foreign keys', async (t) => {
    const db = await legacyDatabase(t);
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    const released = new Promise(resolve => { release = resolve; });
    const migration = db.withSchemaMigration(async () => {
        await migrateSignedBalances(db);
        enter();
        await released;
    });
    await entered;
    const rejectedWrite = assert.rejects(db.run('INSERT INTO holdings VALUES (2, 999)'), /FOREIGN KEY/);
    release();
    await Promise.all([migration, rejectedWrite]);
    await assert.rejects(db.withTransaction(() => db.withSchemaMigration(() => {})), /inside another transaction/);
});

test('portfolio separates overdrafts, card overpayments and margin debt by native currency', () => {
    const totals = portfolioByCurrency([
        { accountType: 'Chequing', cashMinor: -1000, currency: 'CAD' },
        { accountType: 'Credit Card', cashMinor: -500, currency: 'CAD' },
        { accountType: 'Credit Card', cashMinor: 2000, currency: 'CAD' },
        { accountType: 'Brokerage', cashMinor: -3000, currency: 'USD', holdings: [
            { currency: 'USD', quantity: 2, priceMinor: 2500, averageCostMinor: 2000 },
        ] },
    ]);
    assert.deepEqual(totals.map(({ currency, totalCashMinor, totalLiabilitiesMinor, totalValueMinor }) =>
        ({ currency, totalCashMinor, totalLiabilitiesMinor, totalValueMinor })), [
        { currency: 'CAD', totalCashMinor: 500, totalLiabilitiesMinor: 3000, totalValueMinor: -2500 },
        { currency: 'USD', totalCashMinor: 0, totalLiabilitiesMinor: 3000, totalValueMinor: 2000 },
    ]);
});
