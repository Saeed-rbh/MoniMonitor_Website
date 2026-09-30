# MoniMonitor Website

A modern financial tracking application built with React, Vite, and Tailwind CSS. This dashboard allows users to monitor their income, expenses, and savings with a visual and interactive interface.

## Features

- **Financial Dashboard**: visualize net amounts, income, and expenses.
- **Transaction Management**: Add, edit, and view monthly transactions.
- **Telegram Integration**: Designed to work seamlessly as a Telegram WebApp.
- **Responsive Design**: optimized for mobile and desktop views.

## Tech Stack

- **Framework**: [React](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Language**: JavaScript / TypeScript (Migrating)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) + CSS Modules
- **State Management**: React Hooks (moving to Context API)
- **Routing**: React Router DOM

## Getting Started

### Prerequisites

- Node.js 22.12 or newer
- npm (use npm 11 for dependency updates)

### Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd MoniMonitor_Website
    ```

2.  Install dependencies:
    ```bash
    npm ci
    ```

### Running Locally

The frontend uses Vite 8 and Vitest 4, with React Router 7. The build keeps the
previous browser compilation targets explicitly configured. See the official
[Vite migration guide](https://vite.dev/guide/migration) when changing build
configuration. Obsolete Cognito/Amplify/CDK packages have been removed; the app
uses its API session authentication.

Before delivering a change, run `npm run typecheck`, `npm test -- --run`, and
`npm run build` at the root, then `npm test` in `server/`. Run `npm audit` in
both directories against the live registry, including development dependencies.
Use `npm ci` with the committed lockfiles for reproducible installs. If an old
installed peer graph blocks a toolchain update, resolve the new manifest in a
fresh directory with npm 11 and verify a clean install before delivery; do not
disable peer checks or force advisory fixes.

`npm run check` runs the complete verification sequence and stops on any
failure. Backend checks use temporary database and backup paths. GitHub Actions
runs the same command on Linux with Node 22 and 24, and Windows with Node 24,
using clean installs from both lockfiles. The `App quality gate` check passes
only when every matrix job succeeds; canceled and skipped verification cannot
pass the gate. The workflow requires no application secrets and does not deploy.

To start the development server:
```bash
npm run dev
```
The app will be available at `http://localhost:3000`.

### Backend

Authentication uses registered, revocable sessions with signed JWTs. Existing
stateless tokens require a fresh login after the session migration. Login and
Telegram authentication register a session; `/session` verifies it and
`POST /logout` revokes the current session. The browser checks stored access
before displaying authenticated content, clears expired access, and propagates
logout across tabs. Failed logout stays visible for retry rather than claiming
server revocation. Explicit Telegram logout requires a new sign-in action.
`JWT_EXPIRES_IN` defaults to eight hours. Successful backup restores invalidate
all sessions and never restore access from the backup; failed restores preserve
current sessions. Expired session records are pruned at the next sign-in.

Dashboard totals, statement summaries, insights, widgets, and forecasts share
the same accounting rules in `shared/financialSemantics.cjs`. A recorded
category takes precedence over a provider's generic Credit/Debit type. Internal
transfers and investment trades do not count as income or spending. Refund
markers on legacy expense rows are excluded pending correction. Monetary
aggregation uses stored integer cents, with decimal half-up rounding at input;
the display amount is derived from `AmountMinor` when both fields exist.

Encryption uses distinct secrets of at least 32 random characters for
`EMAIL_SOURCE_ENCRYPTION_KEY`, `PLAID_TOKEN_ENCRYPTION_KEY`, and
`BACKUP_ENCRYPTION_KEY`. Production validates all three before listening.
New ciphertext records its key ID and authenticates its purpose. Old formats
remain readable, including legacy JWT-encrypted data, but new writes never use
the JWT signing secret. Development without explicit keys creates a durable
`<database-path>.encryption-keys.local` file; preserve it across restarts and
protect its access permissions. Previously lost ephemeral keys cannot be recovered.

To rotate a purpose's key, retain its old ID and secret in the JSON object
`<PURPOSE>_PREVIOUS_KEYS`, set a new `<PURPOSE>` secret and optionally
`<PURPOSE>_ID`, then restart. Email evidence and Plaid tokens are re-encrypted
on startup. Retained backups require their old keys throughout their retention
period; keep recovery keys separately from the backup storage. For unversioned
legacy data, `<PURPOSE>_LEGACY_KEY` can preserve the original JWT/key secret
after signing-key rotation. Verify an isolated restore before retiring any key.

Set `TRUSTED_PROXIES` to `false` for direct hosting, or to the explicit
comma-separated IP addresses/CIDRs of your reverse proxies. The default trusts
only loopback proxies, supporting the local tunnel. Forwarded client IP and
HTTPS headers must be overwritten by the proxy. Authentication rate limits
persist in SQLite, increment atomically, and return 503 if their storage fails.

Reports use CAD until recorded exchange-rate conversion is available. Imported
foreign-currency activity retains its native currency and is visible in account
history; it is excluded from CAD spending, income, forecasts, and investment
timelines. Portfolio totals are separated by currency, including holdings whose
currency differs from their account. Cross-currency balance postings require
review. Mixed-currency Plaid holdings require an authoritative cash balance;
without it, the previous cash balance is retained and marked for review.

Financial reports use the calendar date supplied by the bank (`YYYY-MM-DD` at
the start of `Timestamp`), rather than converting it into the device timezone.
This keeps statement days and months consistent across the dashboard, timeline,
monthly insights, and forecasts. Explicit timestamp offsets still describe the
event instant. Legacy manual wall times (`YYYY-MM-DD HH:mm`) are supported.
New and edited records reject impossible dates, clock values, and offsets.

The application uses the Express API in `server/index.js` and a SQLite database
(`server/monimonitor.sqlite` by default). It does not use JSON Server or a mock
backend. Development fixtures such as `src/services/mockTransactions.json` are
frontend-only and must never be used as a production data source.

Start the API separately with:

```bash
cd server
npm start
```

### Hosted TimesFM spending forecast

The monthly Insight page predicts the next 30 days of expenses using BigQuery
ML's hosted TimesFM 2.5 model. The API server sends only the up-to-365-day
daily expense series to BigQuery as query parameters—no BigQuery table is
created and the browser never receives Google Cloud credentials.

1. Create a Google Cloud project and attach billing.
2. Enable the BigQuery API.
3. Create a service account, grant it **BigQuery Job User** on the project,
   and download a JSON key to a secure path outside this repository.
4. Copy `server/.env.example` to `server/.env` and set:

```env
GCP_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=C:\\secure\\path\\to\\service-account.json
BIGQUERY_LOCATION=US
TIMESFM_MAX_BYTES_BILLED=10485760
```

Forecasts are cached for six hours while the expense history is unchanged. The
10 MB maximum-bytes-billed guard keeps a personal forecast at BigQuery's minimum
query size; at least 90 days of expense history are required. Forecast points
are retained for one year and compared with actual spending as data arrives, so
the API can report a measured WAPE and mean absolute error after seven days.

## Project Structure

```
MoniMonitor_Website/
├── public/              # Static assets
├── server/              # Express API, SQLite database, workers, and migrations
├── src/
│   ├── components/      # Reusable UI components
│   ├── pages/           # Page views (Dashboard, Transactions, etc.)
│   ├── hooks/           # Custom React hooks
│   ├── services/        # API services
│   ├── utils/           # Helper functions
│   ├── App.jsx          # Main entry point
│   └── main.jsx         # React DOM render
└── package.json         # Project dependencies and scripts
```

## Contributing

1.  Create a feature branch (`git checkout -b feature/AmazingFeature`).
2.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
3.  Push to the branch (`git push origin feature/AmazingFeature`).
4.  Open a Pull Request.

<!-- GitHub connection test -->
<!-- GitHub connection test 2 -->

## Change delivery

After making and verifying a code change, commit and push the related files to
the configured Git remote. Keep unrelated local changes out of that commit.

## Backup and recovery

Normal startup applies schema migrations and reconciliation; it never resets
financial history or inserts personal snapshot balances. Historical snapshots
must be supplied as private JSON files outside the repository. The import only
accepts an existing user with no financial records and refuses to replace data.

Preview with `node scripts/import-financial-snapshot.js --file <path> --user <id>`
from `server/`. Add `--apply` to import after a verified encrypted safety backup.
Configure a durable `BACKUP_ENCRYPTION_KEY` before applying. The JSON contains
`id`, an ISO UTC `capturedAt`, `accounts`, and optional `holdings`. Each account
contains `name`, `institution`, `accountType`, `accountRef`, `currency` (`CAD`),
and integer `cashMinor`. Holdings contain `accountRef`, `symbol`, `quantity`,
`averageCostMicros`, and `priceMicros`. Preview displays counts only.

The API creates verified SQLite snapshots in `server/backups` by default. The
directory can be changed with `MONIMONITOR_BACKUP_DIR`, and the automatic
interval can be changed with `MONIMONITOR_BACKUP_INTERVAL_HOURS`.

- Automatic backups are checked when the API starts and at least every six hours.
- Retention keeps recent daily, weekly, monthly, and manual recovery points.
- Profile shows the last successful backup date and provides Backup, Download,
  and Restore controls.
- Backup files and raw email sources are encrypted at rest. Restores pause
  workers, verify a decrypted temporary copy, create a pre-restore safety
  backup, and then request a supervised process restart after completion.

## Durable email ingestion

Account cash records include a balance source, snapshot time, and revision.
Bank snapshots absorb earlier postings: editing or deleting reporting activity
does not change that bank balance. Replacing a manual cash balance starts a new
baseline, and later manual postings affect that baseline. Unsafe reversals roll
back the entire transaction edit or deletion and return a review conflict.
Accounts with money or recorded activity cannot be relabelled into another
currency. Negative provider cash is retained as a review issue while the last
supported cash balance remains visible; overdraft accounting is still pending.
Portfolio-linked source records require reversal of their portfolio activity
before financial edits or deletion.

Bank holdings are imported without email-trade overlays. BUY/SELL emails for
bank-linked accounts remain reporting evidence; they never change recorded
shares or cash. Recent email-only trades appear separately as estimated share
and cash changes for seven days after receipt. Provider confirmation, edits,
deletion, and expiry update or remove those estimates. A bank snapshot may
already include a trade, so estimates are excluded from recorded portfolio
totals. Uncertain accounts, invalid details, currency mismatches, impossible
sells, and overdrawn estimates require review. Manually maintained accounts
retain their actual postings without an additional estimated posting.

Holdings record their source and import time. Manual changes to bank holdings
mark the baseline as mixed and require refresh or review; they do not claim to
be a bank snapshot. The migration flags possible legacy email-trade overlays
without guessing a reversal. Refresh bank holdings and cash to establish a new
provider baseline. Legacy posting history is retained as evidence.

Recent email-only internal transfers appear as separate pending cash changes
and estimated cash on both account cards. Estimates are derived from current
transactions and never alter recorded cash or portfolio totals. Bank source
confirmation, deletion, and the seven-day expiration remove the estimates;
edits recalculate them. Cross-currency or uncertain account matches require
review. A bank snapshot may already include the transfer, so an estimate is
not an additional confirmed balance. Existing balances possibly changed by
the former override are marked for review rather than guessed reversals;
refresh bank balances or save an explicitly reviewed manual balance to clear
that uncertainty.

The email agent stores its IMAP UID cursor and pending-message queue in SQLite.
On every startup and reconnect it discovers all newly delivered messages,
including emails that were marked read while the server was offline. A message
stays in the retry queue until analysis and database ingestion succeed.

- `IMAP_INITIAL_SYNC_SINCE` controls the beginning of the one-time first scan.
- Later restarts resume from the saved UID with no time-based downtime limit.
- IMAP `UIDVALIDITY` changes reset the cursor safely and start a new mailbox
  generation without mixing message identities.
- Transaction-level duplicate detection remains the final protection if a
  message succeeds immediately before an unexpected shutdown.

## Plaid transaction fallback

Plaid can fill transaction gaps when an email notification is missing. Add the
Plaid server credentials shown in `server/.env.example`, start the API, then use
Profile → Bank fallback → Connect a bank with Plaid.

- Plaid Link performs user consent; API secrets and access tokens never reach the browser.
- Access tokens are encrypted at rest with `PLAID_TOKEN_ENCRYPTION_KEY` (or `JWT_SECRET` as a compatibility fallback).
- `/transactions/sync` cursors are persisted for incremental updates.
- Source mappings attach matching Plaid records to existing email transactions instead of inserting duplicates.
- Transaction loading checks Plaid at most once every ten minutes; Profile also provides a manual sync.
- `PLAID_ENV=sandbox` is suitable for testing. Change it to `production` only with the matching Production secret and approved Plaid application.
