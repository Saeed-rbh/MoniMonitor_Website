const quote = (name) => `"${name.replace(/"/g, '""')}"`;
const oldConstraint = /CHECK\s*\(\s*cashMinor\s*>=\s*0\s*\)/i;

// SQLite's create/copy/drop/rename rebuild preserves the original table name
// in child foreign keys. The caller holds an exclusive schema transaction with
// foreign keys temporarily disabled and verifies all references before commit.
async function migrateSignedBalances(db) {
    const table = await db.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'investment_accounts'");
    if (!oldConstraint.test(table?.sql || '')) return;
    const objects = await db.all(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL
        AND (type = 'view' OR (type IN ('index', 'trigger') AND tbl_name = 'investment_accounts')
            OR (type = 'trigger' AND tbl_name IN (SELECT name FROM sqlite_master WHERE type = 'view')))`);
    const sequence = await db.get("SELECT seq FROM sqlite_sequence WHERE name = 'investment_accounts'");
    const columns = (await db.all('PRAGMA table_info(investment_accounts)')).map((column) => quote(column.name)).join(', ');
    const sql = table.sql.replace(/^CREATE TABLE\s+(?:"investment_accounts"|`investment_accounts`|\[investment_accounts\]|investment_accounts)/i,
        'CREATE TABLE investment_accounts_signed')
        .replace(oldConstraint, "CHECK(typeof(cashMinor) = 'integer' AND cashMinor BETWEEN -9007199254740991 AND 9007199254740991)");
    if (!sql.startsWith('CREATE TABLE investment_accounts_signed')) throw new Error('Unable to rebuild account balance schema');
    // Dropping views also drops their INSTEAD OF triggers; both are saved above.
    for (const object of objects.filter((item) => item.type === 'view')) await db.exec(`DROP VIEW ${quote(object.name)}`);
    await db.exec(sql);
    await db.exec(`INSERT INTO investment_accounts_signed (${columns}) SELECT ${columns} FROM investment_accounts`);
    await db.exec('DROP TABLE investment_accounts');
    await db.exec('ALTER TABLE investment_accounts_signed RENAME TO investment_accounts');
    for (const object of objects.filter((item) => item.type === 'view')) await db.exec(object.sql);
    for (const object of objects.filter((item) => item.type !== 'view')) await db.exec(object.sql);
    if (sequence) await db.run("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'investment_accounts'", [sequence.seq]);
}

module.exports = { migrateSignedBalances };
