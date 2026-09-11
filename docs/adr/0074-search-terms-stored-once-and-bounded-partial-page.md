# ADR 0074: Search terms are stored once; a timed-out first page is answered with a bounded partial page

Date: 2026-09-11
Status: Accepted. Refines §7.2 and §7.5 (search) and the read-path rules in AGENTS.md; the
inflection rule table of ADR 0056 stands, it is evaluated at write time instead of per query.

## Context

On 2026-09-11 18:25 UTC the first agent search after the client heal failed on the hosted
instance with `READ_TIME_LIMIT` after 5.4 s: five words, a `repo_name` filter, limit 6. Read-only
isolation on the host (77,032 message rows, 40 MB of `search_text`, `max_threads=2`) showed the
cause was the query shape, not the corpus: `api_ro.search_messages(q)` filtered with
`hasAllTokens(<terms>, q)` where `<terms>` is the ADR 0056 normalizer, lowercase tokenization plus
eight `replaceRegexpOne` calls per token, evaluated per row on every search. Tokenizing alone took
0.34 s; the same predicate over the normalizer took 30.6 s for one word and 27.4 s for five. The
`message_terms` text index over that expression was never used (`EXPLAIN indexes=1`: primary key
condition `true`, 21/21 granules, no index entry). The service joins the eligible sessions to the
text scan with a hash join, so a `repo_name` filter never narrowed the scan.

## Decision

1. `ac_trace.messages` carries `search_terms String MATERIALIZED <normalizer(search_text)>`; the
   migration materializes the column and re-creates `message_terms` over it, running
   `MATERIALIZE COLUMN` / `MATERIALIZE INDEX` only when it created them. `search_messages` filters
   and ranks over the column. One SQL implementation of the rule table still defines both the
   column and the query side.
2. A `READ_TIME_LIMIT` on a first search page triggers one bounded attempt in a fresh fenced
   read: the 50 most recently active matching sessions bound the metadata scan and, as a `WHERE
session_id IN (...)` on `search_messages`, bound the text scan by primary key; `context` is 0
   and there is no cursor. The page carries `partial: { sessions_searched }` and the MCP formatter
   renders one note line. Continuation pages and a failing bounded attempt keep
   `READ_TIME_LIMIT`. A same-shape retry was rejected: scan cost does not depend on `context` or
   `limit`, only about 1.5 s of the fence remains after the first failure, and retrying doubles
   load when the server is slowest.

## Measurements

Local 40,000-message fixture, the incident input, admin and member readers:

|        |        admin x1 |  admin x4 (wall) |       member x1 | member x4 (wall) |
| ------ | --------------: | ---------------: | --------------: | ---------------: |
| before | 5,127 ms, fails | 5,224 ms, 4 fail | 5,101 ms, fails | 5,151 ms, 4 fail |
| after  |          600 ms |           926 ms |          564 ms |           709 ms |

On the host the text scan is expected to fall from more than 5 s to 0.35 to 0.5 s; verify after
deploy with `SELECT count() FROM api_ro.search_messages(q='judge')` as the reader and
`system.mutations` for the materialization.

## Consequences

Search cost no longer grows with the size of the normalizer rule table. Requirement R-SRCH-02 is
reworded and R-SRCH-16 covers the partial page. A follow-up may apply the verified session-set
pushdown to the normal path, which also touches the vector path.
