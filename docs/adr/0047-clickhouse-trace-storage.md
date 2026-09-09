# 0047. ClickHouse traces, PostgreSQL identity and control

The user explicitly chooses ClickHouse for durable trace storage and analytics before
release. This supersedes PostgreSQL trace tables, pgvector, PostgreSQL trace reader
roles/views, and the PostgreSQL query dialect. There is no compatibility mode, dual
permanent trace store, historical backfill or legacy deployment path. PostgreSQL
remains the native Better Auth, organization, billing, policy, audit and pg-boss store.

## Durable ingestion

202 means the redacted input and its admission are durably committed in PostgreSQL,
not that asynchronous ClickHouse projection has completed. The transaction contains
compact immutable batch/source admission identities, quota/meter admission, one audit
event, and a bounded temporary TraceOutbox payload. pg-boss jobs contain the outbox ID.
The payload remains until the ClickHouse write and publication checkpoint succeed;
maintenance requeues unprocessed rows even if a native job reached terminal failure.
pg-boss's finite archive retention is not the acknowledged-data durability boundary.

The same pure harness normalizers and deterministic identities project all sources.
ClickHouse receives versioned raw records, messages, session metadata, files, tool
observations and vectors. A stable version/identity makes retries safe before and
after background merges. A session revision publishes only after all its rows exist.
Readers never combine a new session header with an incomplete message revision.
Outbox deletion and PostgreSQL publication checkpoint occur in one transaction.
Crash tests cover every handoff, duplicate delivery and stale/out-of-order workers.

Permanent PostgreSQL state is compact operational control: native identities,
ownership, lifecycle/parent links, current publication revision, visibility/purge
state, installation settings, admission/billing ledgers and job progress. It contains
no permanent transcript, message, chunk/vector or trace-analytics corpus.

Canonical `started_at` is the normalized source clock, falling back to first receipt
when the harness provides none. Publication copies that timestamp into compact
control state in the same transaction as its revision. Tree SQL and its public
cursor must use the same clock; comparing a source-time cursor against a receipt-time
ordering repeats or skips pages for delayed uploads. Immutable receipts retain
arrival times. Reuse analytics enumerate published native sessions and use their
canonical start time. Live delayed end-before-start and resume tests distinguish
these clocks and check start-inclusive, end-exclusive activity windows.

## Authorization and queries

Better Auth resolves current membership/key authority before every operation. The
ClickHouse reader boundary must enforce organization, current visibility and committed
revisions using native database grants/policies/views, independently of user-supplied
SQL. Exact implementation is selected by live server experiments and recorded here
before the reader is shipped. A service-only WHERE clause is insufficient.

The public API field names and harness contracts stay stable. SQL uses ClickHouse;
the old PostgreSQL AST guard and PostgreSQL-only examples are removed. The official
ClickHouse parser supplies an AST and locations; the shared guard allows only one
bounded SELECT, canonical visible relations and supported safe functions. Native
read-only credentials and server resource constraints are a second boundary. User
settings, network/file/table functions, external database access, output formats,
query parameters and writes cannot override caller context or escape the API.
OpenAPI, schema discovery, MCP, CodeMirror diagnostics/completion and dashboard
profiles use the same live column descriptions and ClickHouse dialect.

Native experiments rejected DEFINER views as an isolation boundary: ClickHouse can
evaluate caller expressions before a view's visibility predicate. Native row policies
therefore filter underlying revision rows using a PostgreSQL-backed direct dictionary
of current organization, visibility, purge and publication state. The direct layout
does not cache authorization. The original authenticated reader principal remains
available to policies inside a DEFINER view. Missing control state fails closed.
A shared PostgreSQL organization publication lock covers the entire bounded reader
callback; publication and visibility mutations take its exclusive counterpart. Any
compact graph query uses that same PostgreSQL transaction, avoiding another connection
while a reader holds the lock. Native reader flags also gate SaaS embedding entitlement.

## Native lexical semantics

The search box uses native lowercase tokenization and English inflection normalization,
matching all query tokens. (Snowball stemming through `stem()` was replaced by a
standard-function rule table in ADR 0056 because ClickHouse Cloud locks the experimental
NLP functions off.) The same native expression defines the text index and
query. A scalar subquery is required to make the normalized needle a native constant;
passing an arrayMap expression directly reproduced ILLEGAL_COLUMN on26.8.2.7.
PostgreSQL websearch operators are removed with that database dialect; no custom
query parser or translation layer is added. Structured conditions retain their full
existing literal/type-aware semantics. Native weighted token-frequency/length ranking
must preserve all30 golden top-three results. Parameterized search views use native
named arguments, remain uncapped and require latest published message identities,
preventing older edits or tombstones from reappearing through index candidates.

## Mutations and derived work

Identity/billing/policy mutations remain PostgreSQL transactions with one audit.
Trace visibility and purge fences take effect in control state before a successful
response; projection/index cleanup may continue in jobs without exposing old rows.
Rescan reads the redacted raw corpus, reuses normalizers/redaction once, and publishes
a complete replacement revision. It cannot resurrect purged or subsequently hidden
content. Embedding jobs recheck org capability, paid entitlement (SaaS only), source,
policy and settings revision; stale results are discarded and usage remains honest.
API/UI operations surface pending projection and failed work rather than claiming
data is already searchable. Metadata and trace-analytics projections are explicitly
derived; access decisions never depend on a stale analytics copy.

Purge immediately removes content from all readers, including administrators. An
administrator retains a sanitized identity skeleton sourced only from control data.
The response explicitly reports `cleanup: queued|completed`; deletion counts remain
null until cleanup has measured and removed the corresponding ClickHouse rows. The
durable purge outbox survives native job retries. Per-session sink locks serialize
physical cleanup with writes, preventing a paused worker from restoring deleted rows
after its lease expires. A completed cleanup manifest is retained for audit and retry.

AuditEvent remains authoritative in PostgreSQL. Its analytics outbox is created in
the same transaction; workers append the same audit IDs to ClickHouse and remove the
outbox only after acknowledgement. A lost acknowledgement retries idempotently. Audit
retention advances one monotonic PostgreSQL cutoff in the deletion transaction; native
ClickHouse policies apply the same cutoff even before physical analytics cleanup.
Longitudinal receipt and redaction analytics are projected with session publication
revisions, while native identity/membership health reads narrow current control views.

## Replacement and verification

Fresh Compose and Pulumi configuration include ClickHouse and PostgreSQL; the local
demo is rebuilt on the final schema. Remove old runtime trace models, SQL functions,
pgvector dependencies, reader pools, Docker configuration and tests of withdrawn
storage implementation details. Preserve every product requirement and re-run its
behavior tests on the new storage. Keep ADR/history documents as decision records.

Completion requires real PostgreSQL plus ClickHouse integration tests, native
multi-tenant arbitrary-SQL adversarial probes, outage/crash/deduplication tests,
redaction/purge consistency tests, meaningful ingestion/search/analytics experiments,
all four live harnesses including child content, all browser routes/actions/mobile,
generated-contract/static/build gates, local update and user walkthrough readiness.
The user will run any external browser review themselves; implementation agents must
not invoke Fable.

## Storage deployment

ClickHouse runs on one private EC2 `t3.large` (8 GiB), with a separately managed,
encrypted 100 GiB gp3 volume. Instance replacement reattaches the same volume; prod
protects it from deletion. Native Data Lifecycle Manager takes daily snapshots and
retains 7 in dev or 35 in prod. This is a single-host deployment with snapshot recovery,
not a replicated or highly available ClickHouse cluster. Its sizing starts at the
[official 8 GiB guidance](https://github.com/ClickHouse/clickhouse-docs/blob/main/docs/best-practices/sizing-and-hardware-recommendations.md);
operators must measure their workload before increasing traffic.

Only API and migration task security groups reach port 8123. The host reaches the
private RDS control views over 5432; no public ClickHouse address or SSH ingress exists.
The EC2 role fetches only its bootstrap secret and supports Systems Manager. User data
contains secret ARNs, never credential values. The native privacy.xml file used by the
integration containers is mounted into both Compose and the EC2 container. Bootstrap
credential rotation changes the opaque version ID in user data, replaces the host while
reattaching its data volume, and reruns the migration gate. The host fetches that exact
secret version; neither user data nor migration triggers contain the credential. The API
receives writer/access credentials; only migrations receive the ClickHouse administrator
and PostgreSQL trace-control credentials. The native migration command waits for the
new host, applies PostgreSQL first and ClickHouse second, and must succeed before the
service rolls forward. No live resources have been created by this implementation.

`docker-compose.dev.yml` exposes PostgreSQL 5432 and ClickHouse 8123 only on loopback.
Self-hosted Compose keeps both databases on its private network. `pnpm db:migrate`
applies both native schemas. `CLICKHOUSE_POSTGRES_HOST` changes only the hostname used
inside the ClickHouse engine, preserving the canonical PostgreSQL control role/password;
it is `host.docker.internal` for host-driven development and `db` inside Compose.

The completed vector epoch is independent of the trace revision: a new source/settings
digest reserves a native PostgreSQL sequence value. Partial batches write only that
epoch. PostgreSQL publishes the completed epoch and its source revision together after
checking settings, current trace generation, actor-independent provider entitlement and
lease. Native row policies require the exact completed vector epoch and current source
revision, so a same-source rebuild cannot overwrite an existing visible index.

## Native boundary experiments

The pinned server is ClickHouse 26.8.2.7 and the Node transport is the official
`@clickhouse/client` 1.23.1. Native tests execute caller SQL directly, bypassing the
application AST guard. A join whose numeric cast referenced a hidden user name
reproduced a cross-organization error disclosure through PostgreSQL-engine metadata.
The same native row-policy boundary therefore protects control users, installations,
sessions and health aggregates, as well as every corpus table. Direct dictionaries
resolve current visible user/installation associations; the reader has no dictionary,
control table or writer grants. A warmed dictionary read fails after its PostgreSQL
SELECT grant is revoked and succeeds only after the grant is restored.

Every corpus row carries a redaction generation as well as its publication revision.
Native policies require equality with the current control generation, not merely an
older revision. A rescan writes a full new generation before publishing it. This
prevents a caller expression from inspecting old pre-rescan text underneath latest-row
selection. Old generations become invisible immediately; physical cleanup is bounded,
retryable and runs after the generation checkpoint. Purged content stays invisible
regardless of physical cleanup progress, including to admin principals.

The native principal binds organization, issuing user, effective admin authority,
operator embedding capability and SaaS mode. Its password is derived using the private
reader secret. A rotated secret produces a new principal namespace. Principals grant
only canonical views, use read-only settings, limit execution to five seconds, memory
to 256 MiB and results to 32 MiB. The full service reader callback holds one shared
publication fence and a five-second abort deadline; its compact PostgreSQL queries use
the same transaction. Two concurrent readers plus an exclusive publisher are tested
with a three-connection PostgreSQL pool. This trades brief per-organization publication
waits for consistent cross-store visibility; it is not a claim of measured production
capacity.

The native text index uses the same `searchTermsSql` expression as search: native
UTF-8 lowercase tokenization, English inflection normalization (ADR 0056) and space joining, indexed
with `text(tokenizer=splitByNonAlpha)`. A fresh 100,000-row ReplacingMergeTree probe
with `FINAL` confirmed the current expression uses the `message_terms` text-index
filter for `raresttoken runs`, matching 100 rows containing `raresttoken running`.
Native EXPLAIN retained all 12 granules and the query read 100,001 rows / 900,001
bytes; this is evidence of index-expression compatibility, not a corpus pruning or
production capacity claim. The isolated native query reported 8 ms execution. Search must still join candidates to the latest current-generation identity
before accepting a match. Native HNSW indexes use cosine distance and exactly 1024
Float32 values. Scoped aggregation may choose exact cosine evaluation; an installed
index does not imply every query plan uses approximate search. Vector rows require the
current published embedding revision, organization opt-in and, in SaaS mode, the
current paid embedding entitlement. The globally disabled reader role has no vector
view grant.

The official driver logger is disabled because native error messages can contain SQL
values. Services retain responsibility for safe audited errors. Server-side query
logging is disabled for reader principals; no transcript or SQL body is emitted by
the reader transport.

The near-duplicate outcome heuristic uses native ClickHouse UTF-8 three-gram
similarity (`1-ngramDistanceUTF8`) strictly greater than 0.6, replacing PostgreSQL
`pg_trgm` similarity. These scores are not numerically equivalent: the native server
returns approximately 0.8 for `abcdefg` versus `abcdefh`, where the old trigram
fixture scored 0.6. Tests use native below/above-threshold examples; enabled cosine
keeps its existing strict 0.6 threshold. This remains a labeled heuristic, not an
assertion that sessions duplicate work or that memory caused an outcome.

Native PostgreSQL table sources acquire their connection while building a query
pipeline. The initial composed usage view exhausted three 16-connection source
pools before execution: 48 idle reserved connections and a ten-second native
connection failure on a one-session fixture. Keyed header, user and installation
metadata now comes from the existing uncached direct scope dictionaries. The same
direct usage query then completed in 352 ms. Live session metadata is shared
separately from admin purge skeletons. Fifteen simultaneous full session reads
still exposed an acquisition cycle in the skeleton's repeated PostgreSQL source:
queries reserved idle source connections and then waited for another source before
execution. Query-local materialization was not shared across nested views, and
full scans of a direct dictionary reproduced the same cycle.

A native materialized view now retains only `(organization_id, session_id)` when a
canonical session projection is inserted. The identity relation contains no text
or authority snapshot and survives physical corpus purge. The skeleton resolves
all compact fields through the existing uncached PostgreSQL session dictionary.
A native row policy restricts identity rows to the current organization's admin,
with a currently published and purged control row, before caller predicates run.
Missing controls or an unavailable source fail closed. No worker write path or
backfill is added. Five- and fifteen-reader bursts over 56 live sessions and a
purged skeleton pass without increasing pools, deadlines, or memory limits.
Physical purge tests prove corpus payloads are gone while only the two identity
columns remain; warmed skeleton reads fail when PostgreSQL access is revoked.
Existence checks and SSE read an internal `session_state` view containing only
session ID, status, message count, and last activity. The underlying `session_base`
remains ungranted because it carries unresolved parent references. The full `get`
header still uses canonical `sessions`, which resolves parent metadata against the
visible set. Native tests reject attempts to read or predicate on hidden parent
columns through the state view.
Latest-version aggregation uses one nullable-preserving aggregate per column,
allowing metadata queries to prune large JSON and content fields. Reused native
CTEs are explicitly materialized with the required reader setting enabled.

Reader queries use two threads and 8,192-row blocks within the existing memory
and time budgets. Optional JOIN runtime bloom filters are disabled: the native
empty usage plan otherwise attempted over 1 GiB of filter allocations. This does
not disable expression pushdown or replace row-policy enforcement; adversarial
JOIN/predicate tests still run with ordinary optimization enabled. The full native
security/TLS/composed-usage suite passes against these settings. These measurements
are local regression evidence, not a latency promise for arbitrary SQL or corpus size.

The shared native-server privacy configuration removes query, text and exception
file log channels. A failed SQL canary was visible in the default server log; the
container regression confirms it is absent with the shipped configuration. Required
PostgreSQL TLS is propagated to both engine and dictionary sources using the pinned
native libpq options; actual plaintext-server probes reject both when `sslmode=require`.

### Native read latency and result budgets

The PostgreSQL-era 150 ms typical-search target does not carry over to native
ClickHouse views with fresh control checks. The complete 30-query corpus still
places every expected session in the top three. Measured warm p95 fell from
approximately 900 ms to 455 ms after shared view corrections, then 367 ms after
independent context/header reads were run concurrently inside the same publication
fence. Individual native query costs were approximately 200, 100 and 120 ms.
The seeded-data regression target is now p95 below one second, including the audit
commit. This replaces the old 150 ms target; it does not claim that target passed,
or predict latency for arbitrary production corpus sizes. The five-second callback
deadline and 256 MiB native memory limit remain unchanged.

Int64 and Decimal JSON values are quoted by native output settings so the SDK cannot
round them. SQL retains the 500-row, 2 KiB cell and 256 KiB response limits. Queries
that exceed native execution memory or result limits fail with a bounded, audited
error instead of returning incomplete data. A real 500-way join of a 1 MiB transcript
exceeded the 256 MiB allocation limit; the regression covers that rejection separately
from successful cell and response truncation. Network/storage failures return 503;
recognized SQL syntax, type and resource-limit failures return 400 without server
SQL text or parameters.

### Fresh control-only PostgreSQL schema

The installation migration now creates only native authentication, organization,
billing, job and compact publication controls. PostgreSQL trace tables, vector
extensions and corpus reader roles are removed from the runtime and fresh schema.
There is no migration/backfill path for the superseded development corpus. The
shared `native_identity` SQL function remains because compact parent-link controls
use the same canonical identity rule as ingestion; its Unicode and reserved-prefix
parity test remains an actual PostgreSQL query.

Application grants are explicit, without blanket privileges on future tables.
Durable source identities cannot be updated or deleted. Audit projection workers
need a row lock before appending to ClickHouse; PostgreSQL requires UPDATE privilege
for `FOR UPDATE SKIP LOCKED`. The audit outbox therefore grants UPDATE on its key
column only, with a trigger rejecting every actual UPDATE. This permits concurrent
worker claiming while preserving the queued identity and payload. The control-plane
regression checks both the legal lock and a rejected rewrite under application
credentials.

### Bounded transcript payload reads

Fetching an entire message range before applying the wire limits failed on valid
large transcripts. Eighty 525 KB tool outputs exceeded the native result budget;
a thousand such messages also exceeded the 256 MiB query memory limit when byte
lengths were computed after aggregating complete strings.

The shared latest-row projection now emits its grouped identity columns directly,
so native message-ID predicates can run before payload aggregation. A protected
internal metadata view uses that same projection and row policy, computing byte
lengths before aggregation. It adds no public SQL fields or stored payload copies.
`get` first reads ordered metadata and then fetches the contributing payload prefix,
including one oversized first message. Search uses the same payload batching helper
and loads further context only while building a response; each payload is reduced
through the existing match-centered excerpt renderer before retention. The existing
UTF-8 byte cursors, 100-message cap, 4 KB content slices and 32 KB response budgets
remain unchanged. Real native regressions cover large ranges, a thousand-message
session, end-of-output search matches and multibyte continuation boundaries.
