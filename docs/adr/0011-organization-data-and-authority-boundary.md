# 0011. Organizations are data and authorization boundaries

Date: 2026-09-07 · Status: accepted · Amends the single-organization scope in spec v3

The owner requested organization-scoped permissions, API keys, queries, and data so
the same application can serve self-hosted teams and hosted customers. The initial
enterprise scope is operator-created organizations and access granted by entering
email addresses. The owner explicitly declined CSV import and outbound invitations.

Use Better Auth's organization plugin for organizations and memberships,
and its API-key plugin's native organization references. A domain ApiKeyOwner row
retains issuing-user attribution and supports immediate loss of key authority when
that user's membership changes. Global user roles never confer tenant data access.

Every service receives one authenticated organization. Domain foreign keys prevent
cross-organization relationships. Reader views require transaction-local organization
context plus the existing visibility check. Repository code sets context; the SQL AST
allowlist prevents client queries from changing it. Policy caches, jobs, budgets,
cursors, and live streams use the same boundary. Database tests exercise two
organizations, including an admin in each and one user with different roles in both.

Instance operators provision organizations with the bootstrap CLI. Team admins add
emails to membership, provisioning identities through Better Auth when needed. Verified
SSO may match the identity; password access requires a manually delivered, single-use
setup link or credential. Email knowledge alone cannot claim a provisioned account.
No duplicate domain allowlist or outbound email system is needed. The UI supports switching
organizations, membership management, and organization-bound keys. The last owner
cannot be removed or demoted.

Identity credentials are global. Organization admins can issue initial setup only
before any authentication account exists and while that identity belongs solely to
their organization. The unclaimed identity cannot join another organization yet.
Native account creation invalidates outstanding setup tokens. Resetting an established
identity is restricted to the instance-operator recovery CLI; an organization admin
must never gain an account that also has authority in other organizations.

No billing, self-service organization creation, CSV import, SCIM/group synchronization,
or per-organization identity-provider management is added. Suspicious-agent-behavior
detection remains a README future-work note, as requested. Deployment remains deferred
until local verification is complete.
