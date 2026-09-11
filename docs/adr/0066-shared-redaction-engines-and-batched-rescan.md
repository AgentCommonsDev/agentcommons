# ADR 0066: Shared compiled redaction engines and batched rescan jobs

Date: 2026-09-10
Status: accepted. Refines ADR 0033 (policies load through the active transaction) and
ADR 0016 (rescan checkpoints beside pg-boss); neither decision is reversed.

## Context

Profiling one ingest accept (24 Claude Code records, local test database) put 239 ms of
wall time and 305 ms of CPU on a single accept. Redaction was 110 ms of it: 936
`lintSource` calls per batch, each paying secretlint's per-call rule setup and, in the
shipped pattern rule, recompiling every regex. 56 % of those calls repeat a (prefix,
value) pair already scanned in the same batch (`type`, `userType=external`, versions,
branches, token usage keys), and a second batch of the same session repeats nearly all of
them. Building the `Redactor` itself cost 5.6 ms per accept, but because every
transaction built its own (ADR 0033), no scan result ever survived a batch.

A redaction rescan processed one session per pg-boss job and re-enqueued itself, so each
session cost one poll interval (1 s) plus about 0.55 s of work: 60 small sessions took
60 s locally and the dashboard e2e suite saw 2 to 4 s per session under load.

## Decision

1. **Compiled engines are shared by content.** `CompiledRedactors` keeps at most 128
   engines process-wide, keyed by organization id and `policyFingerprint(rows)`: the
   SHA-256 of the composed, enabled policy set sorted by name (ids, kinds, patterns,
   flags, options, replacements). Every `PolicyCache`, transaction-bound or the shared
   30 s cache, still loads the organization's rows through its own client and asks the
   store for the engine matching those rows. A transaction therefore redacts with exactly
   the rows it can see (an uncommitted or rolled-back row yields a fingerprint no other
   transaction observes), while the compiled secretlint configuration is built once per
   distinct policy set. Organizations never share an engine even when their rows compose
   alike, so the memo below never crosses a tenant boundary.
2. **Each engine memoizes scans.** `Redactor.text` keeps a bounded memo (8192 entries,
   values up to 1024 characters) of results per (prefix, value). Redaction of one string
   is a pure function of the policy set, so this changes no output; counts are returned as
   copies. Empty values return without a scan: no accepted pattern matches empty text, and
   a scanner hit inside the prefix alone never reaches the value.
3. **Rescan jobs publish bounded batches.** A job claims up to `RESCAN_CONCURRENCY` (3)
   unprocessed targets in one transaction under the organization row (outbox row,
   revision bump, projection job and audit per target, purged targets checkpointed at
   once), publishes them concurrently, waits for any target another publisher is
   finishing while its projection lease is held, then commits one progress audit and
   repeats. After `RESCAN_JOB_BUDGET_MS` (60 s) it enqueues its successor in that audit's
   transaction, well inside pg-boss's 180 s expiry. Per-session checkpoints, one successful
   session audit per target, retry from committed checkpoints and the authority recheck
   are unchanged from ADR 0016; only "one session per job" is.

## Consequences

- Accept: 239 → 117 ms wall and 305 → 143 ms CPU per 24-record batch on the fixture,
  redaction 110 → 8 ms. Synthesized transcripts with varying prose repeat fewer values,
  so the 8-lane bench gain is smaller; see `scratchpad/fixes/perf-redactor.md`.
- Rescan: 1.01 → about 0.2 s per small session locally (60 sessions: 60 s → 12 s).
- Memory: at most 128 engines, each with at most 8192 memoized strings of at most 1024
  characters; least recently used engines and oldest memo entries leave first.
- A policy edit takes effect for the next transaction that reads the rows, as before;
  the 30 s shared cache still governs ordinary reads and is still invalidated on mutation.
- The unit test that expected a new `Redactor` instance after the 30 s expiry now expects
  the same compiled engine while rows are unchanged and a new one when a row changes.

## Addendum (2026-09-11): unchanged targets and the concurrency cap

CI on a 2-vCPU runner that also hosts Chromium, the API and both databases still took
about 5 s per fixture session for a rescan whose policy matched nothing (24 of 69 sessions
in 120 s), because every target was rebuilt: all raw rows re-appended at a new generation,
projection re-derived, manifests re-read, receipts re-appended, then superseded rows
cleaned up.

4. **A rescan target whose snapshot did not change is not rebuilt.** After re-redaction,
   `snapshotUnchanged` compares the rewritten records (key, payload, redaction context),
   header and control text against what the build read from the published generation by
   fingerprint, and requires zero policy hits. For such a target `publishUnchanged`
   publishes the claimed revision on the control row (lease released, outbox row removed,
   run checkpoint, `redaction.rescan.session` audit with `unchanged: true`, installation
   and context text re-redacted as before) and writes nothing to ClickHouse: the
   generation stays, and since readers select `revision <= published_revision` within the
   current generation and no row exists at the new revision, their row sets are identical
   before and after, so the publication fence is not taken. `embedding_source_revision`
   follows the published revision when it was current, so vectors computed from this
   content are not recomputed. Any hit or fingerprint difference takes the full rebuild.
5. **The concurrency cap follows the cores.** `RESCAN_CONCURRENCY = max(1, min(3,
availableParallelism − 1))`: three on the 8-core workstation, one on a 2-vCPU host.
