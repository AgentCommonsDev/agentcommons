# 0044. Organization control over embedding use

Status: accepted.

Organization administrators need to choose whether their corpus is sent to the configured
embedding provider. The deployment flag remains the operator capability and kill switch;
it does not opt organizations in. A separate domain-owned organization settings row stores
`embeddingsEnabled`, default false, and a revision. Native Better Auth models are unchanged.

Effective enablement requires both the deployment capability and the current organization
setting. Reads consult persisted state, without a process-local settings cache. The same
effective decision governs search, similarity, SQL discovery and vector visibility, worker
scheduling and provider reservations. The public OpenAPI document describes deployment
capabilities; authenticated configuration and service calls apply organization settings.
MCP tools and search input schemas remain unchanged. Disabled search uses lexical ranking;
a cursor created with vector ranking remains retryable rather than changing its ordering.

Members can inspect their organization's setting and indexing progress. An effective
administrator can change it with a reason, under the existing organization lock, with the
change and audit committed together. Enabling without an operator-configured provider
fails clearly. Enabling schedules native pg-boss catch-up for retained sessions. Existing
projection invalidation and fingerprint checks remain the indexing implementation.

Disabling stops new reservations and causes queued work to finish without dispatch.
A provider reservation committed before disable is already in flight: its one request may
finish and its reserved cost remains charged. Completion checks the settings revision and
discards stale results, including across disable/re-enable. No database transaction is held
across provider HTTP. Existing current vectors are retained but hidden while disabled;
re-enabling can reuse them. Source and redaction changes still invalidate them.

Provider configuration is not proof of provider health. The UI names the configured provider,
labels the deterministic fake provider as a test adapter, and shows indexing progress and
failures. Live OpenAI verification still requires a working operator credential.
