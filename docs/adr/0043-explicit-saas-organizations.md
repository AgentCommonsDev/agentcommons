# ADR 0043: Explicit organization creation in SaaS

Date: 2026-09-08
Status: Accepted

The initial onboarding marker prevents retries from creating extra organizations. It
should not prevent a verified SaaS user from intentionally creating another organization.
The organization picker now exposes that explicit action in SaaS. Customer and public
instances retain operator-only creation.

Use the existing native organization creation helper with an initial/explicit intent.
Both require a verified native cookie, serialize the user and requested slug, create the
native owner membership, seed organization policies, select the native active organization,
and audit the transaction. Initial onboarding keeps its original marker and access checks.
Explicit requests can create another organization; retries for an active owned slug select
the same organization without renaming it. Other users' slugs and removed/suspended owner
memberships return a conflict. No membership is restored implicitly.

Keys, corpus and billing continue to use immutable organization references. A new
organization starts with its own Free allowance; another organization's subscription does
not apply. Native welcome delivery remains once per identity. Real PostgreSQL/HTTP tests
cover concurrent retries and competing creators, audit rollback, mode/authentication gates,
selection, and isolation. The API and UI reuse the onboarding name/slug and result schemas.

Four concurrent retries reproduced exhaustion of the previous three-attempt Serializable
loop, even though only one organization was created. This helper now uses READ COMMITTED
with explicit user-row and canonical-slug transaction locks. Each waiter observes the
committed result after its lock acquisition; the original retry limits and isolation for
other membership operations remain unchanged. Native uniqueness still protects collisions
with operator bootstrap, and the shared retry helper handles actual constraint races.
