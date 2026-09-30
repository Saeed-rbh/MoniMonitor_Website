// Profile metadata and logout preferences are optional. Embedded browsers can
// deny storage; authentication must still work through cookies or memory.
export const sessionMetadata = {
    getItem(key) { try { return window.localStorage?.getItem(key) ?? null; } catch { return null; } },
    setItem(key, value) { try { window.localStorage?.setItem(key, value); } catch {} },
    removeItem(key) { try { window.localStorage?.removeItem(key); } catch {} },
};
export function clearLegacyTokens() {
    sessionMetadata.removeItem('token');
    try { window.sessionStorage?.removeItem('token'); } catch {}
}
