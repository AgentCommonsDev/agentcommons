# ADR 0084: Purge and visibility cascade over the session tree

## Status

Accepted.

## Context

A run is not one session. A Claude Code or Codex session spawns subagents, and pi/Codex
forks branch from a parent; each is stored as its own session linked by `parent_session_id`
(relation `SUBAGENT`, `FORK` or `SPAWNED`). The spec calls these "part of" the parent — the
tree view and the `get` header present them as one run.

Moderation did not honor that. `purge` and `setVisibility` (apps/api/src/services/admin.ts)
acted on the single `request.session_id`:

- **Purge** tombstoned and deleted the corpus of only that session. Purging a root left every
  subagent's messages, raw records and embeddings fully readable — a privacy hole, since a
  subagent transcript holds the same sensitive content as the parent's work. Observed live: a
  purged root with 178 subagent sessions still `PUBLIC` and `LIVE`, holding ~17.6k messages.
- **Visibility** hid only that session. A hidden parent's children stayed visible; worse, on
  the read path a child of a hidden parent "lists as a root" (its caller-visible parent
  resolves to NULL), so hiding a session could surface its subagents as top-level rows.

Late arrival makes it worse: a subagent's transcript can be ingested after the parent's last
activity, so a subagent session can be created after its parent was already purged.

## Decision

Moderation operates on the **subtree** rooted at the target: the session and every
descendant, gathered with a cycle-safe recursive walk of `parent_session_id` in the control
plane (`sessionSubtree` in admin.ts), under the organization write fence the actions already
hold.

- **Purge** purges the target and every descendant. Each un-purged session gets its own
  tombstone and its own `purge` cleanup outbox, so the existing per-session worker deletes its
  whole corpus (messages, raw records, files, chunks, embeddings) exactly as before — the
  cascade reuses the tested single-session purge, it does not reimplement deletion. An
  already-purged session in the subtree is left as it is, so **re-running purge on a root
  catches descendants an earlier (non-cascading, or pre-arrival) purge missed** without
  disturbing tombstones already set. This is how the 178 orphaned subagents above are cleaned
  up: re-purge the already-purged root.
- **Visibility** applies the new value to the target and every non-purged descendant, so
  hiding a session hides the runs that belong to it and restoring it restores them together. A
  purged descendant keeps its tombstone (it is never un-hidden by a visibility change).

Purge still **retains audit** for every affected session (§9.5); the cascade does not delete
audit. (A one-off operational request to also delete a specific tree's audit trail is handled
outside the product's purge, not by changing this default.)

## Consequences

- Purging or hiding a session now covers its whole run. The privacy hole (readable subagent
  content under a purged parent) is closed, and hidden parents no longer leak subagents as
  roots for the fully-hidden subtree.
- One purge/visibility call now writes N control rows and, for purge, N cleanup outboxes,
  inside one transaction under the org write fence. N is a run's subagent count (hundreds at
  most); the fence already serializes these against ingest and readers, and the worker drains
  the outboxes as before. The audit records every affected session in `resource_ids` and a
  `cascaded` count in the detail.
- Reversibility is by cascade: restoring a parent to `PUBLIC` restores its descendants. A
  subagent is never moderated independently of its parent in practice, so overwriting a
  descendant's visibility to match the parent is correct; the lost nuance (an independently
  hidden subagent under a public parent) does not arise for subagent/fork/spawned runs.

## Alternatives considered

- **Inherit visibility/purge at read time from the ancestor chain.** Elegant (handles late
  arrivals and reversibility with no cascade writes, and needs no re-run), but it requires the
  ClickHouse row policies to evaluate the ancestor chain per row — recursion on the hot read
  path, or a materialized effective-visibility flag maintained across the tree. Too costly for
  the row-policy fence; rejected in favor of the cascade, which reuses the existing purge
  worker and fence. The read-path re-attribution of a _partially_ visible subtree (a middle
  node hidden) is a separate, lower-severity consistency issue tracked outside this ADR.
- **Cascade only to `SUBAGENT`/`SPAWNED`, exclude `FORK`.** A fork shares the parent's history
  up to the branch point, so for a privacy purge it must go too; and the tree already presents
  forks as belonging to the parent. Cascading to all descendants is simpler and safer.
- **Delete audit on purge for the whole tree.** Rejected as a default: audit retention is a
  deliberate compliance decision (§9.5). Audit deletion stays a manual, explicitly-authorized
  operation, not part of purge.
