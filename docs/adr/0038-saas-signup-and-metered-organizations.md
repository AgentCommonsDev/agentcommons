# 0038. SaaS signup and metered organizations

Status: accepted. Supersedes the billing/self-service exclusions in ADR 0011 for an
explicit SaaS instance mode only. Customer defaults and deployment deferral remain.

The requested hosted offering needs public signup, monthly allowances and billing.
It uses the existing application and organization boundary. Better Auth owns verified
identity, organization creation and Stripe subscriptions. The application owns a small
immutable admission ledger, because session retention and subscription lifecycle are
different facts. An accepted session continues uploading even when the organization
reaches its new-session cap.

Free defaults to 1,000 sessions/month; Pro is $100/month for 10,000. These are provisional
operator-configurable allowances selected from the pending product choice. Calendar
months in UTC keep limits intelligible and prevent upgrades resetting consumed usage.
Session identity is lifetime-scoped; purge never buys back capacity. Existing captures
when SaaS is enabled are grandfathered. An organization lock and the ingest transaction
make quota enforcement atomic without a separate distributed counter.

Verified users without an eligible membership can onboard one organization once.
The native library owns its owner membership. This is not arbitrary organization
creation by any authenticated user. Customer email-list admission stays unchanged.
Native verification hooks and standard mail transports serve SaaS signup; welcome
delivery is a durable job after onboarding, independent of membership transactions.

Native Stripe owns customer, subscription and webhook handling. Server-derived
organization references and prices prevent a client from purchasing or managing another
organization's plan. Signed webhooks and native paid state grant entitlement; redirects
do not. Native failure semantics must be experimentally verified, with narrow documented
corrections if necessary. Test protocol fixtures are distinct from live Stripe test mode.

One runtime plan configuration supplies admission, public pricing and usage. Customer
instances expose none of the SaaS UI. Enterprise inquiries use an operator-configured
Cal.com URL. No SOC 2 badge is published without evidence of a completed audit.

Verification requirements are R-SAAS-01 through R-SAAS-07 in REQUIREMENTS.md. Cloud
deployment remains outside this local implementation run.

The pinned Better Auth Stripe 1.7.3 experiment returned HTTP 200 when its official
Stripe SDK received a 503 during subscription reconciliation: four native handlers
caught and logged errors before returning success. A second signed-event experiment
sent cancellation followed by an older active update and restored the stale active
status. The tracked pnpm patch rethrows those four failures and retrieves the current
Stripe subscription in the native created/updated/deleted handlers. Checkout already
retrieves it. No subscription projection or signature algorithm is copied into the
application. The service verifies the raw signed event with the official SDK, acquires
an advisory lock for that verified customer, and invokes the native handler (including
its own signature verification) in the same transaction. READ COMMITTED ensures a
callback that waited for the customer lock sees the previous committed projection.
Failure returns non-2xx for Stripe retry; audit and native projection commit together.

The native checkout success endpoint also writes subscription state. The application
therefore intercepts that exact GET route, audits the return, and redirects to `/usage`
without executing its native projection. Signed webhooks remain the entitlement update
boundary. Configured Stripe prices must be active USD 100 monthly licensed prices;
a metered, yearly or differently priced product cannot be sold as the fixed Pro plan.

SaaS enables Better Auth's native email verification and emailed password reset. This
is an explicit exception to customer mode's manual operator recovery. Native password
signup cannot overwrite a provisioned identity. SaaS also enables the native
`requireLocalEmailVerified` account-linking guard: public password signup makes an
unverified local identity unsafe to link implicitly with Google. Such an identity must
verify its email first; customer mode retains its admin-provisioned linking behavior.
SaaS corpus access requires a currently verified identity for both cookies and keys.

The native organization API creates the verified user's first organization through its
server-side API after the service verifies a real cookie. A generated User additional
field records the onboarding organization. A user row lock and transaction retry make
concurrent submissions return the same organization. An eligible existing membership
avoids creating another organization; a removed onboarding membership cannot buy a new
free organization. Native Member/Organization records remain authoritative.

Nodemailer supplies SMTP and AWS SES v2 transports. Verification and reset use native
Better Auth delivery hooks. The generated User `welcomeQueuedAt` field and native
pg-boss singleton job are written in the onboarding/authentication transaction after
verified identity and membership exist. Jobs contain only the user ID, never credentials
or email-link tokens. SMTP retries use a stable Message-ID; SMTP does not guarantee
provider deduplication after an ambiguous acknowledgement. Mailpit tests demonstrate
local SMTP delivery, not production SES delivery.

The real HTTP regression also found that an unknown Stripe price retained the previous
native `plan: "pro"`, and duplicate created events skipped current-state reconciliation.
The patch routes existing created events and unknown-price checkout events through the
same native update helper. That projection clears the plan string when no configured
plan matches, retaining the actual Stripe status and paid-period fields. Empty plan
means no configured application plan; it is not a fabricated Stripe lifecycle status.
Consequently every relevant event type can remove stale Pro entitlement. The admission
service still reads only native active, in-period, configured Pro rows.

Concurrent onboarding exposed PostgreSQL serialization errors surfaced by Prisma's raw
row-lock API as P2010/SQLSTATE 40001, instead of P2034. The existing bounded membership
transaction retry now recognizes those native serialization/deadlock SQLSTATEs as well.
It does not retry arbitrary database errors or weaken the isolation level.

Deployment configuration keeps Stripe and SMTP credentials in Secrets Manager. SES uses
an operator-supplied verified identity ARN and a From-address condition on the API task's
`ses:SendEmail` policy. The migration task has a separate role without mail permission;
non-SES stacks receive no mail grant. This avoids distributing static AWS mail keys or
granting access to every SES identity. Sender verification and production sending access
remain provider prerequisites, not resources silently created by the application.

ADR 0043 supersedes the global one-organization creation restriction: initial onboarding
remains idempotent, while verified SaaS users may explicitly create another organization.
