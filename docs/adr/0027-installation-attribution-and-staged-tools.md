# 0027. Attribute keys by their latest accepted installation receipt

Status: accepted, 2026-09-08.

The revised audit and staged-rollout requirements add nullable AuditEvent.installationId
and Installation.toolsEnabled, default true. Neither changes Better Auth's key models.
A single resolver finds the newest accepted IngestBatch for the authenticated key and
organization, ordered by server receivedAt and receipt id. Native sentAt cannot move a
key to an older or future cohort. Replaying an existing batch does not create a receipt.

An installation may be shared by keys. A shared key follows whichever installation most
recently ingested with it. Keys with no ingest history remain enabled and have null audit
attribution; separate read-only keys therefore cannot be assigned to a device implicitly.
The dashboard explains using one ingestion/read-capable key per machine for comparisons.
Historical audit rows retain null attribution because a current association cannot prove
where an earlier read originated.

Authentication refreshes this association on every request. MCP lists no tools for a
disabled installation and rechecks calls independently of cached discovery. REST reads
and ingest remain authorized by their existing permissions. Admin cookies or effective
admin keys may change the flag through POST /api/v1/admin/installations/:id/tools. Both
directions require a confirmed reason, recorded after redaction in the mutation audit.
Organization locking serializes rollout changes with ingest and membership changes.

AuditService resolves attribution inside its caller transaction, including the receipt
inserted by the first ingest. A composite foreign key prevents cross-organization audit
attribution. Audit details use the existing wire-value conversion before redaction so
typed optional object fields, dates, and bigint counters are safe JSON; redaction and
the 8 KB storage limit still apply, and audit storage failures still reject operations.

Real Postgres and official MCP SDK tests cover shared installations, a shared key moving
between installations, unknown keys, same installation UUID in two organizations,
cached catalogs after disable/re-enable, continued capture, audit attribution, database
foreign-key enforcement, and transactional rollback when the audit fails.
