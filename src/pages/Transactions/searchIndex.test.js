import { describe, expect, it, vi } from 'vitest';
import { buildSearchIndex, searchTransactions } from './searchIndex';
import { getTransactionDisplayReason } from '../../utils/transactionDisplay';
vi.mock('../../utils/transactionDisplay', async original => ({
  ...await original(), getTransactionDisplayReason: vi.fn((reason) => reason),
}));
const filters = { query: '', category: 'All', startDate: '', endDate: '' };
const rows = [
  { id: 1, Reason: 'Coffee [special]', Label: 'Dining', Amount: 12.34, Category: 'Expense', BankName: 'Example', Timestamp: '2026-10-31T23:30:00-07:00' },
  { id: 2, Reason: 'Salary', Amount: 500, Category: 'Income', Timestamp: '2026-11-01' },
  { id: 3, Reason: 'Unknown day', Category: 'Expense', Timestamp: 'invalid' },
];
describe('transaction search index', () => {
  it('matches multiple literal terms and inclusive bank-calendar boundaries', () => {
    const index = buildSearchIndex(rows);
    expect(searchTransactions(index, { ...filters, query: 'EXAMPLE [special] 12.34', startDate: '2026-10-31', endDate: '2026-10-31' })).toEqual([rows[0]]);
    expect(searchTransactions(index, { ...filters, category: 'Income' })).toEqual([rows[1]]);
    expect(searchTransactions(index, { ...filters, startDate: '2026-11-01' })).toEqual([rows[1]]);
    expect(searchTransactions(index, filters)).toEqual(rows);
  });
  it('reuses prepared text across queries and rebuilds it for edited history', () => {
    getTransactionDisplayReason.mockClear();
    const index = buildSearchIndex(rows);
    for (const query of ['coffee', 'dining', 'salary', 'example']) searchTransactions(index, { ...filters, query });
    expect(getTransactionDisplayReason).toHaveBeenCalledTimes(rows.length);
    const edited = { ...rows[0], Reason: 'Hardware', Label: 'Shopping' };
    const nextIndex = buildSearchIndex([edited, ...rows.slice(1)]);
    expect(searchTransactions(nextIndex, { ...filters, query: 'coffee' })).toEqual([]);
    expect(searchTransactions(nextIndex, { ...filters, query: 'hardware shopping' })).toEqual([edited]);
  });
});
