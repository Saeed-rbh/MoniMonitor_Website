# Reliability and evidence

The operational worker checks financial evidence every 15 minutes, including
after a restart. Profile → Reliability exposes checks for the last 90 days.
Email-only entries remain provisional. A posted bank source is labelled
“Bank recorded”; this means a matching provider record, not a reconciled account
or a certified bank statement.

The checker detects signed bank amount/direction conflicts, brokerage currency
conflicts, unassigned trades, refund direction errors, exact duplicate bank IDs,
removed reviewed provider records, and missing reference-linked transfer legs.
Trades and transfer legs have a three-day grace period; email-only evidence has
a seven-day grace period. Ambiguous transfers and missing sources require review.
Existing Plaid ingestion continues retrying provider operations and reconciling
added, modified, removed, and pending-to-posted records.

A direction error can be repaired automatically only with one posted bank source,
the same currency and amount, the same mapped account, and no reviewed override.
Repairs are audited and use the existing balance posting service, which protects
authoritative bank snapshots from double posting. Similar amounts alone never
authorize automatic corrections or merges.

User edits and earlier audited corrections are stored separately in
`transaction_overrides`. Provider updates retain original facts and cannot
overwrite reviewed fields. Changed/deleted bank payloads are archived in
`transaction_source_history`; removed reviewed records are retained for review.
Merchant rules remain separate from transaction-specific corrections.

Balance snapshots are retained. Exact opening + activity = closing reconciliation
requires same-currency statement snapshots with explicit cutoffs and complete
activity for that interval. Current provider snapshots and date-only records
usually lack this shared cutoff; these accounts say “Awaiting statement cutoffs”
instead of claiming verification. This release does not import bank statements.

Incident transitions are saved with the Telegram outbox in one database
transaction. Repeated checks and restarts do not repeat notifications. A batch
of new or resolved incidents sends one bounded notice, and delivery uses the
existing retry queue. Optional HTTPS operational webhooks retry on subsequent
checks when delivery fails.

Encrypted backup copies are read back and compared with SHA-256. Restore drills
use the copied backup when configured, and run integrity/migration/application
checks in an isolated database with networking disabled. Results persist across
restarts. A second local drive is an additional recovery copy, not true offsite
storage. Configure `BACKUP_OFFSITE_DIRECTORY` to a remote or synchronized folder;
the app cannot prove that a cloud synchronization client has uploaded its files.

The GitHub `Independent uptime` workflow checks public `/api/health` and
`/api/ready` approximately every 15 minutes, with three attempts. Readiness
includes worker failures and stale ingestion heartbeats. Responses contain no
financial data. GitHub schedules can be delayed and are not a guaranteed SLA.
Set repository secrets `MONIMONITOR_MONITOR_BOT_TOKEN` and
`MONIMONITOR_MONITOR_CHAT_ID` for alerts that remain available if the app stops.
Consecutive failed completed probes suppress duplicate Telegram alerts using
GitHub run history; API history failures may cause a repeated alert.
The repository default branch is `main`, which GitHub uses for scheduled runs.
Reliability digests escape the complete text for Telegram MarkdownV2. The
audited `server/scripts/repair-reliability-notifications.js` command can retry
older malformed reliability digests once; dry run is the default.

Automatic fast-forward updates and updater restarts require a successful
`Verify app` push run for the exact main commit. Missing, pending, failed or
unavailable verification defers deployment. Local development launches remain
available; these gates do not certify uncommitted changes.
The Vercel project `moni-monitor-website` also requires the GitHub
`App quality gate` as a blocking production Deployment Check. Vercel builds may
finish earlier, but future production promotion waits for the aggregate check.
The supervisor holds an exclusive loopback lock and refuses to launch if the API
port is already occupied. Version receipts are checked against the serving API's
captured commit and agent readiness, rather than trusting a saved version marker.
Shutdown requests drain new supervisors through a local control file. Legacy
processes can require forced cleanup, followed by durable queue and WAL recovery.

These checks reduce routine inspection. Missing bank evidence, provider errors,
ambiguous account identity, and statement mismatches still require human review.
