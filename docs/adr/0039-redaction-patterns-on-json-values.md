# 0039. Apply regex policies to JSON values as well as assignment context

Status: accepted. Clarifies §5.3 custom pattern semantics.

An adversarial search-audit test found that `^needle$` redacted a standalone string
and array item but missed `{ "x": "needle" }`. JSON object values were scanned as
`x=needle` so assignment-oriented secret scanners could use the property name. That
context changed the meaning of anchored custom regexes.

Keep the contextual secretlint scan. For an object string value, also run the same
native pattern rule against the unprefixed value, with the composed regex policies.
Merge both sets of source ranges before replacement and counting. A match found by
both scans is one redaction, and terminal replacement markers retain their existing
idempotency behavior. Preinstalled scanners retain assignment context. No custom
regex matcher, guessed anchor rewriting or harness-specific branch is introduced.

Core tests cover anchors, Unicode offsets, overlap counts, assignment detection and
repeat scans. Real Postgres ingestion and policy rescan verify that raw records,
projections and audit values follow the same behavior. Existing latency and fixture
gates remain unchanged.
