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

## Reliable email ingestion

The email agent uses the existing IMAP, Gemini, Telegram, and SQLite integrations;
no bank aggregator or additional subscription is required. Existing Gemini usage
and its quota/billing configuration still apply.

Run `npm run agent --prefix server` on an always-on machine with the existing
`server/.env` configuration and `AI_INGESTION_ENABLED=true`. Restart the agent and
API after upgrading. Database tables/columns migrate automatically. Back up the
SQLite database before the first upgraded run.

The agent scans INBOX, including read messages, every minute and on incoming-mail
notifications. Its first scan also discovers historical INBOX messages; use a
mailbox dedicated to bank alerts to avoid parsing unrelated mail. Previously
processed legacy UIDs are migrated for the first observed mailbox epoch. That
migration assumes the configured mailbox is the original single mailbox; if you
have changed mailboxes or reset UIDVALIDITY before upgrading, review the legacy
`processed_emails` records before starting. Emails already archived or deleted
before discovery are outside INBOX coverage.

Messages are durably journaled before parsing. Failed jobs survive restarts and
mailbox deletion, and retry every minute. Identity includes mailbox and UIDVALIDITY.
Source replay is idempotent, and reliable bank references are matched within the
same account, currency, amount and direction. Similar purchases alone are never
silently merged. Separate alerts without a common reliable reference can still
represent the same payment; those cannot be identified conclusively from email.

Transaction, balance/portfolio effects, source completion, and Telegram outbox
creation commit together. Notifications retry separately and cannot block balance
updates. Telegram has no idempotency key: a process crash after Telegram accepts a
message but before its ID is saved can still cause a repeated notification.

Account matching requires an account identity or explicit high-confidence account
selection, with matching currency. Configure account references and starting
balances for every tracked account. Ambiguous accounts and insufficient recorded
balances are retained for review, rather than guessed. Unposted account/portfolio
activity is retried every minute and on startup; saved account hints survive
restarts. The authenticated `GET /email/status` endpoint exposes counts and up to
100 unresolved jobs for the configured agent user, without exposing email bodies.
The agent audit log contains posting details.

Email ingestion only covers alerts actually delivered to this INBOX. Enable bank
alerts for each account and keep starting balances accurate; email alone cannot
prove a complete bank balance or capture activity a bank never reports by email.
Durable email bodies are stored locally in SQLite to allow retry, so include this
database in your normal protected backup/storage arrangements.

Backend verification: `npm test --prefix server`. Integration tests use a temporary
SQLite database and mocked AI output; they never connect to bank, IMAP or Telegram
services. `MONIMONITOR_DB_PATH` can override the database path for isolated checks.

Internal transfers now carry `TransferFromAccountId`, `TransferToAccountId`, and
`TransferConfidence`. Both endpoints must be distinct owned cash accounts in the
same currency, and direction must be explicit with HIGH confidence. Posting
subtracts from the source and credits the destination in one database transaction;
a matching reference plus endpoint pair prevents complementary notifications from
posting twice. Missing endpoints, credit-card transfers and foreign-exchange
transfers remain review items rather than guessed movements.

Explicit portfolio actions override inconsistent AI category/label guesses and
merchant rules cannot turn trades or transfers into spending. Portfolio account
matching requires account identity or an explicit selection and matching currency;
confidence in a different balance account cannot promote a portfolio guess. Filled
trade prompts distinguish executed orders from pending/cancelled orders. Fractional
buys/sells update holdings and cash, with insufficient cash/shares held for review.
These rules apply to newly parsed emails; previously misclassified historical rows
are not automatically rewritten. Tests use synthetic extraction fixtures, so actual
bank/broker email formats still need validation against representative messages.

### Source evidence and reviewed account mappings

Known Wealthsimple filled-order, transfer, dividend, direct-deposit, and incoming
crypto templates are now read directly from their named fields before AI fallback.
IMAP captures sender and subject headers alongside the message body. The source
fields override model guesses about amounts, symbols, quantities, execution prices,
and cash versus asset movement. Unknown templates continue through the existing AI
integration; no new service or subscription is introduced.

Repeated account labels such as `TFSA` require a reviewed mapping when multiple
accounts fit. Mappings live in `email_account_aliases`; account IDs must belong to
the same user/institution. Prepare a private JSON array of
`{institution, label, accountId, evidence}` and import it with:

```sh
node server/import-email-aliases.js /absolute/path/to/reviewed-aliases.json USER_ID
```

Use independent bank/account evidence, not model confidence, to establish a mapping.
The October validation mappings were calibrated from reconciled emails before
October 1; October target transactions were excluded from mapping selection.
Private mappings and source emails remain outside Git. Importing these mappings
into production and restarting the production agent have not been performed here.

User-confirmed filled-order routing is also supported by `reviewed_email_routes`.
These rules are scoped to the user, exact sender and subject, source account label,
and currency. They resolve BUY/SELL confirmations consistently across symbols and
override inconsistent model account guesses. Destination institution, account type,
currency and archived/closed status are checked on every use; unrelated review
reasons remain in force. On November 2, 2026, a user-confirmed Wealthsimple TFSA
trade route was deployed and activated in production. The two affected reviews
were resolved and their existing queued Telegram messages were delivered once each.

Complementary bank/Interac alerts can share a transaction only with compatible
bank/account, amount, currency and direction, a short receipt-time window, no
conflicting references, and exactly one candidate. Repeated generic notices or
missing-account cases are held without a second financial posting. Ordinary
identical purchases remain separate. The review endpoint identifies candidate
transactions; it does not silently guess that every similar alert is a duplicate.

Email transaction alerts, including credit-card authorizations, are treated as posted
immediately without waiting for settlement confirmation. Previously pending email
transactions are marked posted on startup and retried by the account posting agent.
Incoming crypto valuations never increase cash; unknown transferred cost basis
requires review. Card settlement and unreported bank activity cannot be established
solely from notification emails. No complete month-end balance claim is made from
an email-only backtest.

### Operational status

The app's email status link opens `/Status`, which refreshes every minute and
shows the mailbox connection, agent heartbeat, last completed scan, pending email
age, queued Telegram notifications, and up to 100 unresolved emails with reasons.
Only the linked agent user can read detailed status. No email bodies are returned.
If status requests fail, the page identifies any retained snapshot as stale.

`GET /health` checks SQLite and ingestion progress. Enabled ingestion is degraded
(HTTP 503) if the heartbeat or completed scan is older than three minutes, the
mailbox is disconnected, the latest scan failed, emails or notifications have
waited over ten minutes, or review items remain. Disabled ingestion is explicitly
reported as disabled rather than described as working. Public health responses
contain no private errors, email identities, or queue counts.

`GET /live` checks API process liveness only. The Windows launcher and tunnel
repair scripts use this endpoint so a mailbox problem does not trigger tunnel
repairs. Restart both the API and email agent after upgrading to begin recording
runtime status. Fresh scans without new mail are healthy; these checks measure
alert processing, not completeness of bank balances.

### Currency integrity

The reporting-currency selector filters transaction summaries, monthly totals,
category breakdowns and chart series together. Portfolio cards retain separate
currency totals. No exchange-rate conversion or mixed-currency grand total is
implied. `/summary?currency=CAD` returns a single-currency summary; `/summary`
returns `totalsByCurrency`, with null scalar totals when several currencies exist.

Manual entry accepts `Currency` and an owned `BalanceAccountId`. Selecting an
account derives its currency; conflicting explicit currencies are rejected.
Without an account, the user's configured currency supplies the default. Both
manual-entry APIs commit the transaction and selected-account posting together.
CSV import/export preserves the Currency field.

Holdings must use their account's currency. Currency changes to funded accounts
or accounts with financial history are rejected. Existing mismatched holdings
block portfolio valuation until corrected with independent currency evidence;
they are never silently summed or relabelled. Existing transaction currencies
are preserved rather than guessed from the new reporting selection.

Security trades (`BUY`/`SELL`) remain in transaction and investment activity
history, but their gross amounts are excluded from household income, spending,
savings contributions, monthly cash-flow summaries and category breakdowns.
Older transactions linked to `EMAIL_BUY`/`EMAIL_SELL` portfolio postings receive
the same treatment even if their source action field is absent. Ordinary savings
and contributions still count. Trade cash and holding effects are unchanged;
a sale's gross proceeds are not reported as new income or savings.
