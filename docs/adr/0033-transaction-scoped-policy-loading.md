# 0033: Load write policies through the active transaction

Status: accepted, 2026-09-08.

Hosted CI exposed a PostgreSQL connection-pool dependency that a large workstation pool
hid. Three concurrent embedding transactions occupied all three Prisma connections, then
loaded redaction policies through the root client's shared cache. Each loader needed a
fourth connection while its caller held one of the first three. The request timed out
with Prisma P2024. A fresh PostgreSQL regression reproduces this with explicit
`connection_limit=3` and `pool_timeout=2`; increasing the pool is not the fix.

The same policy-loading dependency existed in ingest, rescan, policy writes, mutation
audits, and moderation reason redaction. All these reads now use the active Prisma
transaction client. The existing canonical policy loader and row validation live in
`services/policy-cache.ts`, separate from the policy-management service. A transaction
creates a local policy cache using that loader; its rows never enter the process-wide
cache. Ordinary reads and query-embedding preparation retain the shared 30-second cache.
Worker audits resolve policies from their explicit organization as well as caller audits.

This preserves one policy implementation and the transaction's own view of policy changes.
A policy created in a transaction can redact that transaction's audit, but a rollback
cannot publish the uncommitted rule to another request. No connection limit or timeout was
raised, and embedding provider dispatch remains outside its reservation/completion
transactions.

Real PostgreSQL tests exercise concurrent embedding indexing with three connections,
concurrent cold-cache ingest, and a three-party barrier that occupies every connection
before cold-cache audit writes. Another test creates a transaction-only policy, checks
moderation text and worker audit redaction, rolls back, and verifies both the absence of
persisted rows and the unchanged shared cache. The original explicit-pool reproduction
fails at `redactionPolicy.findMany`; all three regression cases pass with transaction
binding.
