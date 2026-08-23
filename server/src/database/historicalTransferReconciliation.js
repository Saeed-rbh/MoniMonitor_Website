const { isExplicitSelfTransferDescription, normalizeIdentity, getTransactionDirection } = require('../services/selfTransfer');

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

const normalizeBank = (value) => {
    const normalized = normalizeIdentity(value);
    if (normalized.includes('wealthsimple')) return 'wealthsimple';
    if (normalized.includes('royalbank') || normalized.includes('rbc')) return 'rbc';
    if (normalized.includes('cibc')) return 'cibc';
    return normalized;
};

function lastFour(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : null;
}

function buildKnownAccountAliases(rows) {
    return rows.map((row) => ({
        id: `${row.kind}:${row.id}`,
        bank: normalizeBank(row.bank),
        aliases: [row.name, row.accountRef]
            .filter(Boolean)
            .map(normalizeIdentity)
            .filter(Boolean),
        last4: lastFour(row.accountRef),
    }));
}

function resolveAccountIdentity(transaction, knownAccounts) {
    const bank = normalizeBank(transaction?.BankName);
    const account = normalizeIdentity(transaction?.Account);
    const accountLast4 = lastFour(transaction?.Account);

    const known = knownAccounts.find((candidate) => {
        if (candidate.bank && bank && candidate.bank !== bank) return false;
        return candidate.aliases.includes(account) ||
            Boolean(accountLast4 && candidate.last4 && accountLast4 === candidate.last4);
    });
    if (known) return known.id;

    return `${bank}|${account}`;
}

function sameAccount(left, right, knownAccounts) {
    return resolveAccountIdentity(left, knownAccounts) ===
        resolveAccountIdentity(right, knownAccounts);
}

function accountDisplayName(transaction) {
    return transaction?.Account || transaction?.BankName || 'account';
}

async function reconcileExplicitSelfTransfers(db, userId) {
    const user = await db.get('SELECT username FROM users WHERE id = ?', [userId]);
    if (!user?.username) return { reclassified: 0, linked: 0, changes: [] };

    const [transactions, investmentAccounts, accounts] = await Promise.all([
        db.all(
            `SELECT * FROM transactions
             WHERE userId = ? AND Category IN ('Income', 'Expense')
             ORDER BY Timestamp ASC, id ASC`,
            [userId]
        ),
        db.all(
            `SELECT id, name, institution AS bank, accountRef
             FROM investment_accounts WHERE userId = ?`,
            [userId]
        ),
        db.all(
            `SELECT id, Account AS name, BankName AS bank, Account AS accountRef
             FROM accounts WHERE userId = ?`,
            [userId]
        ),
    ]);

    const knownAccounts = buildKnownAccountAliases([
        ...investmentAccounts.map((row) => ({ ...row, kind: 'investment' })),
        ...accounts.map((row) => ({ ...row, kind: 'account' })),
    ]);
    const selfTransfers = transactions.filter((transaction) =>
        isExplicitSelfTransferDescription(transaction.Reason, user.username)
    );
    if (!selfTransfers.length) return { reclassified: 0, linked: 0, changes: [] };

    const matchWindowDays = 7;
    const changes = [];
    let linked = 0;

    for (const selfTransfer of selfTransfers) {
        const direction = getTransactionDirection(selfTransfer);
        const timestamp = new Date(selfTransfer.Timestamp).getTime();
        if (!direction || !Number.isFinite(timestamp)) continue;
        const candidates = await db.all(
            `SELECT * FROM transactions
             WHERE userId = ? AND id != ? AND AmountMinor = ?
               AND Currency = ? AND Category = 'Internal'
               AND Label = 'Internal Transfer'
               AND AccountFlow = ?
               AND Timestamp BETWEEN ? AND ?`,
            [
                userId,
                selfTransfer.id,
                selfTransfer.AmountMinor,
                selfTransfer.Currency || 'CAD',
                direction,
                new Date(timestamp - matchWindowDays * 86400000).toISOString(),
                new Date(timestamp + matchWindowDays * 86400000).toISOString(),
            ]
        );

        const matchingCandidates = candidates
            .filter((candidate) => sameAccount(selfTransfer, candidate, knownAccounts))
            .sort((left, right) => {
                const leftDistance = Math.abs(new Date(left.Timestamp).getTime() - timestamp);
                const rightDistance = Math.abs(new Date(right.Timestamp).getTime() - timestamp);
                return leftDistance - rightDistance || left.id - right.id;
            });
        const match = matchingCandidates[0] || null;
        const reference = match?.ReferenceNumber ||
            `XFER-SELF-${dateKey(selfTransfer.Timestamp).replace(/-/g, '')}-${selfTransfer.AmountMinor}-${selfTransfer.id}`;
        const reason = match?.Reason ||
            `Internal transfer: ${accountDisplayName(selfTransfer)} -> own account`;
        const wasInternal = selfTransfer.Category === 'Internal' &&
            selfTransfer.Label === 'Internal Transfer';

        await db.run(
            `UPDATE transactions
             SET Category = 'Internal', Label = 'Internal Transfer',
                 Reason = ?, ReferenceNumber = ?
             WHERE id = ? AND userId = ?`,
            [reason, reference, selfTransfer.id, userId]
        );

        if (!wasInternal) {
            changes.push({
                id: selfTransfer.id,
                oldCategory: selfTransfer.Category,
                oldLabel: selfTransfer.Label,
                newCategory: 'Internal',
                newLabel: 'Internal Transfer',
                matchedTransactionId: match?.id || null,
                reference,
            });
        }
        if (match) linked += 1;
    }

    return { reclassified: changes.length, linked, changes };
}

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
        const selfTransferSummary = await reconcileExplicitSelfTransfers(db, userId);

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
            selfReclassified: selfTransferSummary.reclassified,
            selfLinked: selfTransferSummary.linked,
        };
        if (!alreadyApplied) {
            await db.run(
                `INSERT INTO app_migrations (id, userId, appliedAt, details) VALUES (?, ?, ?, ?)`,
                [migrationId, userId, appliedAt, JSON.stringify(details)]
            );
        }
        if (details.matched || details.restored || details.selfReclassified) {
            await db.run(
                `INSERT INTO agent_audit_log (userId, action, status, details, createdAt)
                 VALUES (?, 'historical_transfer_reconciliation', 'success', ?, ?)`,
                [userId, JSON.stringify({ ...details, changes, restored, selfChanges: selfTransferSummary.changes }), appliedAt]
            );
        }
        await db.run('COMMIT');
        return { ...details, alreadyApplied };
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

module.exports = { reconcileExplicitSelfTransfers, reconcileHistoricalInternalTransfers };

