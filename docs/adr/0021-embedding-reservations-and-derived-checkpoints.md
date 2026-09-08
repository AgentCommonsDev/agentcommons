# 0021 — Embedding reservations and derived checkpoints

Accepted: 2026-09-08

The vector schema already specifies 1024 dimensions, while the OpenAI small model's
native default is different. V1 explicitly requests 1024 through the official SDK and
rejects configuration drift. One persisted provider/model/dimension profile prevents
mixing incompatible vectors. Operators change that profile only with a migration that
invalidates the derived corpus and, when necessary, rebuilds vector columns and indexes.

A hard daily token limit cannot depend on provider usage returned after concurrent HTTP
calls. We reserve tokenizer-measured input tokens under an organization/day row lock
before calling the provider. The SDK's implicit retries are disabled. Failed and
uncertain calls retain their reservation; native pg-boss retries reserve a new attempt.
Query calls share the same budget and fall back to lexical search when unavailable.
The ledger records actual returned usage separately from conservative reserved cost.
Reservation/prepare and completion are distinct audited mutation phases because the
reservation must commit before network dispatch. A failed prepare audit rolls back the
budget, placeholders and lease and prevents the HTTP call. Completion updates vectors,
usage, checkpoint and its audit together; a crash or audit failure leaves the prior
reservation charged. Query reservation/completion audits retain the initiating caller;
the logical search still records its usual read audit. No-op/deferred prepare results
are audited as well. All index phases lock session before checkpoint/budget, including
failure handling, to avoid an expired-lease retry deadlock.

A real concurrent PostgreSQL experiment found that Prisma's composite-key upsert with an
empty update can perform a read/create sequence and fail on a first-day race. Native
`createMany(skipDuplicates: true)` performs atomic insertion, followed by the budget row
lock. Integration tests race eight callers against a budget admitting only two calls.

Pending chunk vectors, a source fingerprint, and a short persisted lease form an indexing
checkpoint. Provider calls run outside database transactions. A subsequent transaction
rechecks the session tombstone and fingerprint before writing vectors. Ingestion and
rescan invalidate old vectors atomically with projection. Catch-up handles retained
corpus on startup and maintenance; it uses organization-scoped maintenance authority,
independent of the historical uploading key. Purge always wins over an in-flight call.

Hybrid search retains the complete lexical candidate list. An experiment with 501
matching messages in one session verifies that a second exact match remains reachable.
Cosine ranking first deduplicates chunks to messages and takes three messages per session
before a 500-message fusion bound. Exact filtered cosine is acceptable in v1; installed
HNSW indexes do not imply that the grouped query uses index ordering. Signed cursor
positions preserve the ranking basis and are checked before billing a query embedding.
A provider outage on a later hybrid page returns a retryable unavailable response.

The SQL function is installed by migration but excluded from discovery and guarded SQL
when disabled. Internal vector views require the trusted feature context and join the
same security-barrier session relation used by other reads. Administrative output schemas remain stable across flags. Purge reports exact deletion
counts even if derived vectors remain from a previously enabled period, and status keeps
its typed zero/inactive accounting fields. The flag hides capability discovery and
embedding-specific descriptions/cards, not truthful administrative cleanup accounting.
The optional REST route is registered only when enabled. A live restricted-reader test initially failed because
pgvector's operators live in the public schema, whose usage is intentionally denied to
readers. Internal invoker wrappers use PostgreSQL's SQL-standard `RETURN` body, binding
the vector cast/operator at migration time. Real reader calls then pass without widening
public schema grants. The wrappers are not included in the SQL guard's allowed schema. Build-time OpenAPI includes supported optional routes for
the typed dashboard client; runtime Swagger lists the active instance's routes.

Evidence: local HTTP tests exercise the actual OpenAI SDK request/response and disabled
HTTP retries; real pgvector/PostgreSQL tests exercise concurrent budgets, scoped cosine
queries, native catch-up, changed projections, and purge during an outstanding call.
Primary contracts: [OpenAI small embedding model](https://developers.openai.com/api/docs/models/text-embedding-3-small)
and [pgvector](https://github.com/pgvector/pgvector).
