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

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd MoniMonitor_Website
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

### Running Locally

To start the development server:
```bash
npm run dev
```
The app will be available at `http://localhost:3000`.

### Backend

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
