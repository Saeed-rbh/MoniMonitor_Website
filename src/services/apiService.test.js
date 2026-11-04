import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GetDataFromDB } from './apiService';
beforeEach(()=>{vi.stubGlobal('localStorage',{getItem:()=> 'test-token'});});
afterEach(()=>vi.unstubAllGlobals());
test('HTTP failures reject instead of returning an empty list', async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:503}));
 await expect(GetDataFromDB()).rejects.toThrow(/refresh financial data/);
});
test('network and malformed responses reject; a real empty list succeeds',async()=>{
 const fetch=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ok:true,json:async()=>({})}).mockResolvedValueOnce({ok:true,json:async()=>[]}); vi.stubGlobal('fetch',fetch);
 await expect(GetDataFromDB()).rejects.toThrow('offline');
 await expect(GetDataFromDB()).rejects.toThrow(/invalid transaction data/);
 await expect(GetDataFromDB()).resolves.toEqual([]);
});
