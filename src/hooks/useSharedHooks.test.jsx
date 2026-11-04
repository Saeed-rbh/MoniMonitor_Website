import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useTransactionData } from './useSharedHooks';
import { fetchAllTransactionData } from '../services/transactionService';
vi.mock('../services/transactionService', () => ({
 fetchAllTransactionData:vi.fn(),
 getSelectedMonthData:(data,month)=>({transactions:data[month]?.transactions || [],selected:{netTotal:data[month]?.netTotal || 0}}),
}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
test('changing months during an outage keeps cached transactions and error',async()=>{
 const tx={id:1,Amount:100};
 fetchAllTransactionData.mockResolvedValueOnce({totalTransactions:{0:{transactions:[tx],netTotal:100}},Availability:[],netAmounts:{}}).mockRejectedValue(new Error('offline'));
 const {result,rerender}=renderHook(({month})=>useTransactionData(month,'user'),{initialProps:{month:0}});
 await act(async()=>{await Promise.resolve();});
 expect(result.current.transactions).toEqual([tx]);
 await act(async()=>{await result.current.refresh();});
 rerender({month:1}); expect(result.current.error).toBeTruthy();
 rerender({month:0}); expect(result.current.transactions).toEqual([tx]); expect(result.current.selected.netTotal).toBe(100);
});
test('switching reporting currency updates transactions and chart series together',async()=>{
 const cad={totalTransactions:{0:{transactions:[{id:1,Currency:'CAD'}],netTotal:80}},netAmounts:{net:80},Availability:[]};
 const usd={totalTransactions:{0:{transactions:[{id:2,Currency:'USD'}],netTotal:50}},netAmounts:{net:50},Availability:[]};
 fetchAllTransactionData.mockResolvedValue({currency:'CAD',currencies:['CAD','USD'],byCurrency:{CAD:cad,USD:usd}});
 const {result,rerender}=renderHook(({currency})=>useTransactionData(0,'user',currency),{initialProps:{currency:'CAD'}});
 await act(async()=>{await Promise.resolve();});expect(result.current.selected.netTotal).toBe(80);expect(result.current.netAmounts.net).toBe(80);
 rerender({currency:'USD'});expect(result.current.transactions[0].Currency).toBe('USD');expect(result.current.selected.netTotal).toBe(50);expect(result.current.netAmounts.net).toBe(50);
});
