# ADR 0048: Organization dashboards with typed tiles and agent tools

Date: 2026-09-08
Status: Accepted. Supersedes the personal-profile scope, the no-layout-engine decision
and the JSON Forms/Recharts choice of ADR 0045; its query-service and redaction
invariants remain.

## Context

ADR 0045 made dashboards personal preferences: up to 20 profiles per user, a fixed
number/line/bar/table widget set rendered by Recharts, a JSON Forms editor, no layout
engine, and MCP tools that edited only the caller's own profiles. A dedicated Home API
(`/home`, `/home/:section`) supplied the four adoption KPIs and reuse feeds next to it.

Using it showed three problems. A dashboard one person builds is useful to the team, but
nobody else could see it, and admins could not set what members see first. Widgets could
not be arranged, so anything beyond four counts and one chart became a long column.
Every dashboard question needed a second code path (the Home API) that duplicated what a
guarded SQL tile could compute. This is an early project; the owner asked for the correct
model rather than a compatible extension of the old one.

## Decision

**Dashboards belong to the organization.** Any member creates one; the creator or an
organization owner/admin edits or deletes it; every member sees every dashboard.
Organization admins mark one dashboard as the Home default. A shipped read-only "Team
overview" with a fixed id is always present and is the default until an admin picks
another. At most 50 saved dashboards per organization. Persistence is a Prisma
`Dashboard` model (organization and author foreign keys, immutable authorship, one
default per organization enforced by a partial unique index) replacing
`DashboardProfile`; existing profile rows are dropped, not migrated.

**One definition schema, version 2.** A dashboard is `{version: 2, variables[], tiles[]}`
validated by shared Zod. Tiles are `stat`, `chart`, `table`, `text` and `control`, each
with an id and a `layout {x, y, w, h}` on a 12-column grid. Data tiles carry one
ClickHouse `SELECT` that runs through the existing guarded query service with the
caller's authority at render time; nothing is stored but the definition. The definition
is at most 64 KB, 1–24 tiles, up to 8 variables.

**Charts are an allowlisted Apache ECharts option.** `chart` tiles declare an ECharts
option limited to a strict Zod subset: series types line/bar/pie/scatter/gauge/heatmap,
`encode` bindings from result columns, axes, legend, tooltip, grid, colors, zoom, visual
map and polar blocks as style objects. Style blocks (`itemStyle`, `label`, `emphasis`,
axis options and the like) are a bounded, non-recursive type rather than `z.json()`:
records of at most three nesting levels whose leaves are strings (256 characters),
numbers, booleans, null or arrays of those (64 entries), with 64-character keys. Two
reasons: JSON cannot carry functions, so no code enters the option; and the same Zod
schema becomes the MCP tool input schema, where the Gemini API rejects recursive
`$ref` definitions. The renderer supplies `dataset` rows, theme and responsiveness.
Recharts and JSON Forms are removed.

**Typed variables through the guard.** Variables are `time_range`, `repo`, `harness`,
`user` and `text`. They become ClickHouse query parameters with fixed types: a time range
exposes `{name_from:DateTime}` and `{name_to:DateTime}`; repo/harness/user expose
`{name:Array(String)}` where an empty array means all; text exposes `{name:String}`. A
tile may reference a parameter only when the dashboard declares it with that type; the
SQL guard rejects undeclared or mistyped parameters at save time and again at render
time. `control` tiles bind a declared variable to an input.

**Layout uses react-grid-layout.** The editor is a drag-and-resize grid with a tile
inspector (title, SQL with the schema browser, chart option JSON), starter templates and
inline validation. Definitions are also editable as JSON against the same schema.

**Agents get the same capability.** MCP tools `dashboard_list` (dashboards, default id,
JSON Schema and templates), `dashboard_get`, `dashboard_render` (saved or inline
definition with variable values, optional tile subset), `dashboard_save` and
`dashboard_delete` are read-permission tools; `dashboard_set_default` requires effective
admin authority. REST mirrors them under `/dashboards`. Both adapters call one service,
which redacts names, descriptions and definitions before persistence, checks the guard on
every data tile, uses optimistic revisions (409 on a stale revision) and writes one audit
event per operation.

**Home is the default dashboard.** The four adoption KPIs (captured sessions, sessions
using search, sessions reusing prior work, reuse rate) are stat tiles of the Team
overview over the existing `api_ro` metric views. The Home API (`/home`,
`/home/:section`), its schemas, service and tests are removed; the reuse, impact and gap
relations stay available through `sql` and the metric API. Session-level reuse stays on
`/sessions/:id/reuse`.

**The application lives under `/app` with no legacy routes.** Home is `/app`, dashboards
are `/app/dashboards/:id` and `/app/dashboards/:id/edit`, sessions `/app/sessions` and
`/app/sessions/:id`, SQL `/app/sql`, keys `/app/keys` with Install and API reference
tabs, billing `/app/billing` (SaaS only), admin under `/app/admin/*`. Old paths (`/home`,
`/sessions`, `/installation`, `/usage`, `/s/<id>`) are not redirected or aliased; server
return URLs point at `/app/billing`. Section 10 of the spec is the route contract.

## Consequences

- One rendering path for every metric a person or agent asks for: a guarded SELECT with
  typed parameters. Adding a view or column needs no widget code.
- Authorization is organization-visible with creator/admin editing; a `sessions:read` key
  can create dashboards the whole organization sees. This is intentional: dashboards
  contain SQL and layout, never data, and the guard applies at render for each viewer.
- ECharts adds a larger client bundle than Recharts; it is loaded only on dashboard
  routes. The allowlist must grow deliberately; unknown option keys are rejected, and
  any new style block must stay within the bounded non-recursive type so every MCP
  client, including Gemini, can load the tool catalog.
- Dropping `DashboardProfile` loses saved personal profiles from the prototype period.
  Accepted because the product had no external users.
- Requirement rows R-DASH-15, R-DASH-16, R-DASH-18 and R-DASH-25 are rewritten; browser
  coverage is rebuilt against `/app`.
