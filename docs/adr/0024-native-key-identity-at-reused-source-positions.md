# 0024. Native-key identity at reused source positions

Date: 2026-09-08 · Status: accepted

A real-Postgres regression submitted a new native key at byte offset 0 after an
acknowledged JSONL file was truncated. Ingest returned `accepted: 0, duplicates: 1`.
The unconditional `(sessionId, pos, sourceVersion)` unique index and ingest's position
set contradicted §5.2's key-first identity rule. The JSONL reader correctly restarts
at offset 0 and version 0 when the file shrinks; it has no observed generation ID.

Keep both native-keyed records. Enforce `(sessionId, key)` uniqueness for non-null
keys and `(sessionId, pos, sourceVersion)` uniqueness only for null keys. A keyed
record and a keyless record at the same slot are distinct identities. Replaying a
native key at another offset still deduplicates against the original record.

Source position remains the primary order. At equal positions, source version and
the canonical SHA-256 native-key identity break ties, followed by each record's block
index. Keyless records sort first at an equal position/version. The existing
`projectionIdentity` function produces the same ordering identity before and after
canonical identifier redaction. Shared normalizer ordering governs messages, session
metadata, and parent extraction; lifecycle projection preserves complete native block
order. Existing raw and message IDs remain unchanged. Gemini still projects only the
latest observed source version at each array position.

This is a deterministic presentation order, not a claim to reconstruct chronology
across a truncated file. Native byte offsets do not encode generations, and server
arrival time is not source order. Do not invent a generation or use received timestamps
to resolve the ambiguity. The existing shrink-only reader contract is unchanged.

Raw pagination orders stored observations by `(pos, sourceVersion, id)` and signs all
three in its cursor. Fragment cursors additionally bind the payload digest and byte
offset. Distinct keys at one position therefore cannot disappear at page boundaries,
and a fragment cannot accidentally resume in a different record with the same slot.

Verification covers the original failing reset, keyed replay at a changed offset,
keyless deduplication, opposite delivery orders, stable message IDs, one-record raw
pages across ties, canonical-key redaction, complete block ordering, and actual
Postgres constraints. Existing mutable-Gemini and rescan tests remain applicable.
