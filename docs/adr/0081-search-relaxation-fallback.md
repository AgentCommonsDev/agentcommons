# ADR 0081: Search relaxation fallback for multi-word recall

## Status

Accepted.

## Context

`search` matches with `hasAllTokens(search_terms, q)`: every query token must appear in a
single message. This is precise and index-backed, but on the hosted corpus 70% of agent
searches over a 7-day window returned zero hits. The breakdown showed two causes: single
distinctive tokens that are genuinely absent from a small corpus (not fixable in the engine),
and multi-word natural-language queries whose words are spread across a session rather than
packed into one message. "redaction fingerprint masked" returned nothing at the message level
even though eleven sessions discuss all three across their messages.

Requiring every token in one message is stricter than the mental model an agent uses: "find
the session where X, Y and Z were worked on." The natural document unit for recall is the
session, not the message.

## Decision

Keep the strict message-level matcher as the primary path, and add a **session-level
matcher** (`search_messages_session`) that the service runs only when the strict matcher
returns no hit on a first page of a lexical query. A session matches when the union of its
messages' tokens covers every query token; the view returns every message carrying at least
one query token, ranked by the same length-normalized weighted-token formula, so the block
assembly, per-session cap, highlighting, pagination and totals are identical to a strict hit.

The fallback is deliberately narrow:

- It fires only when the strict result has zero hits, so a search that already works returns
  the exact same result it did before. The change is additive.
- A cursor continuation stays on the strategy that opened its page; a filter-only browse has
  no tokens to relax. Neither triggers the fallback.
- With embeddings on, the strict lexical result is fused with the vector result first; the
  fallback runs only if that combined result is still empty, then re-fuses the session-level
  lexical result with the same (already computed) vector result.

`search_messages_session` is granted to the reader like `search_messages` but is not listed
in `schema_functions`: it is an internal fallback, not a SQL surface. Genuine misses (no
session covers all the tokens) still return empty, which is correct.

## Consequences

- Multi-word queries whose tokens span a session now find it. On the hosted 64k-message
  corpus the session-level view answers the three-token example in ~0.3 s at two threads,
  well under the 5 s reader limit; the fallback only runs on the currently-failing (fast,
  no-match) searches, so it adds no cost to a search that already returns hits.
- Precision is preserved: a session must still contain every query token; it may spread them
  across messages. This is looser than one-message AND but far tighter than OR.
- One more parameterized view and one extra reader query on the zero-hit path. The
  session-level scan reads every message matching any query token (`hasAnyTokens`, still
  index-backed) plus a per-session coverage aggregate; it stays under the reader fence and is
  measured on the ≥40,000-message search-shape fixture (R-SRCH-18).

## Alternatives considered

- **Always session-level.** Cleaner, but it changes ranking and recall for queries that
  already return hits, so it needs a full golden-suite re-validation and risks regressing
  precision. Rejected in favor of the additive fallback.
- **OR with ranking.** Return any message matching any token, ranked by overlap. Highest
  recall, but it drops precision sharply (a three-word query surfaces sessions that mention
  only one word) and scans much more. Rejected.
- **Client-side query splitting.** Have the agent retry with fewer terms. Pushes the work
  onto every caller and does not help the proactive recall path. Rejected.
