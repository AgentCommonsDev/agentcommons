# ADR 0036: Normalize typed Codex tool completion records

Date: 2026-09-08. Status: accepted.

## Context

The live Codex 0.153.4 capture stores MCP and native web calls as typed
`event_msg/item_completed` items. In code mode, the surrounding response item is
`custom_tool_call` named `exec`; treating only that wrapper as a tool loses the typed
MCP identity and would require parsing arbitrary JavaScript to recover it.

## Decision

Extend only the Codex adapter to recognize captured `McpToolCall` completions and
`Extension` items whose kind is `web.search` and whose action type is `search`.
MCP names are projected as `mcp__<server>__<tool>`; the observed AgentCommons name is
`mcp__agentcommons__search`. Web searches use `web.search`. Unknown extension kinds
and web open/find actions remain raw-only.

Use the native item ID as invocation identity, start time for TOOL_USE, and completion
time for an actual TOOL_RESULT. Preserve actual errors as results; never invent a
successful output. Duplicate completion observations yield one invocation and the
last actual result. An ordinary call/result with the same identity takes precedence
over its completion counterpart, so repeated representations cannot inflate counts.
The adapter declares result locations, identity locations, and finite protocol syntax
to the shared redaction pipeline. Tool arguments, names, server names, and result text
still undergo redaction; invocation pairing remains stable across rescans.

The captured rollouts contain no `item_started` observations for these tools.
TOOL_USE therefore occupies its recorded completion source position even though its
display timestamp comes from `started_at_ms`. Subsequent-search metrics use canonical
source `seq`, so parallel calls are ordered by recorded completion position; this is
not a start-order or causal claim. Captured outer `exec` IDs and inner typed invocation
IDs are disjoint. Only a proven matching native ID permits overlap deduplication.

## Consequences

Transcript adoption metrics can consume canonical TOOL_USE identities without a
harness-specific branch outside the adapter or parsing executable source text.
Observed failed attempts remain distinguishable in their result content; an observed
tool call is not proof of successful retrieval. Existing `exec` wrappers remain their
own native tool observations. This addition does not manufacture pi MCP support.
Live fixtures and regression tests cover source ordering, duplicate observations,
ordinary-call overlap, unknown extension exclusion, and redaction/pairing stability.
