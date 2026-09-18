# ADR 0091: On-prem deployments may run SSO-only (passwords off with a provider)

## Status

Accepted. Builds on ADR 0049 (owner/admin Google sign-in domain allowlisting) and the
instance login configuration in spec §9.1 / Appendix B. Enabled by default on the
Goodhart Labs single-node deployment (`zpghl`).

## Context

Some deployments — on-prem installs like Goodhart Labs among them — want every person to
sign in through an identity provider (Google) and to have no email/password option at all,
so an account cannot be created or held with a password. The requirement is per
_deployment_, not per organization: the whole instance is SSO-only.

The mechanism already exists. `createAuth` (`apps/api/src/auth/config.ts`) builds Better
Auth once from static configuration and registers `emailAndPassword` only when
`emailPasswordEnabled` is true; it refuses to boot unless at least one login method — email/
password or a social/OIDC provider — is configured. Setting `AUTH_EMAIL_PASSWORD_ENABLED=false`
with `AUTH_SOCIAL_PROVIDER=google` (plus client id/secret) therefore yields a bootable,
Google-only instance: the `/auth/sign-in/email` and `/auth/sign-up/email` endpoints are never
registered, admin member-add issues no password setup link (`membership.passwordSetup` throws
`PASSWORD_DISABLED`), and `GET /auth/config` reports `email_password_enabled: false` so the
dashboard login shows only the provider button.

What did **not** exist is a per-_organization_ `ssoOnly` toggle. Because Better Auth is a
single static factory that does not re-read configuration per organization at sign-in, and
because a password credential is a global (per-user) account rather than a per-organization
one, correct per-org enforcement is a separate, larger, security-sensitive feature (runtime
email→organization resolution injected into the `/auth` handler for both sign-in and sign-up,
a new settings column and migration, service/route/tool/UI, and edge-case tests for multi-org
users and unclaimed identities). It only matters for mixed-mode multi-org / SaaS instances,
not for a single-org on-prem box.

## Decision

- SSO-only is a supported **deployment posture**, not a new code path: it is
  `AUTH_EMAIL_PASSWORD_ENABLED=false` with a provider configured. No new flag is introduced
  (one implementation per concept).
- The Goodhart Labs deployment (`infra/Pulumi.zpghl.yaml`) ships with it on. Google is the
  provider; `zeropath.com` and `goodhartlabs.com` are the enrolled, verified sign-in domains.
- Per-organization SSO-only enforcement is **deferred** to a future ADR, to be written when a
  multi-org / SaaS instance actually needs it.

## Consequences

- People sign in only through Google on the SSO-only instance; there is no password to create
  or reset. API keys (`ac_` bearer) are unaffected, so the hook uploader and agent MCP keep
  working.
- Flipping the flag on an existing instance locks out any account that has only a password and
  no matching provider identity. Before enabling it on `zpghl` we verified (read-only) that all
  11 members already have a Google login and both domains are verified-enrolled, so no one is
  locked out; account linking (`config.ts`) matches a Google login to an existing identity by
  verified email. Any deployment turning this on must run the same check first, and must enroll
  the provider domain before disabling passwords so the first owner can still get in.
- Existing coverage carries the posture: `auth-environment.test.ts` (flag parsing),
  `auth.integration.test.ts` (a provider + passwords off boots; no-method refuses to boot),
  and `instance-mode.integration.test.ts` (the `googleOnly` application fixture). Requirement
  R-AUTH-01 (§9.1) already governs "email/password and/or one provider; boot fails with none".
