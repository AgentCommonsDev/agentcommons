# 0032. Keep bounded regex validation retryable

Status: accepted, 2026-09-08.

The native recheck validator used automatic analysis with a five-second timeout, an
NFA-size threshold of 1,000, and a bounded-repeat threshold of five. The repeat setting
selects an algorithm; it does not prohibit larger quantifiers. A UUID pattern with
32 bounded repetitions therefore fell back to fuzzing. Independent reproduction took
4.4 seconds for that safe pattern, close enough to the deadline that concurrent work
could cause rejection. Caching that unknown result as false then blocked the same
persisted policy for the remainder of the process lifetime.

Keep automatic native analysis and the five-second deadline. Raise the bounded-repeat
selection threshold to 64 while retaining the NFA-size threshold of 1,000. The UUID
pattern now receives a safe automaton classification in roughly two milliseconds in
the reproduction. This is an algorithm choice, not a guarantee about elapsed time
under arbitrary host load. The regression asserts the actual native classification
and checker rather than an unreliable wall-clock threshold.

Accept only native safe results. Cache safe and known-vulnerable results in the
existing bounded 256-entry process cache. Unknown results, including unsupported
analyses and timeouts, and checker exceptions remain rejected but are not cached.
Their validation error tells the administrator to retry or simplify the pattern.
Policy regexes and regex-form secretlint allow patterns use the same implementation.
Compilation, length bounds, and nonempty-match validation remain in place.

An automaton-only alternative rejected shipped signatures through timeouts or
unsupported constructs. A special trust list for built-ins would add another policy
validation path. Neither is needed: all shipped definitions pass the bounded automatic
configuration. Custom patterns retain the native checker's supported constructs,
including the tested safe backreference and lookbehind examples. This decision does
not claim formal proof for expressions that the native checker classifies with fuzzing.

Tests reproduce the former UUID algorithm selection and cached-timeout failure, then
exercise all shipped definitions, nested ambiguous repetitions, a billion-repeat
quantifier, zero-width matches, and supported backreference/lookbehind patterns. The
existing redaction and adversarial suites verify the resulting scanners still redact
stored content.

Native parameter semantics are documented in the [recheck parameter reference](https://makenowjust-labs.github.io/recheck/docs/usage/parameters/).
