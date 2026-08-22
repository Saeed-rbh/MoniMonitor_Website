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
 * Reclassify safe provider/imported transfer pairs that can arrive at different
 * times. This is intentionally rerunnable: Plaid's depository feed often lands
 * before its investment feed.
 *
 * Only the explicit pattern is considered: a "Transfer out" expense and a
 * same-day, same-amount TFSA "Transfer in" on different accounts.
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

    const alreadyApplied = Boolean(await db.get('SELECT id FROM app_migrations WHERE id = ?', [migrationId]));

    await db.run('BEGIN IMMEDIATE');
    try {
        // A provider refresh must not undo an already-linked transfer. Older
        // builds allowed Plaid Investments to reset the destination leg to
        // Investment/Transfer in while leaving the shared XFER reference.
        const linkedGroups = await db.all(
            `SELECT ReferenceNumber,
                    MAX(CASE WHEN Reason LIKE 'Internal transfer:%' THEN Reason END) AS sharedReason
             FROM transactions
             WHERE userId = ? AND ReferenceNumber LIKE 'XFER-HIST-%'
             GROUP BY ReferenceNumber
             HAVING sharedReason IS NOT NULL`,
            [userId]
        );
        const restored = [];
        for (const group of linkedGroups) {
            const result = await db.run(
                `UPDATE transactions
                 SET Category = 'Internal', Label = 'Internal Transfer', Reason = ?
                 WHERE userId = ? AND ReferenceNumber = ?
                   AND (Category != 'Internal' OR Label != 'Internal Transfer' OR Reason != ?)`,
                [group.sharedReason, userId, group.ReferenceNumber, group.sharedReason]
            );
            if (result.changes) restored.push({ reference: group.ReferenceNumber, legs: result.changes });
        }

        const [outgoing, incoming] = await Promise.all([
            db.all(
                `SELECT * FROM transactions
                 WHERE userId = ? AND AccountFlow = 'OUT' AND AmountMinor > 0
                   AND (
                       (Category = 'Expense' AND Label = 'Personal Transfers' AND Reason = 'Transfer out')
                       OR
                       (Category = 'Internal' AND Label = 'Internal Transfer'
                        AND ReferenceNumber LIKE 'XFER-PENDING-%')
                   )`,
                [userId]
            ),
            db.all(
                `SELECT * FROM transactions
                 WHERE userId = ? AND Category = 'Investment'
                   AND Reason = 'Transfer in' AND AmountMinor > 0
                   AND (ReferenceNumber IS NULL OR ReferenceNumber NOT LIKE 'XFER-HIST-%')
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
        const details = {
            matched: changes.length,
            restored: restored.reduce((total, group) => total + group.legs, 0),
            skipped: outgoing.length - changes.length,
        };
        if (!alreadyApplied) {
            await db.run(
                `INSERT INTO app_migrations (id, userId, appliedAt, details) VALUES (?, ?, ?, ?)`,
                [migrationId, userId, appliedAt, JSON.stringify(details)]
            );
        }
        if (details.matched || details.restored) {
            await db.run(
                `INSERT INTO agent_audit_log (userId, action, status, details, createdAt)
                 VALUES (?, 'historical_transfer_reconciliation', 'success', ?, ?)`,
                [userId, JSON.stringify({ ...details, changes, restored }), appliedAt]
            );
        }
        await db.run('COMMIT');
        return { ...details, alreadyApplied };
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

module.exports = { reconcileHistoricalInternalTransfers };

