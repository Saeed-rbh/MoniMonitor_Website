const { toMinorUnits } = require('./financialSemantics.cjs');

const columns = ['id', 'Amount', 'AmountMinor', 'Currency', 'Category', 'Label', 'Reason', 'Timestamp',
    'Type', 'Account', 'BankName', 'ReferenceNumber', 'Frequency', 'AccountFlow', 'PortfolioAction',
    'PortfolioSymbol', 'PortfolioQuantity', 'PortfolioPrice', 'PortfolioAccountId', 'PortfolioConfidence'];

// Quoting protects CSV structure; an apostrophe additionally makes formula-like
// text inert when opened in spreadsheet software. Numeric amounts stay numeric.
function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function buildTransactionCsv(transactions) {
    const rows = transactions.map(transaction => {
        const minor = transaction.AmountMinor ?? toMinorUnits(transaction.Amount);
        if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('Cannot export an invalid transaction amount');
        const cents = BigInt(minor);
        const normalized = { ...transaction, Currency: transaction.Currency || 'CAD', AmountMinor: minor,
            Amount: `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}` };
        return columns.map(column => csvCell(normalized[column])).join(',');
    });
    return '\uFEFF' + [columns.join(','), ...rows].join('\r\n');
}

module.exports = { buildTransactionCsv, csvCell };
