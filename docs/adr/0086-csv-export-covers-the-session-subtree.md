# ADR 0086: The session CSV export covers the whole subtree as one audited read

Date: 2026-09-18
Status: Accepted. Extends the `GET /sessions/:id?format=csv` export in spec §7.6 and §10
(R-DASH-38) and reuses the control-side subtree traversal of ADR 0084 and the tree endpoint.

## Context

`GET /sessions/:id?format=csv` streamed one CSV row per message of the requested session,
covering the entire session across pagination: the export walked the same `get` pages a JSON
reader would, at the 256 KB REST cap, rejoining a message that spans pages into its row. It
stopped at the named session. A session's real work, though, is a tree: subagents, forks and
spawned runs are separate sessions linked by `parent_session_id`, each with its own messages.
A reader exporting a root got the orchestrator's turns and none of the subagents' — the bulk
of a multi-agent run. To assemble a full transcript they had to read the tree, export each
node, and concatenate, losing attribution and paying one audited read per node.

The previous implementation also produced one `get:csv` audit row per page: an export of a
long session wrote many audit rows for one user action, and there was no single event that
named "the caller exported this session (and its subtree)".

## Decision

The export covers the subtree rooted at the requested session and is one audited operation.

- **Subtree.** `sessionDescendants(client, caller, rootId)` (a new read-model function)
  walks compact control with a recursive CTE seeded at `rootId`, keeping
  `organization_id` on every join and the `NOT s.id = ANY(path)` cycle guard, and returns
  the ids of every caller-visible descendant (excluding the root) in `(started_at, id)`
  order. It filters on the same `visibleControlSql` the tree endpoint uses, so a hidden
  middle session does not hide its visible children (the tree endpoint's gap handling),
  and visibility is the caller's: an admin's export includes private descendants a member's
  does not. The control read is paged with a keyset (`LIMIT n+1`) so one query never scans
  an unbounded subtree.
- **Rows.** The export streams the root's requested range first in `seq` order, then each
  visible descendant whole in tree order. Every row already carries its own `session_id`
  (the CSV columns are the `get` message fields minus `content_cursor`), so subagent rows
  stay attributable with no new column. A message that spans pages is still rejoined into
  one row.
- **One audit.** The export is one `readOperation` with action `sessions.export`, replacing
  the per-page `get:csv` audit contract. Its execute callback reads the root's first page
  and enumerates the subtree in one short fence, then returns the rows as an async
  generator; `describeResources` records `[root, ...descendantIds]` and `describeResult`
  the exported session count. The page reader is factored out of `get` into a private
  `readPage(caller, client, request)` that both `get` (wrapped in its own audit) and the
  export (per page, no extra audit) call, so the two share one implementation.
- **Fences.** The fence model is unchanged: one short fenced read per page, each ≤ 256 KB
  and well under the 5 s / 256 MiB reader limits. The first page and the descendant
  enumeration share one fence (fail-fast: a caller who cannot read the root gets the JSON
  error and no file); every later page opens its own fence as the consumer pulls, so no
  fence is held across the export. A descendant hidden between enumeration and read yields
  zero rows rather than failing the export.

## Consequences

- Exporting a root now yields the full multi-agent transcript in one file, ordered and
  attributed. Exporting a leaf is unchanged (no descendants).
- One user action is one audit row (`sessions.export`) naming every session it touched,
  instead of one row per page. The single audit is written up front, after the fail-fast
  first-page read succeeds; a failure while streaming a later page (not expected under the
  bounded per-page budget) breaks the stream but is not separately audited, where the old
  per-page reads each audited. This narrows R-GET-07's per-page classification for exports
  to the first (fail-fast) page.
- The caller's requested `from`/`to` range applies to the named session; descendants are
  exported whole (the shared `kinds` selection still applies to all). A range is a per-session
  seq window and has no meaning across sibling subagents.
- No schema or OpenAPI change: the CSV columns and the route are unchanged.
