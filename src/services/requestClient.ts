let memoryToken: string | null = null;
export const setMemoryToken = (token: string | null) => { memoryToken = token; };
export class RequestError extends Error {
    constructor(message: string, public code: 'timeout' | 'cancelled' | 'network', public requestId: string) { super(message); }
}
export async function apiFetch(url: string, options: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    const { timeoutMs = 15_000, signal, ...init } = options;
    const controller = new AbortController();
    const headers = new Headers(init.headers);
    const requestId = crypto.randomUUID();
    headers.set('X-Request-Id', requestId);
    const telegram = (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
    headers.set('X-Session-Mode', telegram?.WebApp?.initData ? 'memory' : 'cookie');
    if (memoryToken) headers.set('Authorization', `Bearer ${memoryToken}`);
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new Error('deadline')), timeoutMs);
    try {
        const response = await globalThis.fetch(url, { ...init, headers, credentials: 'include', signal: controller.signal });
        // Consume the body under the same deadline, so headers alone cannot satisfy it.
        const result = typeof response.arrayBuffer === 'function' && response.status !== 204
            ? new Response(await response.arrayBuffer(), { status: response.status, statusText: response.statusText, headers: response.headers }) : response;
        if (response.status === 401 && !/\/(session|login|telegram-auth)(?:\?|$)/.test(url)) {
            memoryToken = null; window.dispatchEvent(new Event('monimonitor-session-expired'));
        }
        return result;
    } catch (error) {
        const code = signal?.aborted ? 'cancelled' : controller.signal.aborted ? 'timeout' : 'network';
        throw new RequestError(code === 'timeout' ? 'Request timed out' : code === 'cancelled' ? 'Request cancelled' : 'Unable to reach the server', code, requestId);
    } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    }
}
