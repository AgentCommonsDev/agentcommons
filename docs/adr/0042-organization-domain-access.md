# ADR 0042: Organization administrators manage Google domain access

Date: 2026-09-08
Status: Accepted

The operator-only domain command left organization administrators without the domain
access control requested for Users. It also required open signup before a verified
binding could admit a new identity, which prevented the binding itself from acting as
an allow rule under the default invite mode.

Expose bounded domain listing and native registration/DNS verification through audited
organization services and generated REST contracts. Users displays the native TXT proof
and verification status. The existing CLI delegates to the same operation. Writes use
real native cookies and revalidate current owner/admin membership. An exact verified
Google domain admits new identities under invite or open; closed stays closed, and any
explicit operator domain restriction still applies. Better Auth performs provisioning,
including its existing-member check that preserves suspended/removed exclusions.

No custom domain identities, member insertion, invitation delivery, or general identity
provider editor is introduced. Native Google cryptographic verification, real DNS
responses, transaction rollback, organization isolation and browser interaction tests
cover this boundary. ADR 0035's operator-only UI restriction and open-only admission
condition are superseded; its native ownership and removal invariants remain.

The native proof uses a 50-character label plus a separator before the domain. Limit
enrollment to 202 domain characters (individual labels remain at most 63) so the actual
TXT name fits DNS's 253-character limit. Real DNS tests cover the maximum valid name
and reject the next character before creating a provider.
