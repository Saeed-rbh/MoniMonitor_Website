const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { protectConnection } = require('../database/transactionConnection');

const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};

async function database(t) {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    protectConnection(db);
    await db.exec('CREATE TABLE probe (operation TEXT)');
    t.after(() => db.close());
    return db;
}

test('rollback cannot discard or commit another concurrent transaction', async (t) => {
    const db = await database(t);
    const entered = deferred();
    const release = deferred();
    const a = db.withTransaction(async () => {
        await db.run("INSERT INTO probe VALUES ('A')");
        entered.resolve();
        await release.promise;
        throw new Error('A failed');
    });
    const rejection = assert.rejects(a, /A failed/);
    await entered.promise;
    const b = db.withTransaction(async () => db.run("INSERT INTO probe VALUES ('B')"));
    release.resolve();
    await Promise.all([rejection, b]);
    assert.deepEqual(await db.all('SELECT * FROM probe'), [{ operation: 'B' }]);
});

test('standalone writes and reads cannot enter or observe an active transaction', async (t) => {
    const db = await database(t);
    const entered = deferred();
    const release = deferred();
    const a = db.withTransaction(async () => {
        await db.run("INSERT INTO probe VALUES ('A')");
        entered.resolve();
        await release.promise;
        throw new Error('rollback');
    });
    const rejection = assert.rejects(a, /rollback/);
    await entered.promise;
    const read = db.all('SELECT * FROM probe');
    const write = db.run("INSERT INTO probe VALUES ('standalone')");
    release.resolve();
    await rejection;
    assert.deepEqual(await read, []);
    await write;
    assert.deepEqual(await db.all('SELECT * FROM probe'), [{ operation: 'standalone' }]);
});

test('nested rollback preserves its parent and sibling transactions', async (t) => {
    const db = await database(t);
    await db.withTransaction(async () => {
        await db.run("INSERT INTO probe VALUES ('parent')");
        await Promise.all([
            assert.rejects(db.withTransaction(async () => {
                await db.run("INSERT INTO probe VALUES ('failed child')");
                throw new Error('child failed');
            }), /child failed/),
            db.withTransaction(async () => {
                await db.withTransaction(async () => db.run("INSERT INTO probe VALUES ('grandchild')"));
            }),
        ]);
    });
    assert.deepEqual(await db.all('SELECT * FROM probe'), [
        { operation: 'parent' }, { operation: 'grandchild' },
    ]);
});

test('outer rollback also rolls back a successful nested transaction', async (t) => {
    const db = await database(t);
    await assert.rejects(db.withTransaction(async () => {
        await db.withTransaction(async () => db.run("INSERT INTO probe VALUES ('child')"));
        throw new Error('outer failed');
    }), /outer failed/);
    assert.deepEqual(await db.all('SELECT * FROM probe'), []);
});

test('raw transaction controls fail explicitly instead of being suppressed', async (t) => {
    const db = await database(t);
    for (const sql of ['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK', 'SAVEPOINT bypass']) {
        await assert.rejects(db.run(sql), /Use db.withTransaction/);
        await assert.rejects(db.exec(sql), /Use db.withTransaction/);
    }
});

test('detached work cannot reuse an ended transaction scope', async (t) => {
    const db = await database(t);
    const release = deferred();
    let detached;
    await db.withTransaction(async () => {
        detached = release.promise.then(() => db.run("INSERT INTO probe VALUES ('late')"));
    });
    const rejection = assert.rejects(detached, /scope has already ended/);
    release.resolve();
    await rejection;
    assert.deepEqual(await db.all('SELECT * FROM probe'), []);
});
