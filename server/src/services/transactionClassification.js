function normalizeAccountName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseInternalTransfer(reason) {
    const match = String(reason || '').match(
        /^Internal transfer:\s*(.*?)\s*->\s*(.*?)(?:\s*\[|$)/i
    );
    return match ? { source: match[1], destination: match[2] } : null;
}

function getSavingEffectMinor(transaction) {
    const amountMinor = Number(transaction?.AmountMinor || 0);
    if (!Number.isFinite(amountMinor)) return 0;

    if (transaction?.Category === 'SavingWithdrawal') return -amountMinor;
    if (!['Saving', 'Save&Invest'].includes(transaction?.Category)) return 0;

    const label = String(transaction?.Label || '').toLowerCase();
    if (label === 'tfsa withdrawal') return -amountMinor;
    if (label === 'tfsa contribution') return amountMinor;

    const transfer = parseInternalTransfer(transaction?.Reason);
    if (!transfer) return 0;

    const account = normalizeAccountName(transaction?.Account);
    if (!account.includes('tfsa')) return 0;

    const source = normalizeAccountName(transfer.source);
    const destination = normalizeAccountName(transfer.destination);
    if (destination.includes('tfsa')) return amountMinor;
    if (source.includes('tfsa')) return -amountMinor;
    return 0;
}

module.exports = { getSavingEffectMinor, parseInternalTransfer };
