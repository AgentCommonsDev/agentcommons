# ADR 0088: Purged sessions leave the browse surfaces

## Status

Accepted. Follows ADR 0084 (purge cascades over the session tree) and ADR 0047 (native
row policies over the ClickHouse corpus).

## Context

Purge installs an irreversible tombstone and deletes a session's corpus. The native row
policies then hide the corpus from everyone, admins included, and §9.5 keeps a small
**identity skeleton** so a link to a purged session still resolves to a "this session was
purged" page instead of a 404. The skeleton is a UNION branch in `sessionRelationSql`
(`packages/traces/src/views/base.ts`), gated to admins by `traceScopeSql.admin` and the
admin-only `session_identities` row policy, and it flows into `api_ro.sessions` and
`api_ro.session_details`.

ADR 0084 made purge cascade over the subtree, so purging a root also purges its subagents,
forks and spawned runs. That closed the privacy hole (readable subagent content under a
purged parent) but left a presentation bug: because the skeleton lives in the shared
`api_ro.sessions`/`api_ro.session_details` views, **every purged session in the subtree
still renders to an admin on the ordinary browse surfaces** — as its own empty row in the
Sessions list and as an empty node in the session-detail tree. Observed live: an admin
purged a root with 178 subagents; the corpus was gone (0 messages) yet the tree still drew
178 empty skeleton children and the list still showed the purged roots. To an admin the
purge looked like it had done nothing.

The skeleton is right for two surfaces and wrong for the rest:

- **Right** for a direct `GET /sessions/:id` (the purge notice page) and for
  `GET /admin/sessions` (Moderation), which exists precisely to review every state including
  purged (§9.5, R-MOD-04).
- **Wrong** for the default Sessions list and the session-detail tree/children, which are
  browsing surfaces, not moderation surfaces. A purged session is deleted content; it should
  not appear there for anyone, admins included.

Members were never affected: the base-table row policy admits only `purged=0`, and the
skeleton branch and `session_identities` policy are admin-only. The leak was admin-only.

## Decision

Purged sessions are **excluded from the browse surfaces for every caller**, while the
skeleton stays available to the two surfaces that need it. The exclusion is a predicate on
each browse query, not a change to the shared view — the direct-`get` and Moderation paths
keep reading the same skeleton.

- **Session list** (`SessionService.list`, `apps/api/src/services/session.ts`): the page
  predicate gains `s.purged_at IS NULL`. `api_ro.sessions` still carries the admin skeleton,
  so the list simply declines to show it. The window totals use the same predicate, so the
  count matches the rows.
- **Session tree and header links** (`apps/api/src/repositories/read-model.ts`): the shared
  `visibleControlSql` rule gains `purged_at IS NULL` for **every** caller. It changes from
  `published AND ((PUBLIC AND purged_at IS NULL) OR admin)` to
  `published AND purged_at IS NULL AND (PUBLIC OR admin)`. Private (non-public, unpurged)
  sessions stay admin-visible exactly as before; only purged ones are newly hidden from
  admins. `sessionTreePage`, `sessionLinks`, and `sessionDescendants` share this rule, so
  the tree drops purged nodes, a live child of a purged parent re-parents to its nearest
  visible ancestor (the same gap handling a private ancestor already used), and the CSV
  export stops enumerating purged descendants (which carry no corpus anyway).

Kept unchanged:

- **Direct `GET /sessions/:id`** returns the skeleton for a purged session (admin), not a
  404: the self row still comes from the `api_ro.sessions` skeleton branch, which this ADR
  does not touch.
- **Moderation** (`GET /admin/sessions`, `apps/api/src/services/admin.ts`) reads
  `trace_session_control` directly and its published-row read reads the same skeleton; it is
  untouched and still lists every session in every state (R-MOD-04).
- **Member visibility** is unchanged: members never saw purged rows and still do not.
- The skeleton view itself (`base.ts`) is left in place; removing it would break the direct
  `get` and Moderation paths.

## Consequences

- After a purge (or the ADR 0084 cascade), the purged sessions vanish from the Sessions list
  and the session-detail tree for admins as well as members; the purge visibly took effect.
  The purge notice page and Moderation continue to show the purged session.
- **Known residual (out of scope, low risk):** `child_count` and the up-to-ten `children`
  refs in the `get`/list session header still come from the shared control aggregate and the
  skeleton branch of `session_details`, which count and list a _directly_-purged child of a
  _live_ parent. This only arises when an admin purges a subagent without purging its live
  parent; the parent's tree (this ADR) already omits the purged child, so the detail page's
  subagent tree is correct, but the header's numeric subagent count can still include it.
  Fixing it means changing the shared child-count aggregate in `base.ts`, a broader change
  with wider blast radius (dashboard tiles, header counts); it is deferred rather than folded
  into this low-risk fix.
- One extra predicate per browse query; no new scan, no change to the reader principals or
  row policies, and no change to the one-scan-per-relation read rules.

## Spec and requirements

- §9.5 previously read "admin session views expose only the retained identity skeleton."
  That is now scoped: the skeleton backs the direct-`get` purge page and the Moderation
  route, but the ordinary browse surfaces (the Sessions list and the session-detail
  tree/children) exclude purged sessions for admins too. §9.5 and §10 ("Session detail",
  "Sessions are root sessions") should record that purged sessions do not appear in the list
  or the tree.
- R-MOD-02 and R-DASH-11 gain the browse-exclusion statement and are cited by the new tests
  in `apps/api/test/read.integration.test.ts`; R-MOD-04 (Moderation lists purged) and member
  visibility are unchanged.
