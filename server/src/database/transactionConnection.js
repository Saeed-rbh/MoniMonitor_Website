const { AsyncLocalStorage } = require('node:async_hooks');

const connections = new WeakMap();
const transactionControl = /^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

// SQLite isolates connections, not concurrent callers sharing one connection.
// Queue all external statements behind the complete transaction, including reads.
function protectConnection(db) {
    if (connections.has(db)) return connections.get(db);
    const scope = new AsyncLocalStorage();
    const raw = Object.fromEntries(['run', 'exec', 'get', 'all', 'close']
        .map((method) => [method, db[method].bind(db)]));
    let queue = Promise.resolve();
    let savepointId = 0;
    const enqueue = (operation) => {
        const result = queue.then(operation);
        queue = result.catch(() => {});
        return result;
    };

    for (const method of Object.keys(raw)) {
        db[method] = (...args) => {
            if (method !== 'close' && transactionControl.test(String(args[0]))) {
                return Promise.reject(new Error('Use db.withTransaction() for transaction control'));
            }
            const context = scope.getStore();
            if (context) {
                if (!context.active) return Promise.reject(new Error('Transaction scope has already ended'));
                return raw[method](...args);
            }
            return enqueue(() => raw[method](...args));
        };
    }

    async function withTransaction(fn) {
        if (typeof fn !== 'function') throw new TypeError('withTransaction requires a callback function');
        const parent = scope.getStore();
        if (parent) {
            if (!parent.active) throw new Error('Transaction scope has already ended');
            const operation = parent.nestedQueue.then(async () => {
                if (!parent.active) throw new Error('Transaction scope has already ended');
                const name = `mm_sp_${++savepointId}`;
                const child = { active: true, nestedQueue: Promise.resolve() };
                await raw.run(`SAVEPOINT ${name}`);
                try {
                    const result = await scope.run(child, () => fn(db));
                    await child.nestedQueue;
                    child.active = false;
                    await raw.run(`RELEASE ${name}`);
                    return result;
                } catch (error) {
                    child.active = false;
                    await child.nestedQueue;
                    await raw.run(`ROLLBACK TO ${name}`);
                    await raw.run(`RELEASE ${name}`);
                    throw error;
                }
            });
            parent.nestedQueue = operation.catch(() => {});
            return operation;
        }
        return enqueue(async () => {
            const context = { active: true, nestedQueue: Promise.resolve() };
            await raw.run('BEGIN IMMEDIATE');
            try {
                const result = await scope.run(context, () => fn(db));
                await context.nestedQueue;
                context.active = false;
                await raw.run('COMMIT');
                return result;
            } catch (error) {
                context.active = false;
                await context.nestedQueue;
                await raw.run('ROLLBACK');
                throw error;
            }
        });
    }
    db.withTransaction = withTransaction;
    const controller = { withTransaction };
    connections.set(db, controller);
    return controller;
}

module.exports = { protectConnection };
