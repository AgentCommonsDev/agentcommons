# ADR 0058: Dashboard renders are cached for an hour and pre-rendered on a schedule

Date: 2026-09-09
Status: Accepted. Supersedes the render-cache sentence of ADR 0048 and of §10 as it stood
("A hit is therefore always current"); the rest of ADR 0048 stands.

## Context

Dashboards were slow to open and tiles failed with "The trace database did not complete
the query". The diagnosis on the single-node deployment (2026-09-09) found two defects
in trace storage that made every query over `messages` cost 4.2 to 4.7 s and are fixed
separately (manifest pagination, ADR 0047's per-row dictionary lookups), and one in the
dashboard service itself: the render cache was keyed by the organization's data version,
an aggregate over its session control rows that includes `max(last_activity_at)`. On the
live host a busy session publishes about every 8 s, so during working hours every render
was a miss; the audit log showed hits only between 05:59 and 06:05 and `dashboard.render`
at p50 2.5 s, p95 9.4 s, with Home paying 8 to 10 s. The cache also held one entry per
whole request, so one failed tile made the next request re-run all ten.

The owner asked for results computed on a schedule ("views updated like hourly") so pages
open fast, and a manual refresh that re-runs the queries when someone asks.

## Decision

1. **Hourly validity, no data version.** The saved-dashboard render cache keeps its key
   parts (organization, caller scope, dashboard revision, resolved variables) and drops the
   data version. Entries stay valid for one hour, the existing TTL. `refresh: true`
   re-runs and replaces; a save bumps the revision and misses naturally; inline definitions
   are never cached. The bound of 256 dashboards evicts the earliest inserted first.
2. **One entry per tile.** Within a dashboard's key each tile is cached on its own. A tile
   that errored is returned with its error but never stored, so the next request retries it
   alone while the other tiles are served. A tile subset reads the same entries, and a
   single-tile refresh replaces only that tile. The response's `rendered_at` is the oldest
   returned tile's run; `cached` is true only when no tile ran.
3. **Scheduled pre-render.** A pg-boss job `dashboard-prerender` runs once at startup and
   at the top of every hour. For every organization it re-renders the default dashboard and
   each saved dashboard, with default variables (the values a page opens with), for the
   caller scopes that rendered a dashboard in the last seven days according to
   `dashboard.render` audit rows, at most 20 scopes per organization, most recently active
   first. Each scope's membership and key are re-validated the way rescan jobs re-validate
   their initiator; a scope that lost access is skipped and audited with status 403.
   Results go into the same cache with the same validity; each scope's run is audited as
   `dashboard.prerender` by the worker actor. One organization's failure never stops the
   run.
4. **Timeouts surface as timeouts.** With the reader client abort raised above the server's
   `max_execution_time` (traces fix), ClickHouse code 159 reaches the API and the tile
   error reads "The query exceeded its time limit", not the generic unavailable text.

## Consequences

- A dashboard may show data up to an hour old. The page says when it was rendered, and
  Refresh re-runs the tiles; the hourly job keeps Home current for people who use it.
- Between an entry's expiry at the top of the hour and the job's re-render there is a gap
  of the job's own runtime, during which a visit pays a full render.
- Pre-rendering costs one render per active scope per hour, bounded per organization. The
  audit log gains `dashboard.prerender` rows (one per scope and run) and 403 rows for
  departed viewers until their last `dashboard.render` row ages out of the seven-day
  window or audit retention.
- The `dashboard.render` audit row is the record of who uses dashboards; the job must not
  write `dashboard.render` rows itself, or it would keep its own scopes alive.
- Requirement rows R-DASH-32 is rewritten; R-DASH-35 and R-DASH-36 are added.
