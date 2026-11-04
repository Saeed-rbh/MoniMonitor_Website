import { expect, test, vi } from 'vitest';
import { isInternalTransfer } from '../utils/transactionReporting';
import { fetchAllTransactionData } from './transactionService';
import { GetDataFromDB } from './apiService';
vi.mock('./apiService', () => ({ GetDataFromDB: vi.fn() }));
const tx = (id, Amount, Category, extra = {}) => ({id, Amount, Category, Timestamp:'2026-10-02T12:00:00Z', Label:'Test', ...extra});
test('internal transfers remain in history but do not change any monthly total or distribution', async () => {
 const rows = [tx(1,100,'Income'),tx(2,20,'Expense'),tx(3,10,'Saving'),tx(4,500,'Saving',{PortfolioAction:'TRANSFER'}),tx(5,600,'Expense',{TransferFromAccountId:1,TransferToAccountId:2})];
 GetDataFromDB.mockResolvedValue(rows);
 const {totalTransactions} = await fetchAllTransactionData();
 const month = totalTransactions['2026-10'];
 expect(month.transactions).toHaveLength(5);
 expect(month.totalIncome).toBe(100); expect(month.totalExpense).toBe(20);
 expect(month.totalSaving).toBe(10); expect(month.netTotal).toBe(70);
 expect(month.labelDistribution.Saving).toBeCloseTo(7.69);
});
test('a transfer-only month has zero cash flow and finite distribution percentages', async () => {
 GetDataFromDB.mockResolvedValue([tx(1,500,'Saving',{PortfolioAction:'TRANSFER'})]);
 const {totalTransactions} = await fetchAllTransactionData();
 expect(totalTransactions['2026-10'].netTotal).toBe(0);
 expect(totalTransactions['2026-10'].labelDistribution).toEqual({Income:0,Expense:0,Saving:0});
});
test('external transfers still count and unresolved explicit internal transfers do not', () => {
 expect(isInternalTransfer(tx(1,10,'Income',{Type:'Transfer',Label:'e-Transfer'}))).toBeFalsy();
 expect(isInternalTransfer(tx(2,10,'Saving',{PortfolioAction:'TRANSFER'}))).toBeTruthy();
});

test('monthly totals, net series and category distributions are partitioned by currency', async () => {
 GetDataFromDB.mockResolvedValue([
  tx(1,100,'Income',{Currency:'CAD'}),tx(2,20,'Expense',{Currency:'CAD'}),
  tx(3,100,'Income',{Currency:'USD'}),tx(4,50,'Expense',{Currency:'USD'}),
 ]);
 const data=await fetchAllTransactionData();
 expect(data.currencies).toEqual(['CAD','USD']);
 expect(data.totalTransactions['2026-10'].totalIncome).toBe(100);
 expect(data.byCurrency.CAD.totalTransactions['2026-10'].netTotal).toBe(80);
 expect(data.byCurrency.USD.totalTransactions['2026-10'].netTotal).toBe(50);
 expect(data.byCurrency.CAD.totalTransactions['2026-10'].transactions.every(tx=>tx.Currency==='CAD')).toBe(true);
 expect(data.byCurrency.USD.totalTransactions['2026-10'].labelDistribution.Expense).toBeCloseTo(33.33);
});

test('trades stay in history while savings, income, expense and net totals exclude their gross amounts',async()=>{
 GetDataFromDB.mockResolvedValue([
  tx(1,100,'Income',{Currency:'CAD'}),tx(2,20,'Expense',{Currency:'CAD'}),
  tx(3,10,'Saving',{Currency:'CAD',PortfolioAction:'CONTRIBUTION'}),
  tx(4,10,'Saving',{Currency:'CAD',PortfolioAction:'BUY'}),
  tx(5,15,'Income',{Currency:'CAD',PortfolioAction:'SELL',Type:'Credit'}),
  tx(6,10,'Expense',{Currency:'CAD',PortfolioPostingKind:'EMAIL_BUY',Type:'Debit'}),
 ]);
 const data=await fetchAllTransactionData();const month=data.totalTransactions['2026-10'];
 expect(month.transactions).toHaveLength(6);expect(month.totalSaving).toBe(10);expect(month.totalIncome).toBe(100);expect(month.totalExpense).toBe(20);expect(month.netTotal).toBe(70);
 expect(month.labelDistributionSaving).toEqual({Test:100});
});
test('a month containing only security trades has zero reporting totals',async()=>{
 GetDataFromDB.mockResolvedValue([tx(1,10,'Saving',{PortfolioAction:'BUY'}),tx(2,15,'Saving',{PortfolioAction:'SELL'})]);
 const {totalTransactions}=await fetchAllTransactionData();
 expect(totalTransactions['2026-10'].totalSaving).toBe(0);expect(totalTransactions['2026-10'].netTotal).toBe(0);
});
