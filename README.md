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

### Backend / Mock Data

This project currently uses:
- **Mock Data**: stored in `src/services/` or `db.json` for development.
- **JSON Server**: if using `db.json`, run:
  ```bash
  npx json-server --watch server/db.json --port 3001
  ```
  *(Check `package.json` for specific server scripts)*

### TimesFM spending forecast

The monthly Insight page can predict the next 30 days of expenses with Google's
TimesFM 2.5 model. The model runs only on the API server: transaction data is
aggregated into daily expense totals before the model is called, and neither the
model nor the ledger is sent to the browser.

Install TimesFM in a dedicated Python 3.10+ virtual environment, then point the
API at that executable in `server/.env`:

```bash
git clone https://github.com/google-research/timesfm.git
python -m venv .venv-timesfm
.venv-timesfm\\Scripts\\activate
pip install -e .[torch]
```

```env
TIMESFM_PYTHON=C:\\full\\path\\to\\.venv-timesfm\\Scripts\\python.exe
TIMESFM_TIMEOUT_MS=180000
```

The first forecast downloads the TimesFM 2.5 200M checkpoint and can take a few
minutes. Later forecasts are cached for six hours while the transaction history
is unchanged. At least 21 days of expense history are required.

## Project Structure

```
MoniMonitor_Website/
├── public/              # Static assets
├── server/              # Backend / Database mock files
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
- Every restore verifies the selected file and creates a pre-restore safety
  backup before replacing application data in one database transaction.

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
