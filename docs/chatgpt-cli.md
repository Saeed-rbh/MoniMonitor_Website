# ChatGPT CLI provider on Windows

MoniMonitor can run the official Codex CLI with the Windows service user's
ChatGPT login. Select `AI_PROVIDER=codex-cli` in `server/.env` and set
`AI_CODEX_CLI` to the absolute native `codex.exe` path (not the npm `.cmd` shim).
Install with `npm install -g @openai/codex`, then use `codex login` and confirm
`codex login status` reports ChatGPT under the same Windows account as the server.
Set `AI_CODEX_MODEL=gpt-6-luna` to select Luna; otherwise the CLI uses its default.

Each request runs in a temporary directory with user configuration ignored,
read-only sandboxing, shell tools and web search disabled, and ChatGPT login
forced. API key environment variables are removed from the child process.
Prompts go through stdin. Email extraction uses the CLI `--output-schema` flag
with the shared transaction/rejection schema inside a required `result` envelope.
The adapter unwraps that envelope, responses must parse as JSON, and existing
application schemas and source evidence checks still validate financial data. Set `AI_FALLBACK_PROVIDER=gemini` to explicitly enable the existing Gemini API
when the CLI fails (including invalid JSON). It requires `AI_API_KEY` or
`GEMINI_API_KEY`. Without that setting there is no automatic fallback. Aborted
requests never start a fallback call. The CLI gets 45 seconds (`AI_CODEX_TIMEOUT_MS`) before the API fallback;
both attempts share the outer request timeout.
Temporary output is removed after completion; CLI sessions are ephemeral.
ChatGPT usage limits still apply. This sends the prompt to OpenAI through Codex;
it is not local inference.

CLI calls default to a 120-second timeout and a 180-second queue deadline.
Restart the backend after changing its environment. Check `/diagnostics` for
`ai.identity` and run a synthetic provider request before relying on ingestion.
Tailscale is used for Windows administration; the CLI runs locally on Windows.

Official reference: https://learn.chatgpt.com/docs/non-interactive-mode

Email prompts require literal account-name/reference evidence for account IDs;
institution or account-type similarity alone is insufficient. Generic source
labels remain source evidence, not invented account numbers. Wallet receipts
are described as transfers unless the source explicitly describes a deposit.
The application continues to reject unsupported model values without rewriting
them to make validation pass.

Asset symbols and explicit transaction quantities are extracted for non-trade
activity as well as BUY/SELL. Crypto transfers use stated final after-fee units
when present, preserving the email's precision. A dividend's explicit ticker
is retained without inferring a quantity from the existing holding balance.
Completeness checks reject omitted explicit tickers and omitted or gross units
where a crypto transfer states final after-fee units. Unit price remains null
for non-trade activity.

All financial email types use full AI extraction and classification, including
recognized expense, income, investment, dividend and transfer formats. The
ingestion parser has no template return or purchase-only classification path.
Templates remain available for offline source comparisons, not production
extraction. Validated AI cache entries are versioned; prior mixed-template
entries are invalidated by source-evidence-v7. Duplicate detection, account
evidence checks and reviewed merchant preferences remain in force.

When the source states a transaction date without a time, AI extraction returns
YYYY-MM-DD rather than inventing a clock time or replacing it with receipt time.
