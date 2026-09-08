# 0017. Preserve protocol structure and durable redaction identity

Date: 2026-09-08 · Status: accepted

Independent real-Postgres regressions found three privacy and consistency failures.
A custom policy could redact a sensitive input path before its result arrived, making
that result appear non-sensitive. A redacted call ID no longer paired with its later
result. A rule matching `assistant`, `tool_use`, or a property name could destroy the
structure needed to rebuild messages. Repeated scans could also nest a replacement
containing its own matching policy name indefinitely.

Keep protocol structure as adapter data consumed by the shared redactor. Known keys,
finite enum values, and valid typed timestamps are syntax. Unknown keys and all free
text remain subject to secretlint. This is not a second secret detector or a generic
exemption for strings resembling redaction markers. Exact configured replacement
strings, validated before policy storage, are terminal output tokens. Matches spanning
those tokens are clipped around them, so new surrounding text still gets redacted.

Before generic redaction, record server-owned tool-call hashes and sensitive-file
classification in RawRecord.redactionContext. Sensitivity is ORed across all historical
versions and cannot weaken during a rescan. Whole sensitive result containers are
replaced, including unknown mirrors inside them. No original sensitive value is stored
in this metadata, accepted from clients, or returned by raw reads.

Opaque identifiers that match a policy or exceed 256 UTF-8 bytes become
`redacted-<SHA256>`. This canonical namespace is reserved and stable across rescans.
Session creation, native parent references, hook hints, and active-leaf context use the
same mapping. Projection uses durable identity hashes so a policy change between two
batches cannot split a tool pair or tree edge. Generic JSON redaction receives only
already-canonical identity values at those declared locations. Sanitization drops
identity metadata for omitted fields while retaining sensitive-call classification.

Organization locks precede session locks for ingestion, moderation, policy mutations,
and rescans. Graph edges also serialize before session row locks. This prevents
opposing concurrent parent assignments from deadlocking or creating a cycle. Batch
UUIDs belong to an organization; IngestBatch uses `(organizationId, id)` as its primary
key. Deleted policies can remain in another process's documented 30-second cache.
Their matches remain in audit totals, but per-policy counters are written only for
rows that still exist, without recreating deleted counters or failing the upload.

A latest pi leaf may refer to an entry not uploaded yet. AgentSession.projectedContext
retains the last successful branch context separately from the pending source context.
Rescan rebuilds that previous branch from newly redacted records; if it is unavailable,
it clears derived rows rather than retaining old text. Ordinary ingestion continues to
wait for the missing branch, then updates both projection and checkpoint together.
