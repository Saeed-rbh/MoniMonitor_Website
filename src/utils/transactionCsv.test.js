import { expect, test } from 'vitest';
import csv from '../../shared/transactionCsv.cjs';

test('exports stored cents exactly, native currency and account provenance', () => {
    const text = csv.buildTransactionCsv([{ id: 7, Amount: 999, AmountMinor: 105, Currency: 'USD',
        Category: 'Expense', Account: 'Card', ReferenceNumber: '000012', AccountFlow: 'OUT',
        PortfolioAction: 'BUY', PortfolioSymbol: 'XEQT', PortfolioQuantity: 1.25 }]);
    expect(text).toContain('Amount,AmountMinor,Currency');
    expect(text).toContain('"7","1.05","105","USD"');
    expect(text).toContain('"000012"');
    expect(text).toContain('"OUT","BUY","XEQT","1.25"');
    expect(text.startsWith('\uFEFF')).toBe(true);
});

test('text cannot create formulas or break CSV structure', () => {
    for (const input of ['=HYPERLINK("https://example.com")', '+1', '-1', '@SUM(A1)', ' \t=1', '\ttext', '\rtext', '\ntext']) {
        expect(csv.csvCell(input)).toBe(`"'${input.replace(/"/g, '""')}"`);
    }
    expect(csv.csvCell('Shop, "café"\nsecond line')).toBe('"Shop, ""café""\nsecond line"');
    expect(csv.csvCell('ordinary merchant')).toBe('"ordinary merchant"');
});

test('maximum safe cents export without floating-point rounding', () => {
    expect(csv.buildTransactionCsv([{ AmountMinor: Number.MAX_SAFE_INTEGER }])).toContain('"90071992547409.91","9007199254740991","CAD"');
    expect(csv.buildTransactionCsv([{ Amount: 1.005 }])).toContain('"1.01","101","CAD"');
    for (const AmountMinor of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => csv.buildTransactionCsv([{ AmountMinor }])).toThrow('invalid transaction amount');
    }
});
