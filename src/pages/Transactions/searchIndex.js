import { matchesReportingCategory, isInvestTransaction } from '../../services/transactionService';
import { getTransactionDisplayReason } from '../../utils/transactionDisplay';
import { parseTransactionCalendarDate } from '../../utils/transactionDate';

// Component-scoped index: rebuild when history changes, never cache user data globally.
export function buildSearchIndex(transactions) {
  return transactions.map(transaction => {
    const date = parseTransactionCalendarDate(transaction.Timestamp);
    const day = Number.isNaN(date.getTime()) ? null
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const text = [getTransactionDisplayReason(transaction.Reason, transaction.Label, transaction),
      transaction.Reason, transaction.Label, transaction.Amount, transaction.BankName,
      transaction.Category, transaction.Type, transaction.Timestamp]
      .filter(value => value != null).join(' ').toLocaleLowerCase();
    return { transaction, day, text };
  });
}

export function searchTransactions(index, { query, category, startDate, endDate }) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  for (const { transaction, day, text } of index) {
    if ((startDate || endDate) && (!day || (startDate && day < startDate) || (endDate && day > endDate))) continue;
    if (category !== 'All' && !(category === 'Invest'
      ? isInvestTransaction(transaction) : matchesReportingCategory(transaction, category))) continue;
    if (terms.every(term => text.includes(term))) results.push(transaction);
  }
  return results;
}
