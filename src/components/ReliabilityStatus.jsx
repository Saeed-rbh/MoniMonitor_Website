import React, { useEffect, useState } from 'react';
import { getReliabilityAPI } from '../services/apiService';

export default function ReliabilityStatus() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => getReliabilityAPI().then(value => { if (active) { setReport(value); setError(false); } }).catch(() => { if (active) setError(true); });
    load(); const timer = setInterval(load, 60000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <section aria-label="Reliability" style={{ width: '100%', marginBottom: '1rem' }}>
    <h2 style={{ fontSize: '1rem' }}>Reliability</h2>
    <p role="status">{error ? 'Checks unavailable. Monitoring will retry.' : report ? `${report.status} · Checked ${new Date(report.checkedAt).toLocaleString()}` : 'Checking financial evidence…'}</p>
    {report && <>
      <p>Email entries remain provisional until bank evidence or a reviewed correction is recorded. Automatic checks cover the last {report.coverageDays} days.</p>
      {report.issues.length > 0 && <ul>{report.issues.map(issue => <li key={issue.key}>{issue.transactionId ? `Transaction ${issue.transactionId}: ` : ''}{issue.action}</li>)}</ul>}
      <details><summary>Account reconciliation coverage</summary><ul>{report.accounts.map(account => <li key={account.accountId}>Account {account.accountId}: {account.status}</li>)}</ul><p>Exact reconciliation requires opening and closing bank statements with matching cutoffs.</p></details>
    </>}
  </section>;
}
