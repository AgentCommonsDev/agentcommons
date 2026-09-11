# ADR 0067: Search adoption is measured from attributed API reads

Date: 2026-09-10
Status: Accepted. Supersedes ADR 0034 (transcript tool-name classification); builds on
ADR 0060 (attributed reads materialized by the audit projection).

## Context

The Team overview tile "Sessions that searched" and the Usage metrics
`agentcommons_search_*` counted `TOOL_USE` messages whose `tool_name` was one of three
exact identities (`mcp__agentcommons__search`, `mcp_agentcommons_search`,
`agentcommons_search`), following ADR 0034. On the production organization the agents
made 156 key-authenticated MCP `sql` calls and 2 `search` calls in seven days, and after
the backfill `session_reads` credited 916 `sql` reads to 14 sessions, yet the tile showed
0: the MCP server alias is whatever the user configured (no transcript named
"agentcommons" at all), and the tool the agents actually use is `sql`, which the list
never counted. A metric that depends on a client-side alias cannot see real usage. The
same view also scanned the message corpus, the most expensive relation on the host.

## Decision

1. **Source.** `api_ro.metrics_search_sessions` counts, per visible unpurged session, the
   `search` and `sql` rows of `session_reads` credited to it (`searchReadActions` in
   `packages/traces/src/reads.ts`): successful key-authenticated MCP/REST calls attributed
   by installation and active window, the same rows that define reuse. `get` reads are
   reuse, not search. Column names and types are unchanged for `session_id`,
   `started_at`, `repo_name`, `harness`, `user_id`, `agentcommons_search_calls` and
   `repeat_agentcommons_search_calls` (calls after the first).
2. **Retired.** The column `subsequent_other_search_calls`, the Usage metric of the same
   name and the exact tool-identity lists (AgentCommons and code/web search tools) are
   removed. The measure was anchored to the first transcript-recognized AgentCommons call,
   which no longer exists as a concept; a harness-specific list of "other search" tools
   has the same alias problem. No dashboard copy or tile referenced it.
3. **Cheap by construction.** The view joins the live projection once with one grouped
   pass over `session_reads FINAL`; it never reads `messages` or `message_metadata`. The
   Team overview tile SQL (`countIf(agentcommons_search_calls > 0)`) is unchanged.
4. **Robust backfill marker.** `backfill()` no longer records completion when it
   enumerated no organization, so a process briefly booted against an empty database
   leaves the one-time derivation pending for the first real data.

## Consequences

- The tile and Usage metrics reflect what agents did through the API, whatever the
  transcript calls the tool, and agree with the reuse tiles by construction (one source).
- Search adoption now appears when the audit projection flushes (about a minute), not on
  transcript ingest, and only for key-authenticated MCP/REST calls made while a session was
  active on that installation. Calls from a key whose installation has no live session, and
  browser searches, are not attributed; the Usage API keeps its audit-based counts
  (`mcp_calls`, `dashboard_searches`) for those.
- The metric-name enum shrinks by one value: `apps/api/openapi.json` and the dashboard's
  generated client change; `pnpm --filter @agentcommons/dashboard api:generate` regenerates
  the client.
- The `fixtures/transcripts/tool-identities` captures remain the ground truth for the
  normalizers' tool identity projection (`packages/core/normalizers/tool-identities.test.ts`,
  trace-ingest tests); they no longer drive an adoption metric.
- Requirement R-DASH-18 is reworded; R-DASH-16's tile description follows.
