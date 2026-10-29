# ADR 0099: Attribution is bounded to its batch

Date: 2026-10-29
Status: Accepted. Refines ADR 0060 and §10; the attribution rule is unchanged.

## Context

On the hosted instance the audit projection stopped on 2026-10-19 at 20:25 UTC: no
`session_reads` or `metrics_reads` row is newer, so reuse counts, search adoption and every
dashboard tile built on them have been frozen since, while sessions kept arriving.

Each flush appends up to 100 audit rows and then reads `api_ro.attributed_reads` for the
attributable ones before deleting them from the outbox. That relation joined the batch to
`metrics_active_windows`, which derives every session's windows from every ingest receipt
in the organization: the latest-revision aggregate of all receipts, a join of each receipt to
its session's earlier lifecycle receipts, and a final aggregate over all observations. The
audit-id filter reached only the outer query. As the receipt history grew the relation
crossed the 256 MiB reader limit (unbounded, it exceeds the limit on its own when read as a
member), the flush failed, its transaction rolled back, and the same head-of-outbox batch
failed on every later tick.

## Decision

- `attributed_reads` takes the audit ids it credits as a parameter
  (`attributed_reads(audit_ids=…)`). It reads those rows, the handshakes of their
  installations, and windows derived only for sessions that could admit them.
- A read at `ts` is admitted by a window that opened at most the rule's window length
  (`attributedReadRule.windowHours`, six hours, now part of the rule rather than a literal)
  before it or `observationAfterSeconds` after it. Every receipt that can open such a window
  belongs to a session on the read's installation whose control `last_activity_at` advanced
  to at least the receipt's arrival, so the relation keeps sessions on the batch's
  installations that were active after the earliest read's horizon and started before the
  latest read's, with a day either side for client clocks. That set bounds every receipt,
  lifecycle and session read; the receipts' primary key starts with the session.
- `metrics_active_windows`, the public view, is generated from the same function with no
  bound and is unchanged.
- The one-time backfill pages through each organization's attributable audit events in
  flush-sized pages and calls the same relation, instead of reading it without a filter.

## Consequences

- A flush reads in proportion to its batch's installations and time span, not to the
  receipt history. The handshake lookup still scans the retained audit rows of the batch's
  installations, a narrow streaming aggregate bounded by audit retention.
- After deploy the stuck batch succeeds and the outbox drains, 100 rows per flush with an
  immediate re-flush while batches are full, so the frozen metrics catch up on their own.
- A receipt whose client clock is more than a day ahead of its upload could open a window
  this bound no longer considers. Attribution is a metric, and such a window was already
  misplaced in time.
- `metrics_active_windows` and `audit_sources`, read by dashboard tiles, still derive every
  window of the organization; they are separate read paths and remain caller-bounded queries.
- The flush still holds back the whole outbox when attribution fails for any reason. A lag
  alarm on the outbox, which nothing reports today beyond Admin → Status
  `pending_audit_events`, is the remaining guard.

## Verification

`apps/api/test/attribution-scale.integration.test.ts` puts 2,000 sessions of 300 sync
receipts each (600,000 receipts) on one installation, then queues a handshake and 50 MCP
`get` reads during the newest session. On `main` the flush fails with native error 241
("would use 259.53 MiB … maximum: 256.00 MiB"), as on the hosted instance. With this change
the outbox drains and every read is credited to the newest session. The existing
attribution suite (`trace-audit.integration.test.ts`) passes unchanged.
