// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import semantics from '../../shared/financialSemantics.cjs';
import csv from '../../shared/transactionCsv.cjs';

const { toMinorUnits, amountMinorOf, isIncome, isExpense, investmentActivityMinor, getSavingEffectMinor } = semantics;
const options = { numRuns: 1000 };
// Keep decimal inputs within a range where a JS number preserves every cent.
const cents = fc.integer({ min: 0, max: 100_000_000_000 });
const row = fc.record({
    AmountMinor: cents,
    Category: fc.constantFrom('Income', 'Expense', 'Investment', 'Saving', 'Dining', ''),
    Type: fc.constantFrom('Credit', 'Debit', 'Income', 'Expense'),
    AccountFlow: fc.constantFrom('IN', 'OUT', 'NONE'),
    PortfolioAction: fc.constantFrom('BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'CONTRIBUTION'),
    PostingStatus: fc.constantFrom('posted', 'pending', 'held'),
});

// Independent reader for the exporter’s always-quoted data records.
function readCsvRecord(record) {
    return record.slice(1, -1).split(/","/).map(cell => cell.replace(/""/g, '"'));
}

describe('financial properties', () => {
    it('round-trips signed integer cents through decimal notation', () => {
        fc.assert(fc.property(cents, fc.boolean(), (minor, negative) => {
            const decimal = `${negative ? '-' : ''}${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
            expect(toMinorUnits(decimal)).toBe(negative && minor ? -minor : minor);
        }), { ...options, examples: [[0, false], [1, true], [100_000_000_000, false]] });
    });

    it('rounds decimal half-cent boundaries away from zero', () => {
        fc.assert(fc.property(cents, fc.integer({ min: 0, max: 9 }), fc.boolean(), (minor, digit, negative) => {
            const decimal = `${negative ? '-' : ''}${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}${digit}`;
            const magnitude = minor + (digit >= 5 ? 1 : 0);
            expect(toMinorUnits(decimal)).toBe(negative && magnitude ? -magnitude : magnitude);
        }), { ...options, examples: [[100, 5, false], [100, 5, true], [0, 4, true], [0, 5, true]] });
    });

    it('uses authoritative cents regardless of stale display amounts', () => {
        fc.assert(fc.property(cents, fc.double(), (minor, stale) => {
            expect(amountMinorOf({ AmountMinor: minor, Amount: stale })).toBe(minor);
        }), options);
    });

    it('never reports internal transfers as income, spending, or investment activity', () => {
        fc.assert(fc.property(row, fc.constantFrom(
            { Category: 'Internal' }, { Category: 'Transfer' },
            { Label: 'Internal transfer' }, { Reason: 'Internal transfer: checking -> savings' },
        ), (transaction, marker) => {
            const transfer = { ...transaction, ...marker, PostingStatus: 'posted' };
            expect(isIncome(transfer)).toBe(false);
            expect(isExpense(transfer)).toBe(false);
            expect(investmentActivityMinor(transfer)).toBe(0);
        }), options);
    });

    it('excludes unposted rows from financial effects', () => {
        fc.assert(fc.property(row, fc.constantFrom('pending', 'held', 'unposted'), (transaction, status) => {
            const unposted = { ...transaction, PostingStatus: status };
            expect(isIncome(unposted)).toBe(false);
            expect(isExpense(unposted)).toBe(false);
            expect(investmentActivityMinor(unposted)).toBe(0);
            expect(getSavingEffectMinor(unposted)).toBe(0);
        }), options);
    });

    it('explicit income and expense categories override contradictory provider direction', () => {
        fc.assert(fc.property(cents, (minor) => {
            const income = { AmountMinor: minor, Category: 'Income', Type: 'Debit', AccountFlow: 'OUT' };
            const expense = { AmountMinor: minor, Category: 'Expense', Type: 'Credit', AccountFlow: 'IN' };
            expect(isIncome(income)).toBe(true);
            expect(isExpense(income)).toBe(false);
            expect(isExpense(expense)).toBe(true);
            expect(isIncome(expense)).toBe(false);
        }), options);
    });

    it('exports exact stored cents even above the decimal-number precision boundary', () => {
        fc.assert(fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (minor) => {
            const output = csv.buildTransactionCsv([{ AmountMinor: minor, Amount: 99.99 }]);
            const cells = readCsvRecord(output.split('\r\n')[1]);
            const [whole, fraction] = cells[1].split('.');
            expect(BigInt(whole) * 100n + BigInt(fraction)).toBe(BigInt(minor));
            expect(cells[2]).toBe(String(minor));
        }), { ...options, examples: [[0], [Number.MAX_SAFE_INTEGER]] });
    });
});
