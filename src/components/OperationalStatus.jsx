import React from 'react';
import { Link } from 'react-router-dom';
import DataStatus from './DataStatus';

const issueText = {
  agent_offline: 'The email agent has stopped reporting. Restart the email agent on its host machine.',
  mail_disconnected: 'The mailbox is disconnected. The agent will reconnect automatically; check mailbox credentials if this persists.',
  scan_error: 'The latest mailbox scan failed. The agent will retry automatically; check the connection error below if it persists.',
  scan_stalled: 'No mailbox scan has completed in the last 3 minutes. Check the agent and email connection.',
  email_backlog: 'Some emails have waited more than 10 minutes. Check the failed jobs below and the agent configuration.',
  notification_backlog: 'Some Telegram notifications have waited more than 10 minutes. Check the bot connection. Financial posting retries separately.',
  review_required: 'Some emails could not be posted safely. Check the listed reason and correct the account mapping, starting balance, or transaction evidence.',
};
const date = value => value ? new Date(value).toLocaleString() : 'Not yet recorded';
export function OperationalBanner({ remote }) {
  if (remote.data?.status === 'not_linked') return null;
  const data = remote.data;
  return <div style={{ padding: '6px 12px', color: 'var(--Ac-1)', background: 'var(--Ec-4)', fontSize: '14px' }}>
    <Link to="/Status" style={{ color: 'inherit', display: 'inline-flex', minHeight: '44px', alignItems: 'center' }}>
      {remote.error ? 'Email status unavailable — view details' : !data ? 'Checking email status…' : data.status === 'disabled' ? 'Email ingestion is disabled — view status' : data.status === 'ok' ? 'Email ingestion is running — view status' : `Email ingestion needs attention (${data.reviewCount} review items) — view status`}
    </Link>
  </div>;
}
export function OperationalStatusPage({ remote }) {
  const data = remote.data;
  return <main style={{ color: 'var(--Ac-1)', padding: '16px 16px 100px', overflowY: 'auto', width: '100%', maxWidth: '720px', margin: '0 auto', boxSizing: 'border-box' }}>
    <h1>Email &amp; agent status</h1>
    <DataStatus {...remote} />
    <button type="button" onClick={remote.refresh} disabled={remote.refreshing} style={{ minHeight: '44px', padding: '8px 16px' }}>{remote.refreshing ? 'Checking…' : 'Refresh status'}</button>
    {!data && !remote.error && <p>Checking ingestion…</p>}
    {data?.status === 'not_linked' && <p>Email ingestion is not linked to this account.</p>}
    {data && data.status !== 'not_linked' && <>
      <h2>{data.status === 'disabled' ? 'Ingestion disabled' : data.status === 'ok' ? 'Ingestion running' : 'Needs attention'}</h2>
      {data.status === 'disabled' && <p>Enable email ingestion in the server configuration and start the email agent to import alerts automatically.</p>}
      <p>Status checked: {date(data.checkedAt)}. Refreshes every minute while this app is visible.</p>
      <dl>
        <dt>Mailbox</dt><dd>{data.agent.connected ? 'Connected' : 'Disconnected'}</dd>
        <dt>Last agent heartbeat</dt><dd>{date(data.agent.heartbeatAt)}</dd>
        <dt>Last completed mailbox scan</dt><dd>{date(data.agent.lastScanAt)}</dd>
        <dt>Latest discovered email</dt><dd>{date(data.agent.lastMessageAt)}</dd>
        <dt>Waiting for processing</dt><dd>{data.pending.count} · oldest: {date(data.pending.oldestAt)}</dd>
        <dt>Needs review</dt><dd>{data.reviewCount}</dd>
        <dt>Queued notifications</dt><dd>{data.notifications.count} · oldest: {date(data.notifications.oldestAt)}</dd>
      </dl>
      {data.agent.lastError && <p>Latest connection or scan error: {data.agent.lastError}</p>}
      {!!data.issues.length && <ul>{data.issues.map(issue => <li key={issue}>{issueText[issue] || issue}</li>)}</ul>}
      <h2>Unresolved emails</h2>
      <p>Showing {data.unresolved.length} of {data.unresolvedTotal} unresolved emails, oldest first.</p>
      {data.unresolved.map((job, index) => <article key={job.sourceKey} style={{ borderTop: '1px solid var(--Bc-3)', padding: '12px 0' }}>
        <h3>Email {index + 1}{job.transactionId ? ` · Transaction ${job.transactionId}` : ''}</h3>
        <p>{job.status === 'review_required' ? 'Needs review' : 'Retrying automatically'} · {job.attempts} attempts</p>
        <p>Received: {date(job.receivedAt)} · Last attempt or update: {date(job.updatedAt)}</p>
        <p style={{ overflowWrap: 'anywhere' }}>{job.lastError || 'Waiting for the next processing attempt.'}</p>
      </article>)}
      {!data.unresolved.length && <p>No unresolved emails recorded.</p>}
      <p>A healthy email pipeline confirms alert processing; it does not verify that every bank transaction generated an email.</p>
    </>}
  </main>;
}
