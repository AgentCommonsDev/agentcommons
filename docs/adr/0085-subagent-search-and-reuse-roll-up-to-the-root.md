# ADR 0085: Subagent search and reuse roll up to the root session

## Status

Accepted.

## Context

A run is not one session. A root session spawns subagents (and pi/Codex fork children),
each stored as its own session linked by `parent_session_id`. The spec's rule for the
dashboards is "sessions are root sessions": every shipped tile that counts or lists sessions
counts roots only (`parent_session_id IS NULL`), "so a subagent, fork or spawned run counts
inside its root" (§10, R-DASH-47).

Two attribution bugs broke that promise for the reuse and search-adoption metrics, and a
third made the admin metric API disagree with the dashboards.

- **Undercount (main).** Search (`search`/`sql`) and reuse (`get`) reads are attributed by
  the audit projection to the single session that was active nearest the read (ADR 0060). A
  subagent's reads therefore land on the **child** session row. The roots-only metric
  relations and tiles then discarded them: `metrics_search_sessions` and
  `metrics_reuse_sessions` exposed a per-session flag/count keyed to the reading session, and
  the tiles (templates.ts `search_sessions`, `reuse_sessions`, `reuse_rate`, `reuse_trend`),
  the weekly view (`metrics_reuse_weekly`) and the person page (person.ts `searched`,
  `reused`) filtered `parent_session_id IS NULL`. A root whose subagents did all the
  searching or reuse showed `searched = 0` / `reused = 0`, directly contradicting R-DASH-47's
  "counts inside its root".

- **Two root definitions (consistency).** `parent_session_id` means the **caller-visible**
  parent in the `sessions` view (`session_details`, which NULLs a hidden parent) but the
  **raw projection** parent in `metrics_search_sessions`/`metrics_reuse_sessions`
  (`liveProjectionSql`). The same `parent_session_id IS NULL` predicate was applied to both,
  and the templates.ts rootScope comment wrongly asserted the parent was caller-visible for
  the metric relations too.

- **Admin metric API disagreed (consistency).** `apps/api/src/services/metrics.ts` built the
  `reuse` and `usage` CTEs over `metrics_reuse_sessions`/`metrics_search_sessions` **without**
  `parent_session_id IS NULL`, so `/admin/metrics` counted roots plus subagents while the
  dashboards counted roots only — same window, different `reuse_rate` and search-adoption
  numbers.

Message, token and tool-call **sums** were already correct (they use `scope`, not
`rootScope`, and count each session once); session **counts** were already roots-only. Those
are unchanged.

## Decision

**Roll a session's search and reuse reads up to its root before the roots-only
aggregation**, and settle on one root definition for the metrics.

- **Rollup in the metric relations.** `metrics_reuse_sessions` and `metrics_search_sessions`
  (packages/traces/src/views/analytics.ts) now group the stored reads by the reading
  session's **root** rather than by the reading session. A shared inline `rootmap` credits
  every session to the topmost ancestor reachable by its raw `parent_session_id` inside the
  caller-visible projection — the same visible root `session_details`/`sessionLinks` compute
  (R-LNK-06). A root row's `reused`/`cross_user_reused`/`memory_assisted` flags and
  `agentcommons_search_calls`/`repeat_agentcommons_search_calls` count therefore reflect its
  whole subtree; each child row falls to zero. `parent_session_id` stays the raw projection
  parent, so roots-only readers select each root once with its whole subtree, and the
  sum-over-all-sessions equals the sum-over-roots (no double count).

- **One root definition for metrics.** The metric relations keep the raw projection parent
  everywhere (true root), distinct from the `sessions` view's caller-visible parent; the
  templates.ts rootScope comment is corrected to state which relation means which. The
  per-session `sessions` columns (`agentcommons_search_calls`, `reuses_made`, `reuse_count`)
  are left per-session, as R-DASH-42 requires for the Sessions page and `get` header.

- **Admin metrics match the dashboards.** metrics.ts adds `parent_session_id IS NULL` to the
  `reuse` and `usage` reads of the two session-grain relations, so `/admin/metrics` and Home
  compute reuse and search adoption over the same roots-only scope, both including subagent
  activity through the rollup.

- **person.ts** reads `searched`/`reused` from the roots-only metric relations (selecting the
  member by mapping the page's email through `users` to `user_id`) instead of the per-session
  `sessions` columns, so a member's root that delegated its search or reuse to a subagent
  still counts. The other four stats keep sharing the one `sessions` aggregate.

### Why a bounded self-join, not a recursive CTE

The rollup needs a session→root map computed from the caller-visible projection (not the
control table: the read-path rules hold these relations to zero control reads and one
projection scan; ADR 0062). ClickHouse recursive `WITH` cannot materialize its base CTE, so
a recursive root map re-runs the projection's `FINAL` merge once per recursion level; under
four-way dashboard concurrency that blew the 5 s reader limit on the 40k-message fixture.
Instead `proj` is materialized once (lean columns) and walked up with a fixed ladder of
`LEFT JOIN`s over the in-memory result; an unmatched parent joins to the zero UUID, which
`nullIf` skips, and `coalesce` from the top picks the highest reachable ancestor. The ladder
is bounded (depth 8); real subagent/fork/spawn chains are far shallower, and a session deeper
than the ladder attributes to its highest reachable ancestor rather than failing.

## Consequences

- A root whose subagents searched or reused prior work now counts on Home, the Team overview
  reuse/search tiles and trend, the weekly reuse view, the person page and `/admin/metrics`.
  The admin metric API and the dashboards report identical reuse and search-adoption numbers
  for the same window. The totals (search-call and reuse-edge sums) are unchanged; only their
  attribution moves from child to root.
- Seeded dashboard/README numbers may shift if the fixture contains subagents that searched
  or reused; regenerate those captures if so.
- The `sessions` view, the Sessions page and the `get` header are untouched: their
  per-session `agentcommons_search_calls`/`reuses_made`/`reuse_count` stay per-session
  (R-DASH-42).
- `metrics_reuse_sessions`/`metrics_search_sessions` still scan the projection once (and, for
  reuse, the owner lookup once) and read no control table; the added cost is the materialized
  root ladder over the projection's session rows, measured under the reader limit at four-way
  concurrency on the 40k-message person fixture.
