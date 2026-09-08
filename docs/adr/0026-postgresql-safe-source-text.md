# 0026. Preserve valid batches containing PostgreSQL-incompatible text

Date: 2026-09-08 · Status: accepted

A real-Postgres ingest regression supplied valid JSON containing a NUL character and
unpaired UTF-16 surrogates in a transcript string. PostgreSQL cannot store those values
in text/jsonb, so the transaction returned 500 and rolled back the valid sibling record.
Retrying the same native batch could never succeed. The same boundary also affects
metadata, object keys, and audit detail.

Use one storage-text rule at the end of the shared redactor's text operation. Native
Node `util.toUSVString` replaces unpaired UTF-16 surrogates with U+FFFD; NUL becomes the
six printable characters `\u0000`. Valid Unicode, including supplementary characters,
newlines and tabs, remains unchanged. Secretlint sees the original value first, so a
policy can still match NUL or adjacent secrets. Normalization adds no secret-match count
and is idempotent. The existing JSON traversal applies it to string values and unknown
object keys and preserves colliding transformed keys with its existing numeric suffix.

This remains redacted, sanitized source rather than byte-exact storage. Native identity
values that change use the existing canonical digest namespace, preserving retries.
Declarative regex, replacement, and scanner allow-pattern strings instead reject these
literal characters at validation, so storage cannot silently change policy semantics.
Escaped regex syntax such as `\x00` remains valid and can match a native NUL.

Tests verify actual Postgres ingest of both records in the affected batch, metadata,
native session/key identity, replay/deduplication, object-key collision preservation,
audit detail, unchanged valid Unicode, idempotency, and policy matching/validation.
