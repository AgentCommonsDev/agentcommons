# ADR 0049: Sign-in domains are allowlisted by an admin without DNS verification

Date: 2026-09-08
Status: Accepted. Supersedes the DNS TXT proof of ADR 0035 and ADR 0042; their native
provider storage, Google-only eligibility, exact-domain, unambiguous-organization and
removal invariants remain.

## Context

ADR 0035 and ADR 0042 admitted Google identities from a domain only after the
organization proved DNS ownership through Better Auth's native TXT record. Registration
returned a `dns_record`, a second `verify` step polled DNS, and the Users page explained
both. In practice the people who administer an AgentCommons organization are rarely the
people who can edit the company's DNS zone, so enrollment stalled on a ticket to another
team for a proof that added little: the admin already controls who is a member.

## Decision

An organization owner or admin allowlisting an exact domain is the approval. `POST
/admin/domains {domain}` registers the native SSO domain binding for the current
organization and marks it verified in the same audited transaction. There is no
`/admin/domains/verify` route, no `dns_record` in responses, and the CLI has no `verify`
subcommand. Sign-in domains are managed on the Settings page, next to embeddings and the
default dashboard, and are listed with `GET /admin/domains` (`{enabled, items, cursor}`).

Admission still requires every other rule: Google must be the sole configured login
provider and signup not `closed` (otherwise the write route is not registered and the
service refuses with `DOMAIN_ENROLLMENT_DISABLED`); the identity's email must be
Google-verified; the email domain must match a binding exactly (no subdomains); exactly
one organization may hold that domain; a nonempty operator `AUTH_ALLOWED_EMAIL_DOMAINS`
still restricts admission; removed or suspended memberships are never restored by
login. Writes require a real owner/admin cookie for the current organization; API keys
cannot allowlist domains. Every registration is audited with the domain, provider id
and whether the binding was created or reaffirmed.

## Risk accepted and mitigations

An admin can allowlist a domain the organization does not own, for example `gmail.com`,
and every Google account on that domain could then join as `member`. This is accepted
because the admin has that authority already (they can add any email address as a
member) and because the consequences are bounded:

- the role is always `member`; existing roles are never upgraded;
- Google verifies the email, so an attacker needs a real account on the domain;
- a nonempty operator allowlist caps which domains any organization may bind;
- an ambiguous domain (two organizations) admits nobody;
- the binding is visible on Settings and in the audit log, and deleting membership is
  durable against re-login.

Operators who want ownership proof can keep `AUTH_ALLOWED_EMAIL_DOMAINS` to the domains
they have checked out of band.

## Consequences

- `SsoProvider.domainVerified` is set on registration; the column remains because Better
  Auth's SSO plugin reads it during provisioning.
- Requirement R-ORG-11 is rewritten; the domain-enrollment tests assert immediate
  admission and the absence of the verify route.
- Appendix B drops the DNS instructions; the deployment guide describes the allowlist.
