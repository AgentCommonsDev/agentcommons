# ADR 0060: Reuse edges are materialized by the audit projection, not derived on every read

Date: 2026-09-10
Status: Accepted. Refines ADR 0047 ("Reuse analytics enumerate published native sessions");
the reuse semantics of spec §10 are unchanged.

## Context

The `sessions` view is `session_details LEFT ANY JOIN session_reuse`, and `session_reuse`
derived from `reuse_edges`, which recomputed the whole reuse graph on every read: audit
rows (`audit_events FINAL`) joined with the lifecycle receipt windows of every published
session (`metrics_active_windows`, materialized CTEs with two self-joins over receipts and
`argMaxIf` per receipt) and with `session_live`. ClickHouse does not drop an unused join,
so `SELECT count() FROM sessions` computed the graph too: 0.57 to 1.0 s on the hosted
instance with 31 to 115 sessions, 4,300 audit rows and 2,000 receipts (2026-09-09
diagnosis), and every session header read, list page, Reuse panel and Team overview tile
paid it. `EXPLAIN` showed 45 joins and 18 aggregations behind a count of `sessions`. The
cost grows with audit and receipt volume, not with sessions; on the host the session page
was at p50 3.3 s and one page load put ClickHouse at 75% CPU.

## Decision

1. **One table.** `ac_trace.session_reads` holds one row per API read credited to a session:
   `(organization_id, session_id, audit_id)` is the key, with `read_at`, `action`,
   `target_session_id` (the zero UUID for `search` and `sql`), `reader_user_id`,
   `reader_email` (the audit row's redacted copy) and `reader_harness`. It is a
   ReplacingMergeTree so a retried flush or a repeated backfill writes no duplicate.
2. **Written by the audit projection.** When the worker projects a batch of audit rows it
   also copies, in the same PostgreSQL transaction and before the outbox checkpoint, the
   rows of `api_ro.attributed_reads` for those audit ids. That view is the single
   definition of an attribution: an audit row that passes `attributedReadRule` (successful
   key-authenticated MCP/REST `search`, `get` or `sql`) joined to `metrics_active_windows`
   on the installation and `active_from <= ts < active_to`. The worker reads it as the
   organization's admin-authority worker principal (user field `worker`) so private sessions
   are attributed too; no view re-derives an edge from audit rows.
3. **Views read the table.** `reuse_edges` is the `get` rows whose target differs from the
   reader (types, names and order unchanged); `session_reuse`, `sessions.reuse_count`,
   `member_impact`, `reuse_source_flags` (`metrics_reuse_sessions`, `metrics_reuse_weekly`)
   and `memory_assisted_sessions` read it through one internal aggregate,
   `reuse_by_target`. `metrics_active_windows`, `metrics_reads` and `audit_sources` keep
   their definitions; they are admin metric paths, not the session read path.
4. **Native fences on the table.** A row policy on `session_reads` requires the caller's
   organization, the audit retention cutoff (`read_at >= retained_after`), a published,
   unpurged source session the caller may see and, unless the target is the zero UUID, the
   same for the target. That reproduces what `session_live ⋈ audit ⋈ session_live` enforced:
   both sessions caller-visible and nonpurged, and reuse history bounded by audit retention.
   Cross-user flags compare `reader_user_id` with the target's owner read from the
   `session_scope` dictionary at query time.
5. **Backfill once.** The maintenance job runs `TraceAuditProjectionService.backfill()`:
   when `ac_trace.backfills` has no `session_reads` row it copies `attributed_reads` for
   every organization over the retained audit history, then records completion and one
   `audit.projection.backfill` row. The migration creates both tables and drops the retired
   `api_ro.get_reads` view.

## Consequences

- Reading `sessions`, `session_reuse`, the Reuse panel and the reuse tiles no longer touches
  `audit_events`, `ingest_receipts` or the window self-joins, so their cost scales with the
  stored reads rather than with audit and receipt volume. On a seeded corpus of 200 sessions,
  5,000 audit rows and 4,000 edges (local ClickHouse 26.8, medians of five reads through the
  reader fence) the `sessions` count went from 428 to 273 ms, the header read from 503 to
  366 ms, the list page from 669 to 376 ms, the reuse tile from 388 to 170 ms and
  `metrics_reuse_weekly` from 677 to 248 ms. What remains above `session_details` (about
  125 ms there) is the per-row direct-dictionary policy lookup over `session_reads`, the
  separate item of the 2026-09-09 diagnosis.
- An edge appears when the projection flushes (every minute, and at once when a batch is
  full), not the instant the `get` returns. A window is evaluated at flush time: a lifecycle
  receipt that arrives later than the flush and would have opened or closed the window is
  not applied retroactively. `metrics_active_windows` stays live for callers who need it.
- The projection flush performs one bounded reader query per organization that has
  candidate rows in the batch; ingest-only batches skip it.
- Attributed reads outlive the audit rows physically (like `audit_events`) and are hidden by
  the retention cutoff; a purged session's rows stay physically and are hidden by the policy.
- `packages/traces` gains `sessionReadColumns`, `appendSessionReads`, `backfillCompleted`
  and `completeBackfill`; the projection service gains a `readers` dependency; requirement
  R-AUD-05 is added.

## Update (2026-09-10, read-path performance pass)

The internal helper views this ADR introduced (`session_reads_base`, `reuse_edge_rows`,
`reuse_by_target`, `reuse_source_flags`, `memory_assisted_sessions`) are no longer separate
`api_ro` views: `reuse_edges`, `session_reuse`, `member_impact`, `metrics_reuse_sessions` and
`sessions` inline the same SQL fragments (one TypeScript definition each in
`packages/traces/src/views/analytics.ts`) so each public view is one query context and reads
`session_reads` once; the target owner comes from the sessions table, not a dictionary. The
migration drops the retired views. Semantics, columns and the `session_reads` table are
unchanged (ADR 0062 records the control-read mechanism).
