# Stable bank reconciliation checkpoint

The user requested a stable checkpoint on 2026-11-01 so future reviews can reuse
saved bank history. The verified bank-evidence cutoff is **2026-10-31**.

## Find the saved stage

Read `private-bank-exports/stable-checkpoints/LATEST.json` in the original
MoniMonitor workspace. It points to the private checkpoint manifest, encrypted
production database backup, frozen reconciled historical ledger, bank evidence,
and verification records. Private evidence may be absent from an isolated Git
worktree; locate the original workspace before requesting new bank downloads.
The local `STABLE_DATABASE_STAGE.txt` handoff also identifies this location.
The production machine also keeps a pointer at
`%LOCALAPPDATA%/MoniMonitor/stable-checkpoints/LATEST.json`.

The current-stage backup includes later activity and the completed Telegram
correction audit. Its capture time is distinct from the bank-evidence cutoff.
The historical ledger preserves the exact bank-reconciled stage. Database and
archive hashes, restore verification, and pinned server/offsite locations are
recorded privately in the manifest. Stable checkpoints are outside automatic
backup pruning. Never commit the private files or encryption keys.

## Next reconciliation

1. Continue from the current live database; use the checkpoint as a reference
   and recovery point. Do not restore it merely to start another review.
2. Reuse the saved historical bank exports, statements, and verified ledger.
   Collect only newer activity, with a seven-day overlap for delayed posting
   and settlement. For this cutoff, the initial incremental window starts
   **2026-10-24** and runs through the next review date.
3. Match overlapping rows using source identity and bank evidence, preserving
   separate genuine transactions with the same date/amount. Resolve pending
   authorizations against actual settled records without duplicating cash.
4. Compare the previous verified cash balance plus new posted cash movements
   against the bank's new balance. Verify investment quantities separately;
   market value also depends on prices. Correct evidenced transactions rather
   than adding balance plugs. Preserve reviewed source links and overrides.
5. Keep pending/unposted status internal, as requested by the user; do not add
   a separate app UI. Verify any corrected Telegram messages through the durable
   outbox, including Telegram's exact-content-already-matches acknowledgement.
6. Save a new named checkpoint after a later reconciliation is verified.

A full-history download is unnecessary unless a specific missing/corrupt source,
new account, or demonstrated historical discrepancy requires additional evidence.
Request only the evidence needed to close that gap.

## Recovery

Use the pinned encrypted database and the existing server backup/data encryption
keys. Check the recorded hash and verify a decrypted temporary database before
any recovery. Follow the established worker-drain and database-restore procedure;
never replace an active SQLite database by copying its main file alone. Restoring
production is a separate action and must be requested or authorized explicitly.
