# ADR 0065: Scope of the per-organization publication fence for readers

Date: 2026-09-10
Status: Proposed (analysis for a decision; nothing here is implemented). Refines the
"Authorization and queries" section of ADR 0047 (the fence) and §7.5 item 4 of the spec.
The writer-side changes measured below (ingest lock order, publish without the organization
row, zero-record fast path with receipt-only publication) are accepted in §5.2 and are not what this ADR decides.

## Context

ADR 0047 gave every bounded reader callback a shared PostgreSQL advisory lock,
`trace-publication:<organization>`, held from its first statement to the end of the
callback, and gave publication, visibility, purge and redaction-generation changes the
exclusive counterpart. The guarantee: one response never combines two publication
generations, because control (published revision, generation, visibility, purge) cannot
move while the response is being assembled, and ClickHouse's row policies read that control
live (ADR 0062: once per query, not per row).

Production (2026-09-10, `prod-load.md`) showed the cost on a 2-vCPU host: every read held
the fence for its whole 5–6 s ClickHouse query, every accept and every publish took it
exclusively, and one reader every 2 s cut an 8-lane ingest burst from 139 to 52 records/s
while end-batch latency went from 0.4 s to 9.1 s p50. Two things have changed since:

1. Reads are now 50–100 ms class on the same shapes (ADR 0062 set-membership policies, one
   scan per relation, one control read per relation per query; slices perf-policies,
   perf-reads, perf-views, perf-reuse in this tree).
2. Accept no longer holds the fence across redaction and no longer serializes the whole
   organization on the `organization` row; publish no longer takes that row (§5.2, this
   change).

So the question is narrower: with fast reads and a write tail of 20–40 ms, how much does
the shared reader fence still cost writers, and what do readers lose under each alternative?

## Measurements (local, testcontainers PostgreSQL + ClickHouse, API in its own process, 8 uploader lanes, 60 s, 8 turns × 24 Claude Code records per session, one empty sync per turn; `scratchpad/bench/results/*.md`)

| tree                                                                                  | reader    | records/s | ingest p50 / p95 ms | empty batch p50 ms | publish latency p50 (receipt → published)                                           | fence waiters (samples with ≥1 / longest wait) | organization-row waiters           |
| ------------------------------------------------------------------------------------- | --------- | --------- | ------------------- | ------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| before (org row + fence around whole accept; publish takes org row)                   | off       | 93.0      | 896 / 1464          | 893                | 84.3 s (16 of 32 sessions still unpublished after 180 s)                            | 0 / 260, –                                     | 247 / 260, up to 8 waiters, 1.45 s |
| before                                                                                | every 2 s | 62.6      | 1306 / 2232         | 1452               | 86.0 s (8 still unpublished after 180 s)                                            | 45 / 260, 0.33 s                               | 244 / 260, up to 8, 2.17 s         |
| after: lock order and fast path (this change), projection worker still 1 job per poll | off       | 104.5     | 791 / 1215          | 672                | 69.6 s (16 of 40 still unpublished after 180 s: pg-boss fetched 1 job per 1 s poll) | 19 / 260, max 2 waiters, 0.32 s                | 241 / 260, up to 7, 1.35 s         |
| after                                                                                 | every 2 s | 79.0      | 1003 / 1874         | 813                | 63.6 s (8 still unpublished)                                                        | 65 / 260, max 2, 0.65 s                        | 241 / 260, up to 7, 2.28 s         |
| after + projection worker fetches 25 jobs per poll, one publish per session           | off       | 68.8      | 798 / 2573          | 299                | 18.4 s, queue drained 9.6 s after the burst                                         | 59 / 259, max 1, 0.44 s                        | 243 / 259, up to 7, 2.52 s         |
| same                                                                                  | every 2 s | 59.2      | 752 / 3069          | 260                | 14.3 s, drained 4.5 s after the burst                                               | 129 / 260, max 2, 0.60 s                       | 243 / 260, up to 7, 2.91 s         |
| final code (same locks, worker fetch 25), later run                                   | off       | 106.7     | 730 / 1708          | 151                | 18.8 s; time to visible 23.8 s p50, drained before the burst ended                  | 123 / 260, max 2, 0.46 s                       | 244 / 260, up to 7, 1.51 s         |
| final code                                                                            | every 2 s | 91.2      | 733 / 2095          | 91                 | 17.1 s; time to visible 24.3 s p50                                                  | 167 / 260, max 3, 0.50 s                       | 247 / 260, up to 7, 2.00 s         |
| final code with the worker fetch put back to 1 (cadence control)                      | off       | 101.6     | 736 / 1770          | 149                | 135 s; time to visible 150 s p50, 163 s drain: the poll cadence, not a lock         | 116 / 260, max 2, 0.32 s                       | 248 / 260, up to 7, 1.75 s         |

Reader latency in the same runs: `GET /sessions?limit=50` p50 461 ms before, 407 ms after,
817 ms with the batched worker (the worker's publishes share the API's event loop);
`GET /sessions/{id}` 461, 457 and 677 ms. Readers never failed. The API process is
CPU-bound in every run (p50 100–124 % of one core), so the ingest ceiling is redaction,
JSON and projection work in one Node process, not PostgreSQL locks: with the worker
draining promptly, the same CPU is shared between accepts and publishes and ingest
throughput drops while time-to-visible falls from more than 180 s to 14–18 s.

What the fence still costs, from the after runs: a waiter in 19–129 of 260 samples (7–50 %
of the time), never more than 2 waiters, longest wait 0.32–0.65 s; the organization row
still has up to 7 waiters in 93 % of samples because the full-path write tail (about 20
PostgreSQL round trips) runs on a saturated event loop and takes 1–3 s per batch. Empty
batches, which take no fence and no organization row, fell from 893 ms to 260–299 ms p50.

## Options

### A. Keep the shared reader fence as is

Readers hold the fence for the whole callback; writers (accept write tail, publish, purge,
visibility, maintenance) take it exclusively. Consistency: a reader mid-publish sees either
the old or the new generation for every query of its response (header and pages agree).
Cost: a writer waits for the longest reader in flight; a reader waits for the write tail.
With 50–100 ms reads and 20–40 ms write tails this is a few tens of milliseconds per
collision; the bench above quantifies it (fence column). Risk: one slow reader (a 5 s
`sql` query, a CSV export, a cold dashboard) still stalls every accept and publish of the
organization for its duration; `lock_timeout 6s` on the reader side bounds only the
reader's own wait.

Tests that already prove it: the two-reader-plus-publisher test on a three-connection pool
(ADR 0047), `ingest-contention.integration.test.ts` (accept blocks on the fence only at its
writes), `trace-ingest.integration.test.ts` (publish blocked by a visibility change).

### B. Readers take no fence; rely on publish ordering and a per-query control snapshot

Publish already inserts rows before it bumps `published_revision`, and every guarded
ClickHouse query reads control once (ADR 0062), so a single ClickHouse query is internally
consistent without any PostgreSQL lock. What changes: a _response_ built from several
queries (the `get` header then its message pages; `search` hits then context and headers;
a dashboard's tiles) may observe two generations: e.g. a header with `message_count` 120
and a page listing 122 messages, or a session that is visible in the list query and gone
(purged, made private) in the header query of the same response. A rescan mid-flight
could show pre- and post-redaction text of the same session in one search response.
Writers never wait for readers; readers never wait for writers. Gain: removes the fence
column entirely from the writer side and one PostgreSQL round trip plus one transaction
from every read (the compact control reads of §7.5 item 4 could stay in an ordinary
transaction).

Tests that would prove it: a reader holding a paused callback between its header and page
query while a publish commits must produce a header/page pair whose disagreement is
detected and reported (`X-Publication-Revision` on every page equal to the header's, or
the page re-read against the header's revision); a purge committing between list and
header must yield 404 on the header, never content; the existing consistency test
(ADR 0047, two readers plus a publisher) would be rewritten to assert per-query
consistency plus the cross-query rule chosen. Risk: every multi-query response needs an
explicit revision pin (the views can filter `revision <= {pinned}` only if the pin is
passed as a parameter, which the SQL guard would have to allow for internal queries).

### C. Readers take the fence only around the control read

The reader takes the shared fence, reads the organization's control rows it needs (published
revision and generation per session, visibility, purge) into the transaction, releases the
fence (commit the short transaction), and then runs its ClickHouse queries pinned to that
snapshot: `revision <= {published}` and `generation = {generation}` per session passed as
parameters, or, for list-shaped queries, the control snapshot passed as an external table.
Consistency for a reader mid-publish: the response is exactly the snapshot it read, for
every query, including a session purged after the snapshot (it would still be served from
the pinned generation until the physical purge, so purge would need an unfenced live check
before returning content, as the light session state check does today). Writers wait for a
reader only for the control read (single-digit milliseconds). Gain versus A: the fence
column goes to the control-read duration; versus B: multi-query responses stay
generation-consistent.

Tests that would prove it: the existing two-reader-plus-publisher test with the publish
committing after the reader's control read and before its ClickHouse query, asserting the
reader sees the old generation throughout; purge after snapshot returns 404 for content;
policy snapshot views must not read control again (ADR 0062's control read would move
from the policy into the pinned parameters, or the policy would accept the pinned values).
Risk: the row policies currently _are_ the control read; pinning means either a second
mechanism (parameters the guard must accept) or a per-query SETTINGS carrying the pin,
and the views join control for per-session metadata (parent link, lifecycle, owner) which
would then come from the snapshot rather than live rows.

## Recommendation (for the decider)

Take A for now and revisit with production numbers after this change ships: the bench shows
the fence's remaining cost is at most two waiters and a 0.65 s longest wait in a saturated
8-lane burst, while the organization row (up to 7 waiters, 2–3 s) and the CPU ceiling of one
Node process were the actual limits. B trades a real, testable
guarantee (one response, one generation) for a gain that the after runs bound at the fence
column above; C keeps the guarantee but needs the row-policy/pin redesign, which is a larger
change than the gain justifies until a slow reader class (CSV export, long `sql`) is shown
to stall writers in production after the read fixes. The measurement to watch in production
is the fence wait time from `pg_locks` (advisory, `trace-publication:<org>`) against the
publish audit duration; if readers above one second reappear (exports, dashboards), bound
them first (§7.6 already streams CSV per page; a per-page fence would follow from C).
