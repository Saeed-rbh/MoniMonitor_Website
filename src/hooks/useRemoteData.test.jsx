import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useRemoteData, REFRESH_INTERVAL_MS } from './useRemoteData';
afterEach(() => { cleanup(); vi.useRealTimers(); });
const settle = () => act(async () => { await Promise.resolve(); });
test('failed refresh preserves data and timestamp; retry recovers', async () => {
 const load=vi.fn().mockResolvedValueOnce({balance:100}).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({balance:120});
 const {result}=renderHook(()=>useRemoteData(load,'user'));
 await settle(); const timestamp=result.current.lastUpdated;
 await act(async()=>{ await result.current.refresh(); });
 expect(result.current.data.balance).toBe(100); expect(result.current.lastUpdated).toBe(timestamp); expect(result.current.error).toBeTruthy();
 await act(async()=>{ await result.current.refresh(); });
 expect(result.current.data.balance).toBe(120); expect(result.current.error).toBeNull();
});
test('initial failure is distinguishable from a successful empty result', async () => {
 const load=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
 const {result}=renderHook(()=>useRemoteData(load)); await settle();
 expect(result.current.data).toBeNull(); expect(result.current.error).toBeTruthy(); expect(result.current.isLoading).toBe(false);
 await act(async()=>{await result.current.refresh();}); expect(result.current.data).toEqual([]); expect(result.current.error).toBeNull();
});
test('polls, refreshes on reconnect and cleans up listeners', async () => {
 vi.useFakeTimers(); const load=vi.fn().mockResolvedValue([]);
 const {unmount}=renderHook(()=>useRemoteData(load)); await settle();
 await act(async()=>{vi.advanceTimersByTime(REFRESH_INTERVAL_MS);}); expect(load).toHaveBeenCalledTimes(2);
 await act(async()=>{window.dispatchEvent(new Event('online'));}); expect(load).toHaveBeenCalledTimes(3);
 unmount(); await act(async()=>{vi.advanceTimersByTime(REFRESH_INTERVAL_MS); window.dispatchEvent(new Event('online'));}); expect(load).toHaveBeenCalledTimes(3);
});
test('deduplicates overlapping requests and ignores old user responses', async () => {
 let resolve; const load=vi.fn().mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({balance:200});
 const {result,rerender}=renderHook(({owner})=>useRemoteData(load,owner),{initialProps:{owner:'one'}});
 await act(async()=>{await result.current.refresh();}); expect(load).toHaveBeenCalledTimes(1);
 rerender({owner:'two'}); await settle(); expect(result.current.data.balance).toBe(200);
 await act(async()=>{resolve({balance:100});}); expect(result.current.data.balance).toBe(200);
});
