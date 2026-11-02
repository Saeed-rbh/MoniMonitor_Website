# Evidence-checked email processing

Known RBC alerts and Wealthsimple trade/dividend/deposit/transfer templates are read
locally. Unknown layouts use a schema-constrained model. Model-extracted money,
currency, accounts, dates, references, trade actions, symbols and quantities require
supporting contiguous source quotes. Unsupported results remain held. Unknown
settlement dates stay unknown. Bank and reviewed corrections outrank email guesses.

The model has no database tools or ability to delete records. Existing source
identity, account matching, pending/settled reconciliation and transactional posting
remain responsible for duplicate prevention. Matching amounts alone are insufficient.

Verified examples are scoped to the user and exact email subject, exclude changed
facts, and require both the event and its bank verification to precede receipt of
the email being processed. Later verification cannot become historical training.
Examples never supply missing values for the current email.

Successful extractions are encrypted with EMAIL_SOURCE_ENCRYPTION_KEY and cached
by user, minimized source, accounts, verified examples, extraction version and
provider/model. Failures are not cached. Cache and diagnostic history is retained.

## Free provider configuration

AI_PROVIDER defaults to `local`. Set OLLAMA_MODEL to an installed model that passes
the raw-email evaluation. OLLAMA_URL accepts only loopback HTTP, defaulting to
http://127.0.0.1:11434. There is no hosted fallback. Changing models requires a new
evaluation; configuring a model does not establish extraction accuracy.

Alternatively, after verifying a Google project's billing is disabled, set
AI_PROVIDER=gemini-free, AI_FREE_PROJECT_CONFIRMED=true and its AI_API_KEY.
This setting is operator attestation, not an API billing check. The app cannot
prevent Google charging a project whose billing is enabled later: keep billing
unlinked. Hosted free-tier content may be used to improve provider products;
local inference keeps financial email on the server. Quota failures never switch
providers. All AI features share provider restrictions and request/byte/output caps.

Without a usable provider, known templates keep working. Unknown emails remain in
the durable queue and resume automatically when configuration/service recovers.
Configuration/outage retries do not expire at the malformed-email attempt limit.
Protected /diagnostics reports configured provider identity; an operational alert
appears when emails are waiting for an unconfigured provider. Endpoint availability
is established by requests, not by the configured flag alone.

## Automatic diagnosis

Changed failed consistency checks trigger a bounded, encrypted, cached diagnosis.
The model selects source-linked, previously bank-verified correction candidates;
it cannot supply new financial values. Identity, amount, currency, account, action,
symbol, quantity and price must already agree with the verified record.
Applying a candidate rechecks source identities and current/verified hashes inside
a transaction, preserves history, and must pass every bank ledger, cash snapshot,
holdings and duplicate-effect control. Any failure rolls back the proposal.
Unevidenced missing transactions and money/holdings discrepancies remain held;
existing deterministic recovery restores retained verified missing history.

## Evaluation

`node server/scripts/evaluate-ai.js` remains the synthetic validator test. It makes
no model requests and cannot measure live extraction accuracy.

`node server/scripts/evaluate-raw-email.js CORPUS SNAPSHOT OUTPUT` parses retained
raw messages afresh with local templates. `--model` additionally evaluates model
fallback on unknown templates using the configured free/local provider and refuses
to run without one. It never reads saved parsedTransaction as extraction input or
writes financial records. Private output is created with owner-only permissions.
Keep all evidence and reports under private ignored paths.

Results group by receipt month, holding October out from prior examples. Only
examples independently verified before receipt and from an earlier month qualify.
Counts distinguish abstention from comparison and show bank agreement by field.
A raw alert can disagree with corrected bank facts: that source conflict is not
permission to replace bank records. Captured transaction emails cannot measure
ignored or undiscovered mail. Report live model accuracy separately from template
coverage and saved-extraction replay.

For local deployment set `OLLAMA_NO_CLOUD=1` in the Ollama server's environment
and restart that server. The adapter also rejects cloud model names, checks local
model metadata before sending email content, rejects remote model aliases, and
refuses HTTP redirects. API details: [Ollama structured output](https://docs.ollama.com/capabilities/structured-outputs),
[local-only configuration](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features),
[Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output).
