# ADR 0061: The dashboard reads transcripts at the REST page cap, in concurrent ranges

Date: 2026-09-10
Status: Accepted. Refines §7.3 (`get` budgets) and the §10 session detail transcript.

## Context

`get` was one implementation with one budget: 32 KB per page and 4 KB per message slice,
chosen so an agent's context is never flooded by one read (§7.3, §8). The dashboard's
session page read the same pages, one after another, following the `next` cursor from
each response before it could ask for the following page.

Measured on the seeded browser fixture (Chromium, localhost; numbers in the fix report):
a 1,500-message Claude Code session with a realistic mix of text, thinking, tool calls and
results took 45 sequential `GET /sessions/:id` requests (1.44 MB, median page 32 KB) with
a median server time of 1.3 s per page, so a reader who scrolled to the end waited about a
minute of server time alone; the first message appeared after 2.0 s. Every 5 s poll of an
active session refetched every loaded page.

On the hosted instance (2 vCPU, ClickHouse at 75% CPU during one page load) the same read
costs far more: `get` p50 3.2 s, p95 6.0 s, max 9.4 s over the last day, 61 of 487 calls
failing with 500 on later cursor pages of the two largest sessions, and one open of an
80-message session issuing 5 to 9 sequential `get` calls (15 to 30 s). The message rows
read in about 0.4 s; the rest is the session header, which every page recomputed through
the `sessions` view (the reuse joins), plus the relatives and root queries, under the
per-organization publication fence and the reader's 5 s execution limit.

## Decision

1. `get` accepts `page_bytes`: the page budget in bytes, from 32 KB (the default and the
   agent budget) to `responseBytes.page` (256 KB, the REST page cap). Each message slice is
   bounded to one eighth of the budget, so the default keeps its 4 KB slices and a 256 KB
   page carries 32 KB slices. The metadata prefetch scales in proportion (100 rows per
   32 KB). One implementation, one knob.
2. The MCP `get` tool does not advertise `page_bytes`, and an MCP call is parsed against
   the advertised schema before the service schema, so agents cannot pass it (or `format`).
   Appendix C and `fixtures/contracts/mcp.json` are unchanged.
3. The dashboard reads at 256 KB: a head page, then the remaining seq ranges (sized from
   the head page's bytes per message so one range usually fits one page) with at most
   three requests in flight, the first sixteen ranges without a reader's action, each
   rendered as it lands; "Load more" takes over beyond that. Ranges are independent
   requests because `from`/`to` bound them, unlike cursor pages.
4. A page computes the header only when asked. `header=false` (REST only, rejected by the
   MCP tool) answers `header: null` and checks visibility against the light
   `session_state` view instead of `sessions`, so a read is three ClickHouse queries
   (state, message metadata, payloads) instead of five (`sessions`, relatives, root,
   metadata, payloads). The dashboard's ranges and the CSV export's later pages pass it;
   the head page and every agent read keep the header. The header is nullable in the
   shared output schema; the MCP result always carries it.
5. An active session's status and message count come from the live stream's own events;
   a header-only read (`from=0&to=0`) keyed under the stream's invalidation prefix is
   polled every 5 s only while the stream is down. Growth appends or extends the last
   range; loaded ranges are never read again.
6. Each part of the page reports its own failure (header, messages, subagent runs) with a
   retry; a later range failing leaves the header and earlier messages in place.
7. A bounded message no longer ends the page. The production load test found the 32 KB
   agent page carrying two messages on real Claude Code transcripts: every message longer
   than its 4 KB slice ended the page (the cursor was one linear position), and Claude Code
   writes a 14 KB `deferred_tools_delta` attachment and a 7 KB `skill_listing` per turn, so
   a 16-turn, 288-message session took 65 pages. Simulated with the real cost model on that
   transcript and the captured fixtures (`fixtures/transcripts`): continuing with the next
   message after a bounded one gives 12 pages (24 messages per page), and previewing META
   housekeeping records at a quarter slice (1 KB) gives 8; a 64 KB default would give 17
   and still 9 pages on the Codex tool-identities transcript where three tool results
   exceed 4 KB, which the continuation reads in 2. So `next` names the next message (or the
   rest of the range's last message when the range ends inside it), each bounded message
   carries its `content_cursor`, and the rest of one message is read with `from`/`to` at
   its seq. The CSV export drills into each bounded message the same way; the dashboard
   offers "Show the rest" on a message longer than its slice.
8. META leaves the default budget and the text form slims down. The MCP harness test on
   production found 94% of the bytes an agent paged through were SYSTEM/META records and
   that the header repeated on every page with fields no agent uses. `get` gains `kinds`
   (advertised, so the MCP contract fixture was re-captured); the default is the
   conversation without META, the CSV export keeps every kind, `seq` keeps every kind's
   position so a default read shows gaps, and `message_count` still counts everything. With
   META out, the per-message slice rises from an eighth to a quarter of the page (8 KB at
   32 KB): on the captured fixtures the 16-turn session reads in 3 pages of 128 messages
   (from 8 with META previewed, 65 before this ADR) at about 16.5 KB of text per page
   (about 4,100 tokens, from 24 KB / 6,000), and the Codex tool-identities transcript's
   three large tool results read in one page with two bounded instead of three; 12 KB and
   16 KB slices pushed that transcript to two pages for no gain. The text form carries the
   full header (minus `organization_id`, `installation_id`) on the first page and one line
   on continuation pages, and drops the record and batch ids and empty token lines from
   each message; the JSON is unchanged.

## Consequences

The agent contract is untouched: 32 KB pages, 4 KB slices, the header, the same `next`
cursor. The dashboard issues one eighth of the page requests with three in flight, scans
`sessions` once per load instead of once per page, and a live tick with the stream up
costs no header read at all. Deep links keep two messages of context above the target and
load the tail after it. Before and after numbers for the fixture sessions and the hosted
instance are in the fix report that accompanied this change. The per-row policy cost and
the `sessions` view's reuse joins are addressed by their own changes (perf-policies,
perf-reuse); this one only stops paying them once per page.
