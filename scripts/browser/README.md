# Browser regression checks

Requires Python 3.9+ with `playwright` installed and `python -m playwright install chromium`.
Run from the repository root after installing both npm lockfiles.

Start these in separate terminals:

```sh
node scripts/browser/test-server.cjs
VITE_API_BASE_URL=http://localhost:4174 npx vite --host localhost --port 4173 --strictPort --force
python scripts/browser/transactions.py
```

The API fixture creates a temporary SQLite database, ignores `.env` and inherited
integration credentials, and does not start background workers. Stop both servers
after testing. The browser script refuses APIs without the fixture marker. It
creates synthetic transactions and tests desktop/mobile login by accessible label,
recategorization, persistence after reload, API consistency, and downloaded CSV
values including exact cents, embedded quotes/newlines and formula protection.

For production browser verification, replace the Vite development server with:

```sh
VITE_API_BASE_URL=http://localhost:4174 npx vite build --outDir /tmp/monimonitor-browser-dist
npx vite preview --outDir /tmp/monimonitor-browser-dist --host localhost --port 4173 --strictPort
```

These browser checks are opt-in and complement `npm run check`. They require the
Telegram web script to load, but do not authenticate with Telegram or contact banks.
They exercise transaction recategorization, not every possible financial correction.
