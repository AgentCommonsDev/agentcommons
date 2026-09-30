# ADR 0096: Store payload sizes and share repeated search scans

Date: 2026-09-30
Status: Accepted. Refines §4.3 and §7.2; reader limits and publication policies are unchanged.

## Context

A production audit found 26 of 90 searches in one day failing at the 256 MiB reader
memory limit. Containers had no restarts or OOM kills, and trace projection was current.
This was query memory, not host memory exhaustion.

Read-only profiling isolated two unnecessary costs:

1. `message_metadata.payload_bytes` was an aggregate of
   `length(content)+length(tool_input)`. Computing a page's metadata therefore read and
   decompressed the session's full payload, even though it returned only scalar sizes.
   Long sessions made that scan exceed the reader limit. The existing performance
   fixture spread 40,000 short messages across 400 sessions and missed this shape.
2. Ordinary ClickHouse CTEs expand at each reference. Search referenced `candidates`
   from both ranking and its author lookup, and `ordered` from both anchors and
   neighbors. The embedding path also reused `eligible`. These repeated the underlying
   scans and retained additional buffers concurrently.

On the hosted corpus, direct indexed term counts took about 0.2 seconds. A full search
ranked successfully in about 2.8 seconds, then failed with native error 241 while
reading neighboring-message metadata. Materializing the repeated CTEs reduced ranking
to 1.8–2.0 seconds and initially made the sampled searches succeed, but a later sample
still exceeded memory in the single metadata scan. Sharing that scan alone was not a
complete repair.

The same audit recorded 32 caller-authored SQL memory errors. Their statements mostly
selected or filtered full message content, sometimes with joins or session subqueries.
A standalone whole-corpus content predicate also exceeded the limit. Those remain
bounded caller queries: no arbitrary SELECT is promised to fit within 256 MiB. Raising
reader limits, dropping latest-version selection, and weakening publication policies
are outside this repair. Ordered aggregation and smaller blocks were measured but
either still exceeded memory or reached the five-second deadline on the broad content
scan; they are not shipped.

## Decision

- Add the native column `messages.payload_bytes UInt64 MATERIALIZED
length(content)+length(tool_input)`. Native `length` counts bytes, including multibyte
  text and the exact stored JSON string. Every insert, tombstone and redacted revision
  derives its own scalar. This is an internal derived column; explicit insert schemas
  and the public `messages` view do not acquire another field.
- `message_metadata` takes the latest published `payload_bytes` exactly as it takes
  other metadata, through the existing tuple-wrapped `argMax` and native row policies.
  It never reads `content` or `tool_input` to size a page. The same improvement reaches
  get, search and every other consumer of this shared view.
- The migration awaits `MATERIALIZE COLUMN payload_bytes SETTINGS mutations_sync=1`
  before recording `message_payload_bytes_v1` in the native backfill ledger or
  replacing the metadata view. A missing ledger entry retries materialization even
  when a failed attempt already added the column. A completed ledger entry skips it.
  The migration client allows five minutes for historical materialization; reader
  limits stay at five seconds, two threads and 256 MiB.
- Materialize the narrow `candidates`, embedding `eligible`, and neighbor `ordered`
  CTEs once per query. This uses the already-enabled `enable_materialized_cte` setting
  and the already-required ClickHouse 26.8 baseline. Other analytics already use this
  syntax; this change does not introduce a new database version requirement.

## Verification

`apps/api/test/read-memory.integration.test.ts` adds a 40,000-message session with
roughly 320 MiB of payload. On the native reader principals with unchanged limits:

| reader | one search | four searches, wall time |
| ------ | ---------: | -----------------------: |
| admin  |     470 ms |                   766 ms |
| member |     470 ms |                   670 ms |

The native `EXPLAIN PIPELINE` regression requires one physical neighbor metadata scan.
Running the old CTE shape produced two scans and failed that assertion. The native plan
headers must contain `payload_bytes` and no payload columns. These assertions check
actual database plans rather than counting table names in application SQL.

Upgrade verification seeds historical payloads, removes the completed backfill marker,
and simulates interruption immediately after adding the derived column. Re-running the
migration must populate every active historical part, produce exact byte counts, leave
no pending materialization, and record completion once. A subsequent migration creates
no new materialization. Separate checks exercise multibyte text and pending revisions
as both admin and member, ensuring sizes advance only when the corresponding message
revision is published.

The existing short-message performance fixture, lexical golden corpus, teammate rank
boost and embedding ranking tests remain the ranking and output contracts. Deployment
verification checks historical backfill completion and repeats ordinary searches against
production; successful infrastructure health checks alone cannot establish this repair.
