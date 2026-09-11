# ADR 0073: Search normalizes text once at write time, and a timed-out search returns a bounded page

Date: 2026-09-11
Status: Accepted. Refines ADR 0056 (the inflection rule table stands; where it runs changes) and
ADR 0047's "Native lexical semantics" (the text index now covers a stored column).

## Context

On 2026-09-11 18:25:46 UTC the first real agent search after the client heal, MCP `search`
`{query: "judge verbalization attempt classify launch", filters: {repo_name: "honeyforge"},
limit: 6, context: 1}`, failed with `503 READ_TIME_LIMIT` after 5,375 ms; ClickHouse recorded
`TIMEOUT_EXCEEDED` (159) three times that day. The corpus was 77,032 message rows, 40 MB of
`search_text`, 5.7 M tokens, one organization.

`api_ro.search_messages(q)` filtered with `hasAllTokens(<terms>, <normalized q>)` and ranked
over `tokens(<terms>)`, where `<terms>` is `searchTermsSql("search_text")`: lowercase
tokenization followed by the eight `replaceRegexpOne` inflection rules of ADR 0056, evaluated
per row at read time. The `message_terms` text index was defined over that same expression.
Measured read-only on the host as the migration user with the reader's `max_threads=2`:

| query over `ac_trace.messages` (whole organization)                          | seconds |
| ---------------------------------------------------------------------------- | ------: |
| `hasAllTokens(lowerUTF8(search_text),'judge')` (tokenize only)               |    0.34 |
| `hasAllTokens(<terms>,'judg')` (one word)                                    |    30.6 |
| `FINAL … hasAllTokens(<terms>,'judg verbalization attempt classifi launch')` |    27.4 |
| latest-revision `IN (SELECT message_id,max(revision) …)` alone               |    0.10 |

`EXPLAIN indexes=1` showed `PrimaryKey Condition: true, Granules 21/21` and no
`message_terms` entry with or without `FINAL` or the row policy: the index over the expression
was never used by the predicate, so every search re-ran 46 M regex replacements on two threads
behind a 5 s limit. The number of query words and the `repo_name` filter did not matter: the
service joined its filtered `eligible` set with `search_messages(q)`, and a hash join evaluates
the whole right side. The same shape reproduced on a local 40,000-message fixture with 500-byte
messages: every search, filtered or not, admin or member, `READ_TIME_LIMIT` at 5.1 s.

## Decision

1. **The normalizer runs once per row at write time.** `ac_trace.messages` gains
   `search_terms String MATERIALIZED <searchTermsSql("search_text")>`. The migration adds the
   column and runs `MATERIALIZE COLUMN` only when it created it, drops a `message_terms` index
   whose expression is not the column, adds `message_terms` over `search_terms` and runs
   `MATERIALIZE INDEX` only when it created it, so re-running the migration is free.
   `search_messages` filters with `hasAllTokens(search_terms, <normalized q>)`, ranks over
   `tokens(search_terms)`, and narrows both of its scans to the caller's organization key
   range. The query side is unchanged (`searchTermsSql("{q:String}")`), so both sides still
   share the one SQL implementation of the rule table; R-SRCH-02 now checks the column's
   default expression and the index's column. Writers do not compute or send the column.

2. **A timed-out first-page search returns a bounded page instead of a bare 503.** In
   `SearchService`, a `READ_TIME_LIMIT` classified by `traceReadFailure` on a first page (no
   cursor) triggers one second attempt in a fresh fenced read: the same query and filters over
   the 50 most recently active sessions matching the session predicates (one `session_details`
   scan resolves the ids), `context` 0, no continuation cursor. The id array bounds the
   `message_metadata` scan and, as a `WHERE` on `search_messages(q)`, the text scan: verified
   on the host with `EXPLAIN indexes=1` that a `session_id IN (set)` written on the
   parameterized view reaches the base scan's primary-key condition, whereas the join cannot
   bound it. With time-ordered session ids the most recent sessions are the newest primary-key
   ranges. The result carries `partial: { sessions_searched }`; the shared formatter renders
   one line saying what the page covered and to narrow with filters. Continuation pages and a
   failing bounded attempt surface `READ_TIME_LIMIT` as before.

## Alternatives considered

- **Retry the same query with `context: 0` and half the limit under the same fence.** Rejected:
  the scan cost does not depend on `context` or `limit`, the 6.5 s fenced budget leaves about
  1.5 s after a 5 s server timeout, and a same-shape retry doubles the load at the moment the
  server is slowest. It would fail the same way.
- **Make the expression index work (direct read).** Version-dependent (host 26.8, ClickHouse
  Cloud 26.2) and it would still evaluate the regexes for every row the index cannot exclude and
  for the rank. A stored column removes the cost for every shape.
- **Compute the normalized terms in the writer (TypeScript).** A second implementation of the
  rule table; the MATERIALIZED column keeps the one SQL definition.
- **Prefilter the text scan by session set in the normal path.** Verified pushdown makes this
  attractive (set-membership scoping through the primary key); left as a follow-up because the
  normal path is now well under the limit (below) and the change touches the vector path too.

## Consequences

Local fixture (400 sessions × 100 messages, 23.7 MB `search_text`, 9 repositories; the incident
input with `repo_name` alias, medians of 3; 4-way = four concurrent searches, wall time):

| search                      |                     admin ×1 |                   admin ×4 wall |                    member ×1 |                  member ×4 wall |
| --------------------------- | ---------------------------: | ------------------------------: | ---------------------------: | ------------------------------: |
| before                      | 5,127 ms → `READ_TIME_LIMIT` | 5,224 ms, 4 × `READ_TIME_LIMIT` | 5,101 ms → `READ_TIME_LIMIT` | 5,151 ms, 4 × `READ_TIME_LIMIT` |
| after                       |                       600 ms |                          926 ms |                       564 ms |                          709 ms |
| after, two words, no filter |                       482 ms |                                 |                       443 ms |                                 |

Deploying runs `MATERIALIZE COLUMN` and `MATERIALIZE INDEX` once over the messages table (a
mutation; seconds on the hosted corpus). Until they finish, rows not yet materialized read
`search_terms` through the default expression, so results stay correct and only the speed-up
arrives with the mutation. Schema and OpenAPI gain the nullable `partial` field on the search
output; the MCP contract fixture is re-captured.
