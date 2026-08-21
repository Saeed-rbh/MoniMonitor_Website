const MIGRATION_PREFIX = 'historical-internal-transfer-reconciliation-v1';

const normalizeAccountKey = (bankName, account) => {
    const bank = String(bankName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const digits = String(account || '').replace(/\D/g, '');
    const identity = digits.length >= 4
        ? `last4:${digits.slice(-4)}`
        : String(account || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${bank}|${identity}`;
};

const dateKey = (value) => String(value || '').slice(0, 10);

/**
 * Reclassify safe historical transfer pairs that predate the email pipeline.
 * Only the explicit imported pattern is considered: a "Transfer out" expense
 * and a same-day, same-amount TFSA "Transfer in" on different accounts.
 */
async function reconcileHistoricalInternalTransfers(db, userId) {
    if (!db || !userId) return { matched: 0, skipped: 0, alreadyApplied: false };

    const migrationId = `${MIGRATION_PREFIX}:${userId}`;
    await db.exec(`
        CREATE TABLE IF NOT EXISTS app_migrations (
            id TEXT PRIMARY KEY,
            userId TEXT NOT NULL,
            appliedAt TEXT NOT NULL,
            details TEXT
        )
    `);

    if (await db.get('SELECT id FROM app_migrations WHERE id = ?', [migrationId])) {
        return { matched: 0, skipped: 0, alreadyApplied: true };
    }

    await db.run('BEGIN IMMEDIATE');
    try {
        const [outgoing, incoming] = await Promise.all([
            db.all(
                `SELECT * FROM transactions
                 WHERE userId = ? AND Category = 'Expense'
                   AND Label = 'Personal Transfers' AND Reason = 'Transfer out'
                   AND AccountFlow = 'OUT' AND AmountMinor > 0`,
                [userId]
            ),
            db.all(
                `SELECT * FROM transactions
                 WHERE userId = ? AND Category = 'Investment'
                   AND Reason = 'Transfer in' AND AmountMinor > 0
                   AND (PortfolioAction = 'TRANSFER' OR LOWER(Type) = 'tfsa')`,
                [userId]
            ),
        ]);

        const group = (rows) => rows.reduce((result, row) => {
            const key = [dateKey(row.Timestamp), row.AmountMinor, row.Currency || 'CAD'].join('|');
            (result[key] ||= []).push(row);
            return result;
        }, {});

        const outgoingByKey = group(outgoing);
        const incomingByKey = group(incoming);
        const changes = [];

        for (const [key, outs] of Object.entries(outgoingByKey)) {
            const ins = incomingByKey[key] || [];
            if (!ins.length || outs.length !== ins.length) continue;

            const outgoingAccounts = new Set(outs.map((row) => normalizeAccountKey(row.BankName, row.Account)));
            const incomingAccounts = new Set(ins.map((row) => normalizeAccountKey(row.BankName, row.Account)));
            if (outgoingAccounts.size !== 1 || incomingAccounts.size !== 1) continue;
            const [outgoingAccount] = outgoingAccounts;
            const [incomingAccount] = incomingAccounts;
            if (!outgoingAccount || outgoingAccount === incomingAccount) continue;

            const sortedOuts = [...outs].sort((a, b) => a.id - b.id);
            const sortedIns = [...ins].sort((a, b) => a.id - b.id);
            for (let index = 0; index < sortedOuts.length; index += 1) {
                const out = sortedOuts[index];
                const incomingLeg = sortedIns[index];
                const reference = `XFER-HIST-${dateKey(out.Timestamp).replace(/-/g, '')}-${out.AmountMinor}-${out.id}-${incomingLeg.id}`;
                const reason = `Internal transfer: ${out.Account || out.BankName || 'Source'} -> ${incomingLeg.Account || incomingLeg.BankName || 'TFSA'} [${reference}]`;

                await db.run(
                    `UPDATE transactions
                     SET Category = 'Internal', Label = 'Internal Transfer', Reason = ?, ReferenceNumber = ?
                     WHERE id IN (?, ?) AND userId = ?`,
                    [reason, reference, out.id, incomingLeg.id, userId]
                );
                changes.push({ outgoingId: out.id, incomingId: incomingLeg.id, amountMinor: out.AmountMinor, reference });
            }
        }

        const appliedAt = new Date().toISOString();
        const details = { matched: changes.length, skipped: outgoing.length - changes.length };
        await db.run(
            `INSERT INTO app_migrations (id, userId, appliedAt, details) VALUES (?, ?, ?, ?)`,
            [migrationId, userId, appliedAt, JSON.stringify(details)]
        );
        await db.run(
            `INSERT INTO agent_audit_log (userId, action, status, details, createdAt)
             VALUES (?, 'historical_transfer_reconciliation', 'success', ?, ?)`,
            [userId, JSON.stringify({ ...details, changes }), appliedAt]
        );
        await db.run('COMMIT');
        return { ...details, alreadyApplied: false };
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

module.exports = { reconcileHistoricalInternalTransfers };

