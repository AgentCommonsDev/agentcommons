# ADR 0062: Row policies read session control once per query, not once per row

Date: 2026-09-10
Status: Accepted. Refines the "Authorization and queries" and "Native boundary experiments"
sections of ADR 0047; the fences, their freshness and the fail-closed rule are unchanged.

## Context

Every corpus table (`messages`, `raw_records`, `sessions`, `session_files`, `ingest_receipts`,
`receipt_redactions`, `message_chunks`, `session_embeddings`), `session_identities`,
`audit_events`, `session_reads` and `control_metrics_health` carried a native row policy of
the form `dictGet('ac_trace.session_scope', (...eight attributes...), (organization_id,
session_id))` evaluated for every scanned row. The `COMPLEX_KEY_DIRECT` dictionary is fast
for one key (6 ms) or a page of keys (137 keys in 48 ms; PostgreSQL itself answers 85 keys in
0.5 ms), but the per-row form asks PostgreSQL once per block for every block a scan touches.
Measured on the production host (ClickHouse 26.8, 2 vCPU) over `ac_trace.messages` with
37,405 rows of one organization:

| predicate over `ac_trace.messages`                                       | time    |
| ------------------------------------------------------------------------ | ------- |
| `organization_id = X` only                                               | 0.005 s |
| shipped policy (two per-row `dictGet`, generation and revision)          | 1.795 s |
| same semantics as set membership plus one per-query control read (below) | 0.056 s |
| `raw_records` (45,973 rows) per-row `dictGet`, revision bound only       | 1.074 s |

Real users paid this on every read: over 24 hours `get` (the session page) had p50 3.2 s and
61 failures of 487, `sql` p50 1.5 s, `sessions.list` p95 4.0 s and dashboard renders p50
5.1 s, against reader principals limited to `max_execution_time=5`, `max_threads=2` and
256 MiB. A controlled load test on the host (2026-09-10, 05:49 to 05:53 UTC) put the
cost where it lives: the PostgreSQL container ran at 115 to 168% CPU while ClickHouse sat at
28 to 55%, and `pg_stat_activity` showed two to four concurrent `COPY (SELECT
"organization_id","session_id","published_revision",... FROM trace_control.session_scope
WHERE ...)` statements from the dictionary source at 270 to 900 ms each: the direct
dictionary fetches up to 8,192 keys per block, planned as an OR chain or bitmap filter. A
test organization with 65 sessions, 1,537 messages, 1,527 raw records and 1,033 audit rows
had `SELECT s.* FROM api_ro.sessions ORDER BY started_at DESC LIMIT 51` read 48,076 rows
(the view stack scans each base table several times) and exceed the 5 s limit, and
`sessions.list` returned 500 for 45 of 73 calls in five minutes at 8-way concurrency. The
target is therefore one control fetch per guarded relation read per query, never per block,
and a fetch that costs the caller's organization only. The cost grows with scanned rows (about 13 µs per row: 1M messages would take
about 50 s), while a per-query control read grows only with the organization's sessions.

## Decision

1. **One control read per query and predicate shape.** A policy fetches the caller's
   organization's control rows that satisfy its condition as constant arrays through one
   scalar subquery, `(SELECT (groupArray(session_id), groupArray(redaction_generation),
groupArray(published_revision), groupArray(embedding_revision)) FROM
ac_trace.control_session_scope WHERE organization_id = <caller> AND <condition>)`, and
   looks each row's session up with `transform(session_id, ids, values, fallback)`, a hash
   lookup per row. ClickHouse evaluates the scalar once per guarded table read inside each
   DEFINER view it composes (measured: `count() FROM messages` makes 2 control reads,
   `count() FROM sessions` 11, where the per-row form made 20 dictionary round trips for the
   same count); an `IN (subquery)` set is evaluated per view the same way, so it would not
   reduce that number. `mapFromArrays(...)[key]` was rejected
   because `arrayElement` on a Map scans its keys linearly per row (380 ms for 40k rows
   against 20k sessions versus 33 ms for `transform`, 2.8 s for `has()`); an `IN (subquery)`
   set is as fast per row but is built per table read, and any policy subquery over the
   `dictionary()` table function is rejected under the reader settings anyway (`Not enough
privileges ... CREATE TEMPORARY TABLE ON *.*` for the view owner, then `Cannot execute
query in readonly mode` once granted, since readers run `readonly=1`).
2. **Fallbacks fail closed.** A session absent from the arrays yields `toInt64(0)` for a
   revision bound (`revision > 0 AND revision <= 0` is false) and `toInt64(-1)` for the
   generation (no stored generation is negative). A missing, empty or unreachable control
   source therefore hides every row, as before.
3. **Same predicates, table by table.** `organization_id = <caller>`, `revision > 0`,
   `generation = redaction_generation`, `revision <= published_revision`, unpurged, public or
   admin, for corpus tables; the exact completed embedding epoch whose source is the published
   revision plus operator capability, organization opt-in and (SaaS) paid entitlement for
   vector tables; admin plus published and purged for the identity skeleton; admin or own
   rows or a successful `get` of a published visible session, within audit retention, for
   `audit_events`; retention plus a published, unpurged, caller-visible source and target for
   `session_reads`; admin plus published for `control_metrics_health`. One builder
   (`sessionScopeLookup` in `packages/traces/src/security.ts`) produces every lookup;
   `control_installations` keeps its keyed `installation_scope` `dictGet`, which costs one
   round trip per block over a table of a few dozen rows, and `audit_retention` keeps its
   single constant-key `dictGet`.
4. **The control source is a PostgreSQL-engine table, not the dictionary.** Reading a
   `COMPLEX_KEY_DIRECT` dictionary through the `dictionary()` table function loads the whole
   source: with 50,100 control rows across two organizations, `SELECT count() FROM
dictionary('ac_trace.session_scope') WHERE organization_id = <100-row organization>` took
   176 to 211 ms, the same as the unfiltered read (185 to 248 ms), so a small organization
   would pay for every other organization's sessions on every query. The migration now
   mirrors the ten policy columns of `trace_control.session_scope` as
   `ac_trace.control_session_scope` (`ENGINE=PostgreSQL`, the same control credentials as the
   dictionary source); ClickHouse pushes the constant organization filter to PostgreSQL and
   the same read takes 8 to 12 ms regardless of the other organization's size. The wide
   `session_scope` dictionary stays for the keyed metadata lookups the views make. The
   table has its own `trace_scope` policy (`organization_id = <caller>`) like the other
   control tables; the reader roles have no grant on it.
5. **Migration.** Every policy is `CREATE ROW POLICY OR REPLACE`, so a re-run replaces each
   table's policy in place with no window without a policy; nothing is dropped first. The
   syntax (`transform`, `groupArray`, `tupleElement`, scalar subqueries, `ENGINE=PostgreSQL`)
   is available on ClickHouse Cloud 26.2.

## Consequences

- On a 400-session organization with 44,000 message rows (integration containers, 4 vCPU):
  `SELECT count() FROM messages` 1,081 to 96 ms (admin) and 1,119 to 100 ms (member);
  `message_metadata` count 1,096 to 62 ms; the session page (`messages WHERE session_id
ORDER BY seq LIMIT 50`) 488 to 87 ms. Session-level reads (`count() FROM sessions`, the
  header, the list page, `metrics_reuse_sessions`) move by -6 to +50 ms (150 to 400 ms): each
  guarded table read inside the composed view now costs one 5 to 8 ms pushed-down control read
  instead of one 2 to 3 ms dictionary block lookup, and `session_details` reads `session_base`
  three times; their cost is the views' composition and per-session metadata `dictGet`s, not
  the policies. With 50,000 control rows in another organization, the old form failed the
  message count at 5.2 s with PostgreSQL `canceling statement due to statement timeout`
  (a block of 8,192 keys against the 50k-row control view); the new form is unaffected.
- A differential test (`packages/traces/test/security.integration.test.ts`) keeps the old
  per-row predicate text as a literal, applies it, and asserts that owner, member,
  foreign-organization, worker, unentitled and SaaS principals see exactly the same rows of
  every guarded table as under the new policies, on a fixture with public, private, purged
  and rescanned sessions, unpublished revisions, stale and current embedding epochs,
  retention-expired audit and read rows; the expected sets are also asserted directly.
- Operators re-run the trace migration on deploy as before. It creates
  `control_session_scope` before the policies that read it; a deployment whose PostgreSQL
  control role cannot read `trace_control.session_scope` fails closed on every read, as it
  did with the dictionary.
- Applied to the views the same day (read-path performance pass, `perf-views`): the
  `control_session_scope` table's own row policy now admits only the caller-visible sessions
  (published; public and unpurged for members; everything published, purged included, for
  admins), so one unconditioned scalar text `(groupArray(session_id), redaction_generation,
published_revision, embedding_revision, purged, embeddings_enabled,
embedding_source_revision, paid_embeddings)` serves every policy and ClickHouse evaluates it
  once per query context however many guarded tables that context reads (measured: two
  guarded tables in one definer view cost one control read; a nested definer view costs its
  own). The session views read their per-session metadata (parent link, lifecycle,
  ownership) by joining that same table once per branch, with each session's caller-visible
  child count computed in the same read; member email/name and machine hostname come from
  two further engine tables (`control_user_scope`, `control_installation_scope`, over the
  existing `trace_control.user_scope` and `installation_scope` views, guarded by the same
  member-visibility rule as `control_installations`) joined once per query; the
  `session_scope` and `user_scope` dictionaries are no longer read by any view. Public views
  are one query context each (`sessions`, `session_details`, `session_state`, `messages`,
  the reuse relations inline their fragments), and relations that read only projection columns
  (`messages`, the reuse and search metrics, the audit-derived analytics) take the policy-filtered
  projection rows with no control join at all, so a `sessions` query makes 6 PostgreSQL
  statements as an admin and 5 as a member (three control reads, the two scope tables and the
  retention lookup; the previous stack made 16 to 65, most of them per-block dictionary
  lookups) and scans the sessions table twice (rows, and two columns for parent titles; the
  previous stack scanned it three times and the identity relation three times, with 12 to 19
  dictionary lookups per row). On the 400-session / 44,000-message fixture `count() FROM
sessions` went from 236 to 111 ms, the list page from 399 to 147 ms, the header from 299 to
  171 ms, the reuse tile from 179 to 63 ms and the per-person tiles from 210 to 104 ms; the
  message paths, whose cost is the row scan, stay within noise.
