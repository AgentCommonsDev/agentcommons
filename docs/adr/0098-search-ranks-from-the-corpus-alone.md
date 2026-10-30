# ADR 0098: Search ranks from the corpus alone

Date: 2026-10-29
Status: Accepted. Refines §4.2, §7.2, §7.4 and §7.5 and ADR 0092/0096; reader limits are unchanged.

## Context

By late October 2026 the hosted corpus held 13,216 visible sessions and 1.76 M messages, growing
by about 270,000 messages a week. Every `search` that had at least one hit failed with
`READ_MEMORY_LIMIT`, with or without filters, including a filter to a single `session_id`; only a
query with no hit succeeded. Transcripts show 15 to 41 root sessions a day hitting the error.

The text match was cheap: `search_messages(q='memory limit')` returned 1,066 hits in 0.5 s. The
candidate stage was not. It built `eligible` from `message_metadata`, the latest-revision
aggregate (`FINAL` + `GROUP BY` + per-column `argMax`) of every message in the organization, and
only then joined it to the text matches. Session filters arrived as an `IN (subquery)` and message
filters applied to the aggregate's output, so no filter narrowed it. Its cost grew with the
corpus, and it crossed the 256 MiB reader limit as the corpus grew. ADR 0096's verification
fixture had 40,000 messages. ADR 0092 built `messages_current` so search would not pay this
aggregate; the eligible scan paid it anyway.

A one-word query can match a quarter of the corpus (`the`: 441,791 messages; `test`: 165,414),
so ranking with window functions over every candidate would hit the same limit once the candidate
stage stopped doing so.

## Decision

- `messages_current` carries the message metadata every non-payload filter tests:
  `message_time` (`coalesce(timestamp, received_at)`), `tool_name`, `tool_use_id` and `model`.
  Publication, the backfill and the reconcile below copy them from one shared expression map.
- `search_messages` and `search_messages_session` return each match's `message_id`, `role`,
  `kind` and that metadata after `(session_id, seq, rank)`. A new internal `search_corpus`
  relation returns every live corpus message for a search without a query and for the message
  side of session-list filters. Neither reads `messages`.
- The filter planner splits predicates three ways: session (`s`), corpus (`m`) and payload
  (`p`, `content` and `tool_input`). A payload predicate is a semi-join on `message_id` against
  `messages`; for a query it is bounded to the sessions the text matched, which reaches the
  primary key.
- Ranking aggregates candidates per session: `groupArraySorted(3)` keeps each session's best
  three (one for a browse) and `count()` its hits; the totals are window sums over those
  per-session rows. Memory grows with matching sessions, not matching messages. The teammate
  boost multiplies a session's ranks by one constant, so it is applied after the per-session cut
  without changing which candidates survive, and the boosted rank still drives the page order and
  the keyset cursor.
- A lexical cursor position no longer carries `time`, which it never ordered on; a browse
  position does. The position is a union of the two shapes.
- The session-level matcher keeps each session's distinct matched tokens with
  `groupUniqArrayArray` instead of an array per matching message.
- A first-page search that exceeds the memory limit makes the same bounded 50-session attempt a
  time-limited one does.
- The SQL schema reference stops teaching `search_messages(...) JOIN messages` and
  `JOIN sessions`, which fail on the hosted corpus, and teaches the semi-join
  `session_id IN (SELECT session_id FROM search_messages(...))` and reading a hit's text by
  literal `session_id` and `seq`.

### Filling existing rows

`ALTER TABLE … ADD COLUMN` leaves existing corpus rows with null metadata. The migration cannot
backfill them safely: the previous release keeps publishing while the migration runs, and its
corpus inserts omit the new columns, so rows it writes at the published revision would replace
backfilled ones. Instead, worker maintenance (at startup and every ten minutes) runs
`reconcileCurrentMetadata`: it picks up to 200 sessions with a live corpus row whose
`message_time` is null and re-copies those rows from the `messages` row of the same revision.
That is the row their publication or backfill copied, and the ReplacingMergeTree keeps the later
insert of an equal version, while a newer publication still wins. It reads no control, so the
writer principal runs it. It repeats until a batch comes back short, up to 200 statements a tick.

Until a row is reconciled it is stale, never wrong: SQL comparisons with a null `message_time`
are false, so the row is absent from `since`/`until` results, and a browse skips it because a
message without a time has no place in a time order. A query without time filters is complete
from the first request. `message_time` stays `Nullable` after the reconcile; its null means "not
yet copied", not a missing value.

## Consequences

- No search stage reads the organization-wide latest-revision aggregate. The remaining
  corpus-sized costs are a payload condition without a query (a content scan by nature), the
  embedding path's eligibility set and lexical row numbering (embeddings are off on the hosted
  instance; both now read the corpus rather than the aggregate), and the context stage, which
  numbers every message of each page session through `message_metadata`.
  The hosted maximum is 7,702 messages a session, so a full page reads at most about 130,000
  metadata rows; `read-memory.integration.test.ts` covers a 40,000-message session.
- `search_messages` gains columns after its original three, so existing `SELECT session_id, seq,
rank` callers are unaffected.
- `sql` over the `messages` view still pays the latest-revision aggregate for every session it
  reaches. That is out of scope here; the schema reference now says so and shows the narrow form.

## Verification

`apps/api/test/search-scale.integration.test.ts` seeds 2,000,000 messages in 400 sessions of
5,000 (longer than the hosted 99th percentile of 1,683) under the unchanged 256 MiB, five-second,
two-thread reader profile. As admin and member, alone and four at a time:

| search                                                         | before (main)      | after  |
| -------------------------------------------------------------- | ------------------ | ------ |
| one word matching all 2,000,000 messages                       | 259 MiB, error 241 | passes |
| rare word (20 hits); same word narrowed by repo, tool and time | 258 MiB, error 241 | passes |
| browse, one repository (1,000,000 messages)                    | passes             | passes |
| rows lacking metadata, then reconcile                          | error 241 (search) | passes |

The reconcile case rewrites one session's corpus rows without metadata, as an older release
would, and checks that a time-filtered search misses them, that one reconcile repairs exactly
that session, and that the next finds nothing to do.
`search-shape.integration.test.ts` checks the memory-limit bounded attempt and that a cursor
continuation keeps `READ_MEMORY_LIMIT`.
