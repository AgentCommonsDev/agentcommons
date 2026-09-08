# 0016. Persist rescan targets and progress beside pg-boss

Status: accepted, 2026-09-07.

The dashboard requires rescan progress. A worker can die after committing one session
but before acknowledging its queue job. Retrying the whole scan would duplicate its
audit and redaction counts, while holding one transaction for a whole organization
would block ingestion for too long.

At enqueue time, snapshot matching non-purged session IDs into `RedactionRunSession`
and create `RedactionRun` progress in the same transaction as the native pg-boss job
and request audit. A job processes one session, committing its raw rewrite, derived
projection, redaction counts, audit, progress checkpoint, and next native pg-boss job
together. Retry sees the checkpoint. pg-boss retains ownership of delivery, retries,
expiration, and scheduling; these tables are a progress ledger, not another queue.

Workers recheck the initiating user's current organization membership and API-key
authority before each session. Persisted job data contains caller IDs and requested
scope, never bearer tokens, cookies, or request headers. Purged targets are skipped
and counted as processed. Completed/failed progress is retained for the configured
audit retention period.

`since` selects sessions with an ingest receipt at or after that instant. `policyIds`
identifies the policy changes prompting the scan and is validated and audited; every
active policy is always applied, including when IDs are supplied. Rescans cannot
restore previously redacted material. New hits add to the originating ingest batch's
policy/session counters; their exact counts also appear in the rescan session audit.
