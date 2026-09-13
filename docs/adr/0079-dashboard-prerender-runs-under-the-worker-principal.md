# ADR 0079: The dashboard pre-render runs under the worker principal; keys are not scopes

Date: 2026-09-13
Status: Accepted. Amends ADR 0058 item 3 (which scopes the hourly job renders, and as whom).

## Context

ADR 0058 made the hourly `dashboard-prerender` job re-render, for each organization, the
caller scopes that rendered a dashboard in the last seven days, taking each scope from the
`(user, API key)` pair of its `dashboard.render` audit rows and re-validating the key the
way rescan jobs re-validate their initiator. On the hosted instance (2026-09-13) the job
wrote one `dashboard.prerender` row with status 403 and `skipped: KEY_REVOKED` every hour
for three days: the load-test organization's synthetic user had rendered its dashboards 199
times through an API key on 2026-09-10, the key was revoked that evening, and its render
rows kept the dead scope inside the seven-day window. The other organization's scopes (the
shared admin scope and three member scopes) warmed normally every hour, so no page went
cold, but the design had two faults:

1. An API key is a credential, not a scope. The render cache is keyed by `admin` or
   `user:<id>` (ADR 0058), which follows the membership role and, for keys, the key's
   permissions, never which key made the call. Binding a scheduled job's actor set to
   specific keys made a routine credential rotation write hourly 403 audit rows for a week,
   and a member who only renders through keys would stop being warmed after rotating one.
2. The shared admin scope was rendered as whichever admin had rendered most recently,
   re-validating that person's membership and key every hour. A background job that warms
   an organization-wide cache should not depend on any one person's standing; the audit
   projection worker already reads with a durable per-organization worker principal.

## Decision

1. `workerCaller(organizationId)` in `apps/api/src/auth/bootstrap.ts` is the one principal
   background workers read an organization's traces with: admin authority under the literal
   user `worker`, no key, fenced by the same native row policies as every caller. The audit
   projection worker's private `workerAuthority` is replaced by it.
2. The pre-render job takes its viewer set from `dashboard.render` rows grouped by
   organization and user only. For every organization with a viewer in the window it first
   renders the `admin` scope under `workerCaller`, then each viewer as a browser caller with
   their current membership role (re-validated through `reauthorizeJob` with no key); admins
   collapse into the already rendered admin scope, members render their own `user:<id>`
   scope. The bound of 20 scopes per organization and the most-recent-first order stand.
3. A viewer whose membership lapsed is still skipped with a 403 `dashboard.prerender` row
   (`skipped: MEMBERSHIP_REQUIRED`). A revoked key writes no row, because keys are no longer
   part of the actor set. Each run keeps its one audit row by the worker actor; the admin
   scope's row names no `user_id`.

## Consequences

- Revoking or rotating a key never changes what the job warms and writes no audit noise.
- The admin scope is warmed for every organization with recent dashboard use, including one
  where only members rendered: one extra render per hour for such an organization.
- An owner or admin who rendered only through a key without admin authority used to warm a
  `user:<id>` scope; they now warm the admin scope, which is what their browser opens. The
  cache is a warm-up and row policies apply on every read, so no data crosses scopes.
- R-DASH-35 is rewritten; ADR 0058 item 3 is amended.
