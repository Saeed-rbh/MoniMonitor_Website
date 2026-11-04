import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const REFRESH_INTERVAL_MS = 60_000;

// Keep successful data through outages, but never expose a different user's cache.
export function useRemoteData(load, owner = true) {
  const [state, setState] = useState({ owner, data: null, error: null, lastUpdated: null, refreshing: false });
  const refreshRef = useRef(() => {});
  useEffect(() => {
    let active = true;
    let running = false;
    const refresh = async () => {
      if (!owner || running) return;
      running = true;
      setState(current => current.owner === owner ? { ...current, refreshing: true } : { owner, data: null, error: null, lastUpdated: null, refreshing: true });
      try {
        const data = await load();
        if (active) setState({ owner, data, error: null, lastUpdated: new Date(), refreshing: false });
      } catch (error) {
        if (active) setState(current => ({ ...current, error, refreshing: false }));
      } finally { running = false; }
    };
    refreshRef.current = refresh;
    refresh();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, REFRESH_INTERVAL_MS);
    const visible = () => { if (document.visibilityState !== 'hidden') refresh(); };
    window.addEventListener('online', refresh);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load, owner]);
  const refresh = useCallback(() => refreshRef.current(), []);
  const visibleState = state.owner === owner && owner ? state : { data: null, error: null, lastUpdated: null, refreshing: false };
  return useMemo(() => ({ ...visibleState, isLoading: Boolean(owner) && !visibleState.data && !visibleState.error, refresh }), [visibleState, owner, refresh]);
}
