# 0030: Index complete native metadata without B-tree item limits

Status: accepted after real PostgreSQL and ingest experiments.

A Home gap-metadata test ingested a valid Git remote with a 300KB repository name.
The API returned 500. PostgreSQL reported an index tuple of 3480 bytes exceeding the
B-tree maximum of 2704 bytes. The text column itself could store the value; its index
could not. Further actual ingestion tests reproduced the same failure for a long branch,
a GIN entry for a native tool name, and the composite primary key of an observed file path.
Shrinking or rejecting otherwise valid source metadata would contradict the storage contract.

Migration 015 makes these changes:

- Repository and branch equality indexes use PostgreSQL hash indexes. PostgreSQL stores a
  fixed hash code and rechecks full equality, including collisions. The redundant composite
  repository/branch/time B-tree is removed; the separate start-time index remains available.
  Ordering remains exact SQL ordering, with the existing response-preview rules.
- The `toolsUsed` array GIN index is removed. Product tool-name filters use normalized
  `Message.tool_name`; the session array is an output aggregate. Retaining a variable-width
  GIN entry must not make a valid tool record unstoreable. Full tool values remain available
  through messages, session tools, SQL and bounded display metadata.
- `SessionFile` gets an internal database-generated UUID primary key, an index on session,
  and a unique expression index on `(session_id, SHA256(UTF8(path)))`. The complete path
  remains stored and exposed; the UUID is not a new API field. This uses ordinary Prisma
  fields/defaults and a native SQL index rather than depending on Prisma's representation
  of generated expression columns. Existing insert callers need no new identity code.
- The redundant plaintext native-session unique index is removed. Migration 010's
  organization/harness/canonical-identity unique index already supplies the authoritative
  uniqueness contract. Native IDs above 256 bytes already use the canonical digest rule.

One immutable SQL `text_identity(text)` function computes SHA-256 over explicitly UTF-8
bytes. The existing `native_identity` function delegates hashing to it and retains its
reserved `redacted-<digest>` behavior. A file path must always hash literally: a real file
named `redacted-SHA256(plain.ts)` is distinct from `plain.ts`. Reusing the native reserved
namespace for paths would incorrectly merge these valid names. PostgreSQL marks general
`convert_to` as STABLE; the fixed-UTF8 wrapper is necessary for expression indexing and
has the same deterministic encoding contract as the original canonical identity function.
The function is executable by the app role only and is not a reader SQL capability.

No raw record, source field or identity is silently merged during migration. Existing
primary-key uniqueness already excludes duplicate full paths. A cryptographic digest
collision would fail migration/insert, rather than deleting source data. Files are derived
and continue to be rebuilt from records and deleted during purge.

Actual tests ingest 300KB repository, branch, tool-name and file-path values, assert full
stored values and exact filtering, exercise the existing oversized-native-ID canonical
rule, and distinguish digest-looking filenames from their literal counterparts. Real
migration tests verify role isolation, idempotent deployment, and Prisma/schema agreement.
The observed PostgreSQL errors, including the initial STABLE-expression rejection, drove
the index changes; no source limit was invented to make the tests pass.

PostgreSQL's [hash index documentation](https://www.postgresql.org/docs/16/indexes-types.html#INDEXES-TYPES-HASH)
explains the native fixed-width equality index behavior.
