import { afterEach, expect, it, vi } from 'vitest';
import { apiFetch, setMemoryToken, RequestError } from './requestClient';
afterEach(() => { setMemoryToken(null); vi.restoreAllMocks(); vi.useRealTimers(); });
it('sends cookies and a request ID without reading a persisted bearer token', async () => {
    const storage = vi.fn(() => { throw new Error('Persisted tokens must never be read'); });
    Object.defineProperty(window, 'localStorage', { configurable: true, get: storage });
    const mocked = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}'));
    expect(await (await apiFetch('/api/session')).json()).toEqual({ ok: true });
    const options = mocked.mock.calls[0][1];
    expect(options.credentials).toBe('include');
    expect(options.headers.has('Authorization')).toBe(false);
    expect(options.headers.get('X-Session-Mode')).toBe('cookie');
    expect(options.headers.get('X-Request-Id')).toMatch(/^[a-f0-9-]{36}$/);
    expect(storage).not.toHaveBeenCalled();
});
it('keeps embedded Telegram bearer credentials only in memory', async () => {
    setMemoryToken('short-lived-memory-token');
    const mocked = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await apiFetch('/api/portfolio');
    expect(mocked.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer short-lived-memory-token');
    expect(window.sessionStorage.getItem('token')).toBeNull();
});
it('enforces a deadline and does not replay a mutation when transport fails', async () => {
    vi.useFakeTimers();
    const mocked = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('abort')));
    }));
    const result = apiFetch('/api/transactions', { method: 'POST', timeoutMs: 25 });
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(30); await assertion;
    expect(mocked).toHaveBeenCalledOnce();
});
it('propagates cancellation distinctly from server unavailability', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('abort')));
    }));
    const result = apiFetch('/api/transactions', { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toBeInstanceOf(RequestError);
    await expect(result).rejects.toMatchObject({ code: 'cancelled' });
});
