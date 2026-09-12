# ADR 0078: A search page with no hit carries its next step in the structured result

Date: 2026-09-12
Status: Accepted. Revisits ADR 0070 decision 4 ("a next-step line in the search result
text would not reach Claude Code's model") with a production measurement.

## Context

ADR 0070 established that Claude Code hands its model each MCP result's `structuredContent`
JSON, not the text rendering, and therefore did not ship a next-step line in the search
result text; every zero-hit first call in that bench was followed by a successful second
query without one.

Production (hosted instance, organization `zpghl`, read on 2026-09-12 after the search
time-limit fix of 2026-09-11 19:39 UTC) says otherwise. Six agent `search` calls came in
through MCP from Claude Code (three sessions, two installations). Three returned hits (3,
2 and 5 page hits); three returned none: two words with a `repo_name` filter, one word with
`role` and `session_id` filters, four words with a `repo_name` filter. What the model saw
for each miss was the structured result verbatim, 101 bytes:
`{"blocks":[],"cursor":null,"truncated_response":false,"total":{"hits":0,"sessions":0}}`.
Of the two sessions that missed, one never searched again and one retried twice (a `sql`
over `sessions` and a narrower search) and missed both times; no zero-hit session reached
a hit. The bench's "every miss recovers" did not hold outside the bench, and the miss
carried nothing to recover with.

## Decision

1. **`next` is a field of the search output.** `searchOutputSchema` gains
   `next: string | null`. On a complete page with no hit the service sets it from the
   shape of the call (`searchNextStep` in `packages/core/format/search-next.ts`, one
   implementation for the service, the MCP tool, the REST route and the text form): a
   query over two words is told to retry with its two rarest words (every word must match);
   filters are named as the thing to check, with `repo_name` as git names the remote and
   `SELECT * FROM repos` for the visible names; one or two bare words get a synonym, the
   file name or the error text and the `sql` that lists the newest sessions; an empty
   query with filters is told to widen them. Pages with hits carry null. A bounded page
   after a time limit (ADR 0074) keeps its own `partial` note and carries null too, so the
   two never contradict each other.
2. **The text form prints the same sentence** as `Next: …` right after the totals, for
   harnesses and people that read text. Nothing else about the result changes; the
   OpenAPI document and the dashboard client are regenerated from the schema.

## Consequences

- A miss costs the model one sentence of context and hands it a concrete second call;
  the field is null on every page that answers, so hits are unchanged in size.
- The tool description (ADR 0070 decision 3) is unchanged; its 2-to-4-words rule and the
  `next` sentence say the same thing at the two moments the model can act on it.
- Whether misses now recover is measurable from the audit rows alone: a `search` with
  `result.hits = 0` followed within the session by a `search` with hits. That measurement
  is the follow-up; the six calls above are the whole post-fix sample and are recorded in
  `scratchpad/fixes/diag-recall-adoption-deep.md` for the next reader.
