# 0025. Indexed native identity survives policy changes

Date: 2026-09-08 · Status: accepted

The reused-position review exposed a second identity defect. After ingesting a session,
a new policy matching its native identifier caused a replay to return `BATCH_CONFLICT`.
The old row retained its readable native ID while the new request used its canonical
redacted form. Rescanning could reverse which representation was stored. Looking up
only the current display value could also bypass the original owner or tombstone.

Preserve readable native IDs until policy redaction requires their canonical form.
Use the existing `projectionIdentity` digest rule for identity independently of that
display representation. PostgreSQL's immutable `public.native_identity(text)` uses
built-in SHA-256 over UTF-8 and the same reserved `redacted-<64 lowercase hex>` namespace.
An expression unique index enforces organization, harness, and canonical session
identity. Another enforces session and canonical non-null raw key. A partial index
supports pending explicit parent lookup. The session repository uses these indexed
identities for both normal lookup and parent resolution. Advisory locks, in-memory
record deduplication, parent comparisons, and projection tie-breaking use the same
canonical rule. There is no alias table or policy-dependent lookup fallback.

Rescans now redact raw record keys alongside their payloads and preserve the same
canonical identity. Existing records, message UUIDs, ownership, privacy, explicit
edges, batch receipts, and tombstones survive policy changes. Conflicting parent hints
compare canonical identities so a readable ID and its redacted form do not produce a
false conflict. Native identifiers remain organization scoped.

The SQL helper is private to migration/application principals. Readers receive neither
its schema privileges nor function execution; SQL guard and schema discovery do not
advertise it. A parity test compares PostgreSQL and core on empty, ordinary, Unicode,
long, canonical-prefix, malformed-prefix, case, whitespace, and newline values.

The migration deliberately fails its unique-index creation if an existing database
already contains two rows representing the same canonical identity. It never merges
ownership, deletes receipts, or chooses a tombstone implicitly. An operator must inspect
and reconcile that historical inconsistency before rerunning the migration.

Real native pg-boss/Postgres tests reproduce the original failure and verify replay
before and after a new policy/rescan, keyed append deduplication, retained private state,
owner enforcement, cross-organization isolation, already-linked and waiting parent
resolution, and purge rejection under the original native identifier.
