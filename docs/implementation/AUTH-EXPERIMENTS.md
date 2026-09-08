# Better Auth implementation experiments

Verified against Better Auth, `@better-auth/api-key`, and the `auth` generator 1.7.3,
Prisma 6.19.0, and real PostgreSQL 16 on 2026-09-07. Executable evidence lives in
`packages/db/test/auth-prerequisites.integration.test.ts`. These experiments establish
library contracts for §17 step 3; they do not claim the application's auth routes,
authorization matrix, or audit integration are complete.

## Canonical plugin configuration and generated ownership

`@agentcommons/db/auth-plugins` exports `authPlugins(oauthProviders = [])`. It installs
Better Auth's `admin`, `organization`, `apiKey`, `genericOAuth`, and `openAPI` plugins.
The organization plugin disables public organization creation, retains native
owner/admin/member permissions, and extends the native access-control statements with
`apiKey` create/read/update/delete for all three roles. Organization-key operations
otherwise fail for ordinary members and admins with the library's default roles.
Services must still restrict members to their own keys; native plugin management
endpoints must not be directly exposed.

The API Key plugin uses `references: "organization"` and prefix `ac_`. Its own generic
rate limiter is disabled because the application's per-operation, per-organization
limits have different budgets. The native plugin hashes key values. Its stored
`referenceId` is the organization, not the issuing user. `ApiKeyOwner` retains the
issuing user and organization separately; database grants prohibit the application
from rewriting or deleting that attribution.

`Member.suspended` is generated through the organization plugin's
`schema.member.additionalFields`, with `input: false`. Native role mutation endpoints
do not update arbitrary member fields; suspension requires updating this configured
extension through Better Auth's exposed adapter within the same transaction after
service authorization. The experiment executes `context.adapter.update({ model: "member", where,
update: { suspended: true } })` on the transaction-bound auth context and verifies
the generated field is persisted. This is a membership extension, not a separate
account system.
The library owns the unused Invitation model; no invitation workflow is exposed.

Regeneration is `pnpm --filter @agentcommons/db db:auth-generate`. Domain models live
in a separate Prisma file and are never inserted into the generated auth file.

## Admin-entered email, native membership, and bootstrap

These server calls were executed successfully:

```ts
const { user } = await auth.api.createUser({
  body: { email: "person@example.test", name: "Person" },
});
const organization = await auth.api.createOrganization({
  body: { name: "Organization", slug: "organization", userId: user.id },
});
await auth.api.addMember({
  body: {
    organizationId: organization.id,
    userId: otherUser.id,
    role: "member",
  },
});
```

Omitting `password` creates a user with `emailVerified: false` and no credential
account. Email is normalized to lowercase. An unknown password cannot sign in, and
`emailAndPassword.disableSignUp: true` rejects public password signup with HTTP 400.
The product always uses that setting: otherwise an attacker could preclaim an email
before an administrator adds it. The SSO admission setting does not enable password
signup.

`createOrganization` recognizes a server call with `userId` as an operator action,
even with public creation disabled. Do not pass that server-only parameter from a
public route. The call creates the first owner membership. `addMember` is server-only;
it rejects an existing membership instead of silently changing its role. Services
look up existing users/members and return their unchanged state. They serialize
membership changes by locking the organization row inside the transaction, including
last-owner checks and concurrent add operations.

## Password setup without sending email

Use native `emailAndPassword.sendResetPassword` to capture the generated URL/token
in the authorized operation's memory, then return the URL to the administrator only
after the transaction commits. The callback sends no email. Do not persist the URL
in audit detail or expose an unauthenticated endpoint that returns it.

```ts
await auth.api.requestPasswordReset({
  body: { email, redirectTo: `${publicUrl}/reset-password` },
});
await auth.api.resetPassword({ body: { token, newPassword } });
```

The native reset creates the first `credential` Account when none exists. The test
verifies successful sign-in, hashed password storage, expiry, and rejection of token
reuse. Reset does not mark the user's email verified. Password identities originate
only through administrator/operator provisioning, and the single-use setup token is
manually shared with the intended person. This avoids an email-sending subsystem.

## Verified SSO linking and callbacks

Generic OAuth 1.7.3 registers providers in `signInSocial` and the standard
`/auth/sign-in/social` and `/auth/callback/:provider` endpoints. The old plugin-specific
OAuth endpoints are not used. Tests run the real request handler, state cookie,
callback, and account-linking pipeline with a controlled provider's token/profile
callbacks; they do not claim validation against a live identity provider.

The tested linking configuration is:

```ts
account: {
  accountLinking: {
    enabled: true,
    requireLocalEmailVerified: false,
    trustedProviders: [],
  },
},
user: {
  validateUserInfo: ({ user, source }) => {
    if (source.method === "oauth" && user.emailVerified !== true) {
      return { error: "provider_email_unverified" };
    }
  },
},
```

Better Auth defaults `requireLocalEmailVerified` to true. That default blocks even a
verified provider from linking to an admin-created, unverified placeholder. The
explicit false allows the verified provider to establish that identity. Leaving the
trusted-provider shortcut empty and validating incoming email verification prevents
unverified provider claims from taking over an allowlisted email. The test also rejects
a returning, already-linked provider whose current profile is unverified. Successful
verified linking reuses the original User and membership and sets emailVerified true.
Production OIDC configuration must retain the native provider's issuer, token, and
signature validation; the test's controlled provider callbacks are test fixtures only.

## Organization keys

The native signatures exercised are:

```ts
const key = await auth.api.createApiKey({
  body: {
    organizationId,
    userId,
    permissions: { sessions: ["read", "ingest"] },
  },
});
const verified = await auth.api.verifyApiKey({
  body: { key: plaintextKey, permissions: { sessions: ["read"] } },
});
```

Creation plus `ApiKeyOwner` attribution must share the mutation transaction. On every
application call, resolve the native key, immutable attribution, current membership,
and suspension. The plugin does not substitute for those organization-specific
application checks. Native revocation was tested with
`auth.api.updateApiKey({ body: { keyId, userId, enabled: false } })`: the row remains
and subsequent verification fails. Permissions such as `admin:*` never override current membership.

## Atomic native mutation plus AuditEvent

A Better Auth instance can use a Prisma transaction client directly through its
native Prisma adapter. This avoids fake sessions or global mutable adapter state:

```ts
const result = await prisma.$transaction(async (tx) => {
  const auth = makeAuth(prismaAdapter(tx, { provider: "postgresql" }));
  const member = await auth.api.addMember({ body: input });
  const audit = await tx.auditEvent.create({ data: redactedAudit });
  return { result: member, audit };
});
```

`makeAuth` represents the application's single configuration factory. The test uses
exactly `betterAuth({ database: prismaAdapter(tx, { provider: "postgresql" }), ... })`.
Do not enable a nested Prisma transaction in this adapter: it is already bound to the
outer transaction. A deliberate audit foreign-key failure rolls back the native User
and Member created earlier in that callback. The successful case commits all three.

`updateMemberRole` and `removeMember` require the caller's real cookie headers. Pass
those headers to the transaction-bound auth instance; the native organization plugin
then checks the caller's membership. The role-mutation experiment also proves audit
failure rolls the role change back. Membership mutation and password setup routes are
cookie-only; organization API keys retain corpus administration capabilities without
creating synthetic user sessions. The library's server API wrapper overwrites a
caller-provided internal context, so passing a fabricated session is not a supported
integration.

References: [Better Auth organization](https://better-auth.com/docs/plugins/organization),
[accounts and linking](https://better-auth.com/docs/concepts/users-accounts),
[email/password](https://better-auth.com/docs/authentication/email-password), and the
installed 1.7.3 source and executable tests above. Installed behavior takes precedence
where examples on the website lag the release.

## Production service validation

`apps/api/test/auth.integration.test.ts` repeats the native prerequisites against
`AuthService`, `MembershipService`, and `AuditService`, using the restricted `ac_app`
connection after the actual four-URL migration command. It also executes the real
`src/seed.ts` and `src/recover.ts` entry points.

The global identity boundary needs two protections beyond an organization membership
check. Initial setup is permitted only when the target has no Account rows and its
memberships all belong to the requesting organization. An unclaimed identity cannot
join a second organization. Once a native Account is created, Better Auth's
`databaseHooks.account.create.after` deletes outstanding native reset verifications;
`emailAndPassword.onPasswordReset` performs the same cleanup for sibling setup links.
The public handler uses a serializable transaction, so simultaneous sibling tokens
cannot create duplicate credential accounts. Established identity recovery remains
an operator command. The suite tests verified SSO claiming, retained-token replay,
expiration, simultaneous setup requests, and simultaneous cross-organization adds.

Membership mutations take an organization row lock, then target User row locks;
bulk targets lock in stable ID order. Serializable retries cover conflicting claims.
Two owners concurrently suspending themselves leave exactly one active owner. An
admin cannot grant ownership or change an owner's role, suspension, or membership.
The native membership endpoints still receive the caller's real cookie headers.

`AuthService.handle` is the only public native-auth bridge. Its explicit allowlist
exposes sign-in, callbacks, sign-out, session inspection, and reset-token consumption.
The native management, organization creation, invitation, recovery-request, and key
HTTP endpoints remain inaccessible. Adapters must use the services for those
capabilities. `authenticate` resolves the current organization membership on every
request and does not accept an organization override from an API key.

`authEnvironment` constructs built-in social providers from the library's provider
list and generic OIDC from discovery. OIDC sets native
`requireIdTokenVerification: true`, preventing incomplete discovery from silently
falling back to unverified ID-token decoding.

`auditFailure(audit, context, description, error)` is the shared service failure path.
It preserves operation input for redaction, stores one failure audit before throwing,
and marks the resulting ServiceError as audited so adapters cannot duplicate it.
Successful mutations write their audit through the same Prisma transaction as the
native operation. Authentication bodies and credential URLs are never audit detail.
