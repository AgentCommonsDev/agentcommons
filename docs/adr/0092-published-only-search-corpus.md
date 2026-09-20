# 0092 — Published-only search corpus (messages_current)

## Status

Accepted.

## Context

Read-only profiling of zpghl prod (2026-09-18, t4g.large, 2 vCPU) found the dominant read cost is CPU-bound full-corpus search, not the control/dictionary path (ADR 0062 already made control a single live read, ~5–13 ms warm). The relaxation fallback (ADR 0081 — the hot path for agent natural-language recall) ran ~1.8–2.5 s for common tokens and failed at 4-way concurrency (rc=159 TIMEOUT_EXCEEDED at the 5 s reader limit).

The waste is structural: `messages` is `ReplacingMergeTree ORDER BY (organization_id, session_id, message_id, generation, revision)` — generation and revision are IN the sort key, so FINAL cannot collapse across revisions. Every search pays a full ~240k-row `(message_id,revision) IN (SELECT message_id,max(revision) … GROUP BY message_id)` "latest" pass (twice in relaxation) even though only 48 of 239,933 message_ids have more than one revision. Dropping `latest` −22%, dropping FINAL −33%.

Rejected — change `messages` in place to `ReplacingMergeTree(revision)`: UNSAFE. The write model keeps PENDING rows (revision > published_revision): build() writes a plan's rows at plan.revision before publish() advances publishedRevision; the row policy hides pending via revision ≤ published_revision. Under version=revision the pending (higher) row wins the background merge and physically replaces the published row; the policy then hides the surviving pending row → the message disappears from ALL reads (search and get). A rescan rewrites every message of a session as pending, so during its build+pending window the whole session vanishes. Reproduced twice on a throwaway CH 26.8.

Rejected — move control (published_revision/generation/purged/visible) into ClickHouse: control is not the bottleneck (~5% of the 5 s search shape; the scan is ~95%), and visibility/purge are single Postgres UPDATEs read live through the ENGINE=PostgreSQL control table, so they propagate atomically; denormalizing mutable control onto rows would need an async ALTER UPDATE per flip and could leave a purged/hidden session readable during the window.

## Decision

Add a separate published-only search corpus `messages_current`: `ReplacingMergeTree(revision, deleted) ORDER BY (organization_id, session_id, message_id)`, carrying only the search columns (seq, role, kind, searchable, search_terms) plus revision and the deleted tombstone, with the `message_terms` text index over search_terms. search_terms is copied from the `messages` row's materialized column, so the corpus stores no raw searchable text.

The worker advances the corpus at publish, AFTER control commits the published revision — never during build — so only published rows (revision ≤ published_revision) ever enter and no pending row can win a merge and be hidden. Normal ingest: copy this publication's projected rows (live deltas deleted=0, normal tombstones deleted=1) from `messages`. Rescan (a full-generation rewrite): copy the full new generation, then tombstone messages present in the previous published generation but absent from the new one (the generation clause `messages` relies on to hide them does not exist on the corpus).

`search_messages` and `search_messages_session` read `messages_current` with one FINAL scan and no `latest` GROUP-BY: FINAL resolves the latest published revision per message intrinsically (revision is the version, out of the sort key) and drops tombstones (search also filters `searchable AND NOT deleted`). The primary `messages` table, the get/read-model/tree/CSV path (full revision/generation fidelity + the pending bridge for get) and control are unchanged.

The corpus row policy fences organization + published (revision ≤ published_revision, fallback 0) + unpurged (fallback 1) + caller-visible, reading `control_session_scope` live in Postgres, with no generation clause (the corpus is always current-generation). Isolation, purge and visibility are byte-identical to `messages` and propagate to the next search with no reproject.

The corpus is fully rebuildable from `messages` + control by an idempotent backfill (`currentBackfillSql`): the migration's one-time population (guarded by the `messages_current_v1` backfill ledger) and the repair path. A failed publish-time corpus write leaves search stale for that delta — never wrong and never an isolation break — is audited (`trace.search.corpus` with session/revision/generation/rescan), and is repaired by re-running the backfill (a rescan of a session also self-heals it).

## Consequences

- Relaxation search drops well under the 5 s reader limit at 4-way concurrency (measured byte-identical and ~2.4× faster than the messages path on a 120k-message throwaway fixture; ~0.7–1 s projected on the prod 2-vCPU corpus, better on the t4g.xlarge the box was resized to).
- One extra table (search columns only, no payload), one small INSERT per publication, and a physical-cleanup addition to purge. Write amplification is benign: 300 per-publish inserts collapsed to 4 active parts / ~32 KiB after background merges; no tiny-part mitigation needed at current cadence (revisit only if a single organization sustains very high publish rates).
- New failure mode is search STALENESS (not incorrectness) if the publish-time write fails; audited and repaired by the idempotent backfill.

## Follow-up: periodic reconcile of messages_current

Optional, not required. A periodic job could reconcile `messages_current` against `messages`+control for any organization with a recent `trace.search.corpus` (503, stale) audit, re-running the scoped backfill. It is a belt-and-suspenders measure: publish-time writes rarely fail, each failure is audited with the session/revision/generation to target, and a later rescan of the same session self-heals it. Warranted only if those audits show real drift accumulating.
