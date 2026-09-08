# 0004. Visibility enforced in database views keyed to the connected role

Date: 2026-09-07 · Status: accepted, amended by 0010

**Context.** Users must never see private or purged sessions through any path, including
arbitrary SQL from agents. Application-level filters can be forgotten; session variables can be
set by the caller.

**Decision.** Two Postgres roles, `ac_reader_user` and `ac_reader_admin`, each with `SELECT` on
`api_ro` views only. Every view's `WHERE` ends with `((visibility = 'PUBLIC' AND purged_at IS
NULL) OR current_user = 'ac_reader_admin')`. The API picks the pool by the caller's role.
`current_user` cannot be changed by SQL without role membership. A parser guard rejects
non-SELECT statements for readable errors, but the role and `statement_timeout` are the
actual protection. Purge deletes content rows, so there is nothing to leak.

**Alternatives.** Row-level security with a `SET LOCAL app.is_admin` variable (settable by a
caller if a guard slips); filtering in handlers (forgettable).

**Consequences.** Two small connection pools. Any new view must include the visibility clause;
the `api_ro` contract test snapshots view definitions to catch omissions.

**Amendment (0010).** Views are `security_barrier`, functions `SECURITY INVOKER`, derived columns computed from the caller-visible set (hidden parent → null), and effective authority requires an admin owner and an `admin:*` key. Guard uses an allowlist of relations and functions.
