# ADR 0093: Per-organization SSO-only is enforced by the email's sign-in domain

## Status

Accepted. Refines ADR 0091 (which deferred per-organization SSO-only to "a future ADR")
and builds on ADR 0049 (owner/admin Google sign-in domain allowlisting, one organization
per domain). Distinct from the instance-wide `AUTH_EMAIL_PASSWORD_ENABLED` posture of
ADR 0091, which stays as-is.

## Context

ADR 0091 made SSO-only a whole-instance deployment posture (`AUTH_EMAIL_PASSWORD_ENABLED=false`
with a provider) and deferred a per-_organization_ toggle, because Better Auth is a single
static factory that does not re-read configuration per organization and a password credential
is a global per-user account, not a per-organization one.

A mixed-mode instance (email/password enabled instance-wide, as in multi-org / SaaS) now needs
one organization to require SSO while other organizations keep passwords. The difficulty ADR
0091 named is real: there is no per-organization state on the account, and Better Auth cannot
be reconfigured per request. What makes a correct enforcement possible is ADR 0049: sign-in
domains are enrolled and verified per organization and are one-per-organization, so an email's
domain resolves to a single organization. That gives a per-request key — the email's domain —
to decide whether SSO is required, without reconfiguring Better Auth.

## Decision

- An organization may set `ssoOnly` (a `OrganizationSettings.sso_only` boolean, default false).
  The effect is **domain-scoped**: password authentication is refused for any email whose
  domain is one of that organization's enrolled, verified Google sign-in domains.
- Enforcement lives in the single `/auth/*` funnel (`AuthService.handle`), inserted after the
  route allowlist match and **before** `native.handler`, for the three credential paths only:
  `POST /auth/sign-in/email`, `POST /auth/sign-up/email`, `POST /auth/request-password-reset`.
  Social sign-in and OAuth callbacks are never gated. Because every `/auth` request goes
  through this method, the gate cannot be bypassed by calling the API directly. A refusal is
  `403` with error code `SSO_REQUIRED` and message "This organization requires SSO sign-in.";
  the dashboard login page keys off that code.
- The domain→organization→`ssoOnly` lookup (`apps/api/src/auth/sso.ts`, `domainRequiresSso`)
  reads `ssoProvider` (verified Google rows for the domain) then `organization_settings`. It is
  bounded (`ssoProvider` holds one row per enrolled domain) and defensive: should a domain ever
  map to more than one organization, any `ssoOnly` owner blocks. The gate is therefore
  domain-scoped and forces SSO regardless of the signing-in user's other memberships.
- The gate is **dormant** when instance email/password is disabled (`emailPasswordEnabled`
  false): native auth already refuses credentials then, so the check does not run. It matters
  only when email/password is enabled instance-wide.
- The gate **fails closed**: if the lookup errors, the request is refused with `503`
  `AUTH_UNAVAILABLE` (cause logged), never allowed.
- Admin member-add (`membership.add`) and operator bootstrap issue **no** password setup link
  when the new member's domain requires SSO; that address can only sign in through the provider.
- The setting is read and written through `GET`/`PUT /organization/sso` under effective admin
  authority; every mutation is a `mutationOperation` that locks the organization row and audits
  `organization.sso.update`. It is REST-only, matching the embeddings settings template, which
  exposes no MCP tool: `ssoOnly` is a human admin setting rather than an agent capability, and
  `AUTH_SSO_ONLY_ORGS` covers deploy-time / on-prem enforcement, so no `/admin/sso` route or
  MCP tool is added (one implementation per concept).
- Versioning uses a **dedicated** `OrganizationSettings.sso_revision` counter, not the existing
  `revision` column: `revision` is an embeddings epoch folded into the vector digest
  (`embeddings/service.ts`), so moving it for an SSO change would trigger org-wide re-embedding.
  An SSO change has no trace-read effect, so — unlike embeddings — it never holds the trace
  publication fence.
- A named organization can be defaulted to `ssoOnly` at boot by the new `AUTH_SSO_ONLY_ORGS`
  environment variable (comma-separated slugs). The boot reconcile in `main.ts` is idempotent:
  it writes the setting (and audits `organization.sso.reconcile`) only when it is not already
  on, so the revision does not churn on every boot. The variable is set by the orchestrator for
  the hosted default, never in Pulumi config.

## Consequences

- On a mixed-mode instance, an `ssoOnly` organization's people cannot sign in, sign up, or
  request a password reset with a password; they use the provider. Other organizations are
  unaffected. API keys (`ac_` bearer) are unaffected, so the hook uploader and agent MCP keep
  working.
- Turning `ssoOnly` on for an organization whose members hold only passwords (no matching
  provider identity) locks those members out until they sign in through the provider (account
  linking matches a verified provider email to the existing identity). Enroll and verify the
  provider domain before enabling.
- The instance-wide posture of ADR 0091 is unchanged and independent; the two can coexist.

## Alternatives considered

- **Reuse the shared `revision` column.** Rejected: it is an embeddings epoch; reusing it would
  cause spurious re-embedding across the organization. A dedicated `sso_revision` isolates the
  concern.
- **Resolve the organization from the user's active membership rather than the email domain.**
  Rejected: a password sign-in has no session yet, and a multi-org user could evade the gate via
  a non-SSO organization. Domain scoping (ADR 0049 one-org-per-domain) is the correct key and is
  independent of the user's memberships.
- **Fail open on a lookup error.** Rejected for a security gate; the feature fails closed.
- **Expose the setting as an `admin_sso_*` MCP tool** (mirroring `admin_domains`). Rejected:
  it duplicates the REST surface for a human admin setting that agents do not need, and the
  embeddings settings template it follows is REST-only. Deploy-time enforcement uses
  `AUTH_SSO_ONLY_ORGS` instead.
