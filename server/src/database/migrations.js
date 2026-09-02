const MIGRATIONS = [
    {
        version: 1,
        name: 'phase2_single_tenant_and_retention',
        async up(db) {
            await db.exec(`
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    appliedAt TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_transaction_sources_email_retention
                    ON transaction_sources(provider, capturedAt);
            `);
        },
    },
];

async function runMigrations(db) {
    await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        appliedAt TEXT NOT NULL
    )`);
    const applied = new Set((await db.all('SELECT version FROM schema_migrations')).map((row) => Number(row.version)));
    for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        await db.run('BEGIN IMMEDIATE');
        try {
            await migration.up(db);
            await db.run(
                'INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)',
                [migration.version, migration.name, new Date().toISOString()]
            );
            await db.run('COMMIT');
        } catch (error) {
            await db.run('ROLLBACK').catch(() => {});
            throw error;
        }
    }
}

module.exports = { MIGRATIONS, runMigrations };
