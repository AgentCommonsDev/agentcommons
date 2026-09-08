# ADR 0035: Native verified-domain organization enrollment

Status: accepted, 2026-09-08.

The customer instance must admit verified Google identities from its configured
organization domain without an administrator entering each email first. The existing
domain setting only restricted login; it did not create organization memberships.

Use Better Auth SSO 1.7.3 for persisted domain bindings, DNS ownership verification,
and member provisioning. Its native callback hook supports the existing Google social
callback. It requires a verified canonical email, a verified matching domain, and an
unambiguous organization. The assigned role is `member`; an existing membership is
never upgraded or replaced. Provisioning is enabled only with Google as the sole
configured provider, open SSO signup, and an explicit allowed-domain list. Existing
customer defaults and manually provisioned email access remain available.

An isolated experiment with the official memory adapter and real native owner session
confirmed that `registerSSOProvider` accepts a domain and organization with no OIDC or
SAML configuration. This stores a domain binding without copying Google credentials or
introducing another login provider. Native registration returns a verification token;
requesting it again reuses the active token. Anonymous and ordinary-member requests
were rejected. The application integration tests repeat the contract on PostgreSQL.

The operator command reads a private file containing a real owner's or administrator's
Cookie header value. It calls the native APIs inside the existing audited transaction.
Registration and verification are idempotent service operations. Provider IDs derive
deterministically from the organization and domain, remaining short enough for the
native DNS label. The output contains the actual native TXT record. Tokens and cookie
contents are not audit detail. Provider management and SSO protocol routes remain
unavailable through the public authentication adapter.

Physical member deletion would cause the next matching login to enroll the user again.
Keep a removed native Member with `removedAt` and `suspended=true`. The native existing
member check sees this row; application authorization, lists, organization selection,
and member denominators exclude it. Authorized add-people restores that same row with
the requested permitted role and clears removal and suspension. Ordinary login cannot
restore it. This preserves existing key-authority semantics: removal blocks keys, while
an explicit restoration can restore otherwise-valid keys. It adds no separate deny
table, permanent key revocation, invitation lifecycle, or identity implementation.

Removal also invalidates initial password-setup tokens while the target has no auth
accounts. A real PostgreSQL regression showed that an old organization's setup link
otherwise remained usable after removal and admission into another organization.
Established identities retain their operator recovery tokens; this rule only closes
the unclaimed-identity setup window, using the existing shared native-token cleanup.

Better Auth generates `SsoProvider` and the additional Member field. Migration 018 is
generated from that schema change and grants no reader access to provider configuration.
The native callback, membership changes, and provider operations remain inside the
application's transaction and audit boundary; a failed audit rolls back their changes.
