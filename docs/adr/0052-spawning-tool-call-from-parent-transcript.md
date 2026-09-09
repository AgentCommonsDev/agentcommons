# ADR 0052: A child's spawning tool call comes from the parent transcript

Date: 2026-09-09
Status: Accepted. Extends §4.2 and §5.5; supersedes the §10 statement that no harness
records which tool call spawned a child.

## Context

Subagent sessions are linked to their parent by `parentSessionId`/`parentRelation`, and the
session page listed them in a separate "Subagent runs" section after the transcript. The
founder asked for a tree: a child run should appear under the tool call that started it,
because that is where a reader is when they wonder what the subagent did.

The live fixtures show where that link is recorded. Claude Code's parent transcript holds
it in the `Agent` tool result record: `toolUseResult.agentId` sits beside the
`tool_result` block whose `tool_use_id` is the spawning call, and the child's native
session id is `<sessionId>:agent-<agentId>` (the layout the shim registers at
`SubagentStart`). The child's own `.meta.json` also carries `toolUseId`, but the shim does
not read that file and nothing verified says when it is written. Codex's parent rollout
holds it in the `event_msg item_completed` `SubAgentActivity` `started` item: `id` is the
`spawn_agent` `call_id` and `agent_thread_id` is the child rollout's `session_meta.id`.
The Codex child knows only `parent_thread_id` and an `agent_path`. Gemini delegates
inline with no child session; pi forks record a parent file, not a call.

So the mapping is parent-side evidence in both harnesses that have subagents, and it
arrives whenever the parent's transcript does: after the child ends in Claude Code
(the result is written when the agent finishes), at spawn time in Codex.

## Decision

Normalizers gain `spawns(records)`, returning `{ toolUseId, childNativeRef }` from the
parent's records (`links` remains the child's view of its parent). Ingest canonicalizes
the child reference with the same redaction-aware identity mapping the child's own
upload uses and digests the call id to the projected identity the parent's `TOOL_USE`
message carries, so the two sides match by construction.

The value lives in PostgreSQL control, like `parentSessionId`: `parent_tool_use_id` on
`trace_session_control`, plus a `trace_spawn_control` row per (parent, child identity)
that waits for a child that has not been ingested yet. One statement applies claims to
the children of the parent and to a child that has just linked, so either arrival order
resolves. A claim never relinks a child that names another parent; it is recorded as a
conflict in the ingest audit detail. The column reaches ClickHouse through the
`session_scope` dictionary into `api_ro.sessions`, the `get` header, child references
and `/sessions/:id/tree`, and is nulled when the parent is not visible to the caller,
like `parent_relation`. It is not a ClickHouse `sessions` column: the parent's evidence
usually lands after the child's last projection, so a projected column would be stale.

The dashboard nests a child under the one loaded `TOOL_USE` whose `tool_use_id` equals
its `parent_tool_use_id` (`spawnPlacements` in `packages/core/format`, the same
unambiguity rule `messageBranches` uses for results). Children whose call is unrecorded,
ambiguous, or on a page not yet loaded stay in the "Subagent runs" section, which
disappears when every child is placed. Nothing is ever hidden: a run always renders in
exactly one of the two places.

## Consequences

- Claude Code and Codex subagents read as a tree; pi forks and env-spawned sessions keep
  the section. The UI still never invents a link the harness did not record.
- One more control column and one small control table; a Prisma migration recreates the
  `trace_control.session_scope` view with the appended column.
- Rescans need no handling: both stored values are durable digests of native ids.
- If a harness later exposes the call on the child side (for example the shim reading
  Claude's `.meta.json`), it can feed the same claim table from the child's upload without
  changing readers.
