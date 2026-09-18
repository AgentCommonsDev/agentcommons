# ADR 0090: Boost and label teammate-authored sessions in search and get

## Status

Accepted.

## Context

AgentCommons exists so an agent finds prior work before repeating it. Production reuse data
shows that a large share of the value is _cross-user_: 28% of reuse edges (`get` reads of a
visible session) are a member reading a session **another** member of the same organization
authored, and the median cross-user target is about **one day old**. That is live knowledge
transfer between teammates, not an agent re-reading its own history — exactly the reuse the
index should amplify.

Two things stood between that data and the agent:

- **Nothing told the reader a hit was a teammate's.** `search` blocks and the `get` header
  carried the author's `user_email` but no signal that the author was someone other than the
  caller, so an agent (or the model reading the result) could not prefer or even notice a
  teammate's prior work.

- **Ranking was author-blind.** Lexical/RRF search ranks purely on relevance. A teammate's
  slightly-less-relevant but directly applicable session could sit just below the page cut,
  never reaching the agent, while the caller re-derived what a teammate already solved.

Members already see every published, public session in their organization regardless of
author (the `control_session_scope` row policy), and `user_id`/`user_email` are already
caller-visible columns exposed by `session_details`. So surfacing and labelling teammate
sessions exposes nothing a caller could not already read; it only changes which visible
sessions reach the page and adds a derived boolean over caller-visible data.

## Decision

**Label every teammate-authored session and boost teammate-authored sessions in search
ranking**, so one member's prior work reaches another.

- **Label (`by_teammate`).** A shared boolean field on the search block
  (`searchBlockSchema`) and the get header (`sessionHeaderSchema`), default `false`, is set
  to `true` when the session's author is a different member of the caller's organization
  (`row.user_id !== caller.userId`; false when the author is the caller or the author id is
  empty). It is derived from `user_id`, an already-caller-visible column, so it discloses
  nothing new. The get path sets it in `assembleHeader` (the row already carries `user_id`);
  the search path adds `user_id` to the one `session_details` hydration select and drops it
  before the strict header parse.

- **Boost.** In the ranked search query, a teammate-authored candidate session's `rank` is
  scaled by a modest constant, **`TEAMMATE_RANK_BOOST = 1.15`**, _before_ the per-session
  cap, the cursor and the page limit — so a teammate session enters the page rather than
  being merely reordered within it. The author of each candidate session comes from one
  bounded scan of a new light reader relation, `api_ro.session_authors`
  (`latestRowsSql(sessions, {session_id, user_id})`, row-policy fenced like every other
  session relation), joined to the candidate sessions only (`session_id IN (candidates)`), so
  it reads only those rows and never scans the corpus. The caller's own id is a bound
  parameter (`caller.userId`), which is byte-equal to the reader principal's user field
  (`unhex(currentUser())`), so the predicate needs no principal scalar.

- **The boosted value replaces `rank` for the rest of the pipeline** (the per-session
  `row_number` order, the page `ORDER BY rank DESC, session_id, seq`, and the keyset cursor,
  which keys on `rank`). Author is a per-session property, so the factor is constant within a
  session: the best hit per session and the intra-session order are unchanged, only the
  cross-session ranking shifts, and the order stays deterministic. Only the rank-ordered
  (lexical or RRF) query boosts; the time-ordered browse (empty query) leaves `rank` at zero,
  is not author-joined, and is untouched.

### Why 1.15, and the golden guardrail

The boost must lift an equally- or slightly-less-relevant teammate session into the page
without displacing a clearly better own-session hit and **without regressing the golden
top-3 hit rate** (R-SRCH-12). 1.15 (a 15% edge) does both: a teammate session wins over an
own session of equal or up to ~15% higher raw rank, but a decisively better own session
still ranks first. The golden suite is authored by, and searched as, a single user, so every
factor there is 1.0 and the golden ranking is unchanged; the constant is calibrated to keep
it that way if teammate authors are later added to the corpus.

## Consequences

- A relevant teammate session now reaches the search page ahead of an equally- or
  slightly-more-relevant own session, and both search blocks and the get header say when a
  session is a teammate's. The boost is caller-relative: the same two sessions order one way
  for their author and the other way for the teammate.
- No new disclosure: `by_teammate` is derived from `user_id`, already caller-visible, and the
  boost only reorders sessions the caller can already see.
- One new light reader view (`session_authors`) scanned once per rank-ordered search, bounded
  to the candidate session ids; it adds no scan to browse and no scan to `get`. Measured under
  the reader limit at four-way concurrency on the ≥40k-message search fixture.
- The keyset cursor and deterministic order are preserved because the boosted value _is_
  `rank` throughout; totals (`count`/`uniqExact` over the candidates) are unaffected, as the
  boost changes rank, not the candidate set.
