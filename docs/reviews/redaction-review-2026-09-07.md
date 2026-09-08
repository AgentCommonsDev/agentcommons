# Redaction implementation review, 2026-09-07

Reviewed the actual installed secretlint 10.2.2 implementation, core redaction,
policy validation/cache, sanitizer, tests, and the sensitive-file contract in §5.3.

## Reproduced and fixed

- **Transcript-controlled suppression.** `// secretlint-disable`, `#
  secretlint-disable`, HTML directives, and rule-specific GitHub directives allowed
  a synthetic GitHub token to pass unchanged. The preset's comment filter declares
  `meta.type: scanner`. Nested `disabled` configuration was passed through
  `RulePresetContext` to `RunningEvents.registerRule`, which does not check that
  property. The fix expands the official preset's scanner creators into direct
  configurations and excludes the comment filter by exact id. It is excluded from
  the selectable policy allowlist as well.
- **Escaped slash mismatch.** A valid custom source `foo\/bar` did not redact
  `foo/bar`: manually escaping every slash double-escaped an existing delimiter.
  `RegExp.toString()` now serializes the validated expression for secretlint.
- **Zero-width matches.** `(?=secret)` passed validation and yielded a redaction
  marker followed by the unchanged input. Testing the pattern against an empty
  string misses conditional zero-width matches. `regexpp` and
  `regexp-ast-analysis` now reject expressions whose minimum consumed length is
  zero, including lookbehind and suppression allow patterns.
- **Catastrophic backtracking.** `safe-regex2` accepted `(a|aa)+$`. An isolated
  Node process evaluating it on 36 `a` characters followed by `!` exceeded a 500 ms
  timeout. `recheck` now rejects vulnerable or indeterminate expressions with a
  bounded analysis. The validator does not execute the submitted expression on
  attacker-controlled input.
- **Policy-cache invalidation race.** A rejected old load removed a newer entry
  created after invalidation. The rejection handler now verifies the cached
  promise identity before evicting it.

Independent regression tests are in `e2e/redaction-review.test.ts`. Together with
the core redaction tests, 25 tests pass. Core TypeScript and the changed files'
ESLint checks pass. These unit tests do not prove persistence, audit, or rescan
integration requirements.

## Persistence issues requiring the API design

Masking a normalized message alone is insufficient. The real Claude fixture
duplicates Read output in both `message.content[].content` and top-level
`toolUseResult.file.content`. Gemini duplicates tool output in
`toolCalls[].result` and `resultDisplay`. Codex records auxiliary completed-item
events as well as response items; the captured shell event contains `stdout`,
`aggregated_output`, and `formatted_output`. Those raw representations need the
same redaction decision even when an auxiliary event is not normalized.

Recommended interface: the selected normalizer emits result-source descriptors
alongside normalized messages. A descriptor identifies the tool call, raw record,
and all native output locations, including mirrors. Each location carries a
replacement JSON template and a marker insertion path, so a shared patcher can
replace the output while retaining native identity fields. The service resolves
call/result pairing and sensitive paths once, applies these patches in memory,
runs the ordinary redactor, then persists and normalizes the patched raw records.
Harness-specific locations and templates belong in the normalizer's data, not
in API branches. Unknown fields within a result container must be removed or
redacted with that container; only masking the known `content` property is unsafe.

An unpaired result cannot be both discarded before server persistence and
completed later from that server record alone. The §5.3 requirement needs a replay
mechanism: retain the original on the originating client and request/quarantine
the record for replay after its input arrives. A hidden server-side original would
violate the stated redaction guarantee. Do not mark R-RED-05 complete until this
contract and the cross-batch test are implemented.

## Additional observations

The original generic token pattern missed uppercase assignments and JSON-quoted
keys. The recursive scanner also separates object keys from their values, so the
structured `{ token: value }` case needs a field-aware rule; root owns that change.

The sanitizer initially returned an object containing 600,000 small numeric array
elements unchanged at 1,200,026 bytes, because no string leaf could shrink. §4.4
does not currently specify how to handle structural overhead after string
sanitization. It also recognized image data URIs only, whereas a native
`{type: image, source: {type: base64, media_type, data}}` object remained unchanged.
Define the supported image targets and structural fallback before claiming a
universal record-size bound. These are contract gaps, not evidence that unit tests
prove full request-limit enforcement.
