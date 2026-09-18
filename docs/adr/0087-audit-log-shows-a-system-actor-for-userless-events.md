# ADR 0087: The audit log names a system actor for userless events

## Status

Accepted.

## Context

Every operation writes one AuditEvent (§9.3). Not every operation has a user. Background
workers act with no person and no key: on prod the actions `trace.publish`,
`trace.reserve`, `trace.revision.cleanup`, `dashboard.prerender`, `sessions.inactive` and
`session.purge.complete` all record `user_id = null` and `auth_method = "worker"`. Some
rows also carry `auth_method = "none"` (an unauthenticated call that still audits, e.g. an
auth failure per R-AUD-02). The audit output schema
(`packages/core/schemas/admin.ts`, `auditEventSchema`) already carries the fields that say
so: `user_id` and `user_email` are nullable and `auth_method` is a required string.

The admin Audit log (`apps/dashboard/src/pages/admin/audit.tsx`) and the audit record
dialog (`apps/dashboard/src/features/admin/audit-record.tsx`) rendered the actor from the
user alone. With no user they fell through to the "unavailable" placeholder (`—`), so a
legitimate worker action looked like a row with missing data. Nothing was wrong with the
data; the actor cell just had nothing to show because it never consulted `auth_method`.

## Decision

The actor an audit event is attributed to is derived once, in a single dashboard helper
`auditActor(event)` (`apps/dashboard/src/lib/display.ts`), and both the table cell and the
record dialog read it. The helper resolves, in order:

- a user's email, with the raw `user_id` on hover (`kind: "email"`);
- the raw `user_id` when the email has not resolved (`kind: "id"`);
- otherwise a system actor from `auth_method` (`kind: "system"`): `auth_method` "worker",
  "none" or empty reads as **System**, and any other userless method shows its own name so
  the cell is never blank, with the method on hover.

The label string "System" lives in `copy.admin.audit.system`
(`apps/dashboard/src/copy/admin.ts`), like every other user-facing string. The table cell
styles by `kind` (monospace for a raw id, muted for the system actor). This keeps one
implementation of the actor decision instead of duplicating the branching in two adapters.

Sorting and filtering are unchanged: both are server-side (`user_id` sort key, `user_email`
filter). The change is display only, and a null user no longer produces a blank cell.

## Consequences

- A worker/background row shows **System** (was a blank/`—` cell that read as missing data);
  hovering shows the raw `auth_method` (e.g. "worker"). An unauthenticated `none` row reads
  the same way.
- The record dialog's User row now prefers the human-readable email for user events
  (consistent with the table), with the raw id on hover, and shows **System** for userless
  events. Previously it showed the raw `user_id` and `—` for workers.
- No schema, API or copy-key contract changed. `auth_method` was already in the audit
  output, so no server change was needed; had it been absent the dashboard would have had to
  fall back to labeling any null user as System.

## Alternatives considered

- **Show the raw `auth_method` value ("worker", "none") in the user cell.** Honest but
  reads as a field dump; "System" is what a person means by a background action, and the raw
  method is still available on hover. Kept the raw value as the fallback only for
  unrecognized userless methods.
- **Fix the value at the API/service layer** (fill a synthetic actor when there is no user).
  Rejected: the audit corpus should record what happened (`user_id = null`,
  `auth_method = "worker"`); "System" is a presentation choice and belongs in the dashboard.
- **Handle it inline in `audit.tsx` only.** Rejected: the record dialog renders the same
  actor, so the decision moved into one shared helper to avoid two divergent code paths.
