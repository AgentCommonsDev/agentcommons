# ADR 0046: Record and embedding usage billing

Status: accepted. Supersedes the session allowance and Pro hard cap in ADR 0038.

The product owner requested consumption pricing on new records and optional embeddings.
Capture is measured by first accepted persisted RawRecord IDs, using the existing source
identity algorithm. Native rewritten document versions can therefore add records. We do
not invent a second native-event identity parser. Successfully indexed Message IDs are
metered once, regardless of chunk count or later rescan; failed/stale vectors are excluded.
Admission ledgers have no foreign key to purgeable transcript rows and contain no payload.

Free admits 1,000 records per UTC month. Pro includes 10,000 records per native subscription
period for $100/month, then configured per-1,000 overage. Embeddings add $50/month and a
separate configured per-1,000 message rate. Customer/public deployments never enforce or
send SaaS usage. Rates are operator input, never invented as live prices.

Better Auth remains the subscription authority. Distinct licensed $100 `pro` and $150
`pro_embeddings` primary prices avoid ambiguous matching of multiple plans sharing a
primary price. Native plan `lineItems` add the capture meter and, for the enhanced plan,
the message meter. Checkout/plan changes remain owner-cookie operations. A signed active
native subscription, global provider capability and the organization opt-in are all
required for SaaS embedding work; self-hosted work requires only the latter two.

Paid admissions create an outbox record in the same transaction as successful persistence.
Native pg-boss delivery uses the official Stripe SDK, immutable event identifiers and
idempotency keys, and serializes each customer/meter. An uncertain event older than 23
hours since first dispatch is paused for reconciliation, because Stripe only guarantees
identifier uniqueness for at least 24 hours. This avoids treating indefinite retries as
exactly-once external delivery. No successful HTTP response is claimed to prove Stripe's
asynchronous aggregate has updated. Events beyond the 35-day recording window also pause.
Usage exposes pending/paused counts and the operator resolves ambiguous events against
Stripe before allowing a new delivery identity. Automated retries never invent a new ID.

Sources: [native plan line items](https://better-auth.com/docs/plugins/stripe),
[Stripe meter event identifiers and timestamp limits](https://docs.stripe.com/api/billing/meter-event/create),
[Stripe idempotency retention](https://docs.stripe.com/api/idempotent_requests), and
[recording usage and concurrency](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api).

Validation must exercise actual Postgres admission/rollback/concurrency/purge, official
SDK requests against a local protocol server, timeout retry and 23-hour ambiguity pause,
native subscription reconciliation, both organization modes and browser plan changes.
Local SDK fixtures are not evidence of live Stripe account configuration or real charges.

The native existing-subscription upgrade branch previously copied only the requested
plan and seats after Stripe returned an updated subscription. An official-SDK local
protocol experiment returned `past_due` after an upgrade while the native database kept
`active`, incorrectly retaining paid access. The tracked native patch now shares the
same subscription field projection used by the webhook updater, using the actual SDK
response status, period, cancellation fields and recognized plan. It does not create
synthetic events or a second subscription model. The server supplies the native
`returnUrl` explicitly; an internal completion URL becomes a nullable checkout result.

Finance and verified webhook transactions lock the organization before changing native
subscription rows. After remote SDK work finishes, they acquire the shared trace
publication write lock before committing. Thus a bounded ClickHouse read sees one
entitlement state throughout its query, without holding the publication lock over an
external Stripe request. Tests hold an actual reader lock, observe the remote retrieval,
and prove that entitlement commits wait for the reader to finish.
