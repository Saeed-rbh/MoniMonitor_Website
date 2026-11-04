import React from 'react';
export default function DataStatus({ error, lastUpdated, refreshing, refresh }) {
  if (!error) return null;
  return <div role="alert" style={{ padding: '12px', color: 'var(--Ac-1)', background: 'var(--Ec-4)', border: '1px solid var(--Gc-2)', borderRadius: '8px' }}>
    <p style={{ margin: '0 0 8px' }}>{lastUpdated ? `Could not refresh. Showing data last updated ${lastUpdated.toLocaleString()}.` : 'Financial data could not be loaded. Please retry.'}</p>
    <button type="button" disabled={refreshing} onClick={refresh} style={{ minHeight: '44px', padding: '8px 16px' }}>{refreshing ? 'Retrying…' : 'Retry'}</button>
  </div>;
}
