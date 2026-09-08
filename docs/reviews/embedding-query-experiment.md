# Embedding query experiment

2026-09-08. Reproduce with:

```
pnpm exec vitest run apps/api/test/embeddings.integration.test.ts -t 'measures exact filtered cosine'
```

The test starts real PostgreSQL 16 with pgvector, provisions a native organization/key,
ingests 20 sessions containing 500 searchable messages, indexes them through the fake
provider, and makes 20 warm hybrid searches. Search timing includes query reservation,
provider invocation, completion accounting, result formatting and the logical read audit.
It excludes browser rendering and uses no external provider network request.

The grouped cosine plan contains Limit, Sort, Aggregate, Subquery Scan, Result, Nested
Loop, Index Scan, CTE Scan, Index Only Scan, Bitmap Heap Scan and Bitmap Index Scan.
The selected indexes are the organization/session native identity index, user and
installation primary keys, and `message_chunk_session_id_idx`. Both cosine HNSW indexes
exist, but this grouped query does not choose them. The implementation computes exact
filtered cosine distances; it does not claim an approximate-nearest-neighbor plan.

The first run measured an approximate p50 of 149.0 ms and p95 of 164.4 ms. Restricting the
hybrid eligible CTE to the six columns used by ranking, instead of materializing all
message columns, produced p50 131.8 ms and p95 144.2 ms in the repeat. Other agents and
browser tests were active on the same host. These are observations from this corpus,
not a production latency guarantee. A real OpenAI request adds network/provider latency;
the default lexical dashboard timing target is tested separately.

The same integration suite independently checks RRF ordering, a noisy 501-message
session, caller filtering, stable cursor behavior during provider failure, phase-audit
rollback, policy changes, native queue deferral/catch-up, and purge/rescan invalidation.
