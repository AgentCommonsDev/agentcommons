# ADR 0064: Dashboard render cache entries are keyed by the organization's published-session version, and the dashboard tools return compact text

Date: 2026-09-10
Status: Accepted. Amends ADR 0058 decision 1 ("Hourly validity, no data version"); the
hourly TTL, per-tile entries and the pre-render job of ADR 0058 stand.

## Context

On the hosted instance on 2026-09-10 an agent (pi 0.73.1 through the tool bridge) called
`dashboard_render` for the default dashboard and received `cached: true`, `rendered_at`
thirteen minutes earlier and `captured_sessions = 0`, while the organization had received
sixty new sessions since that render. The text the agent read was the pretty-printed
result JSON; nothing in it said the values were old or how to get current ones, and the
agent reported zeros as fact. In the same run `dashboard_list` returned 257 KB of
pretty-printed JSON for two dashboards, because the response carries the definition JSON
Schema (36 KB compact) and 22 templates (17 KB compact) and `formatJson` indents them.

ADR 0058 removed the organization's data version from the render cache key because that
version was an aggregate including `max(last_activity_at)`, which a busy session moves
every few seconds, so every working-hours render missed. The consequence it accepted, "a
dashboard may show data up to an hour old", is what the agent hit.

## Decision

1. **Published-session version in the key.** The saved and built-in render cache key gains
   one part read from the control plane before the cache is consulted: the counts of
   published (`published_revision > 0`, not purged), purged and private sessions in the
   organization, from `trace_session_control` in PostgreSQL (one indexed aggregate, no
   ClickHouse read, no fence). A new published session, a purge or a visibility change
   therefore misses on the next render and the tiles re-run; new messages inside an already
   published session do not move the version, so ADR 0058's "every render a miss" does not
   return. Inline definitions stay uncached; `refresh: true`, the hourly TTL, per-tile
   entries and the pre-render job are unchanged. The pre-render job's entries carry the
   version at the time of its run, so after a new session the first visitor pays a full
   render until the next hourly run or refresh.
2. **Compact text for the dashboard tools.** `dashboard_list` renders one line per
   dashboard (id, name, tile count, default/built-in/editable flags, updated_at,
   description), the template ids with titles, and where the definition JSON Schema lives
   (`structuredContent.definition_schema`; the `dashboard_save` input schema summarises
   it). `dashboard_get` renders header facts, the variables and tiles as tables and each
   data tile's SQL once; chart options and layouts stay in `structuredContent.definition`.
   `dashboard_render` opens with the tile count, `rendered_at`, its age in words, whether
   the result came from the cache and that `refresh: true` re-runs the tiles, then each
   tile's rows in the `sql` text format or its error. `structuredContent` remains the full
   validated result for every tool, and the REST responses are unchanged (the web app reads
   `templates` from `GET /dashboards`).

## Consequences

- One PostgreSQL aggregate per saved-dashboard render (~ms on the index
  `(organization_id, published_revision)`; the purge and visibility filters read the same
  rows).
- Home opens from the cache until a session is published, then pays one render for the
  first visitor of each caller scope; on an active organization that is at most a few
  times an hour, not every eight seconds.
- Agents read ~3 KB for `dashboard_list` instead of 257 KB, and a stale render says so.
- Requirement rows R-DASH-32 is rewritten and R-DASH-40 is added.
