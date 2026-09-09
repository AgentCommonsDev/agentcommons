# ADR 0056: Search normalizes English inflections without experimental ClickHouse functions

Date: 2026-09-09
Status: Accepted. Supersedes the Snowball stemming sentences of ADR 0047 ("Native lexical
semantics" and "Native boundary experiments"); everything else in ADR 0047 stands.

## Context

`searchTermsSql` (`packages/traces/src/views/search.ts`) defines both the `message_terms`
text index on `ac_trace.messages` and both sides of `api_ro.search_messages`. Until this
decision it applied `stem(token,'english')` to every lowercase token. ClickHouse marks
`stem()` experimental behind `allow_experimental_nlp_functions`, and ClickHouse Cloud
locks that setting off for every user, including the service admin (changing it per query
returns `SETTING_CONSTRAINT_VIOLATION`). The target deployment uses ClickHouse Cloud, so
the migration could not create the index there and search could not depend on that
function. The self-hosted 26.8 image happened to evaluate `stem()` with the setting at 0,
which is why nothing failed locally.

The alternative of keeping stemming as a capability detected at migration time would
have meant two index expressions, a flag table read by the views and the API, and search
behavior that differs by deployment. The repository's core tenet is one implementation per
concept.

## Measurement

Three variants of the per-token expression were evaluated on ClickHouse 26.8 with the
same rank formula as `api_ro.search_messages`, over the golden corpus
(`fixtures/search-corpus.json`, 10 sessions) and the 30 golden questions
(`fixtures/search-golden.yaml`, top-3 hit rate per §16.1 item 3), plus 28 inflection
probes (an indexed phrase and a query differing only by inflection or derivation):

| variant                                            | golden top-3 | inflection probes |
| -------------------------------------------------- | ------------ | ----------------- |
| `stem(token,'english')` (Snowball)                 | 30/30        | 26/28             |
| `tokens(lowerUTF8(...))` only                      | 30/30        | 0/28              |
| standard-function inflection rules (this decision) | 30/30        | 24/28             |

Every golden query uses the surface forms present in its session, so the golden suite does
not separate the variants; the inflection probes do. The rule table matched every probe
that differs by number, tense or aspect (`libraries`/`library`, `caching`/`cached`,
`committed`/`commit`, `policies`/`policy`, `agreed`/`agree`, `indexes`/`index`). It does
not match derivations (`quickly`/`quick`, `authorization`/`authorize`), which Snowball
did, and neither variant matches `parser`/`parse` or `server`/`serve`.

## Decision

`stem()` is removed everywhere. `searchTermsSql` lowercases and tokenizes, then applies
`englishInflectionRules`, an ordered table of eight `replaceRegexpOne` rules that
approximate Snowball's inflectional steps: `-sses`, `-ies`, plural `-s`, `-eed`,
`-ed`/`-ing` with a doubled consonant collapsed, `-ed`/`-ing`, consonant + `-y` to `-i`,
and a final `-e`. Every pattern is anchored on ASCII letters, so identifiers containing
digits (`TS2322`, `libssl.so.3`) and non-ASCII text stay literal. The same expression
defines the index and the query side, and no deployment-specific flag exists. The rules
are data in one place; the agent-facing descriptions still promise that English
inflections share a stem, which remains true.

The query side wraps its scalar subquery in `assumeNotNull`: every release types a scalar
subquery as `Nullable(String)`, which `tokens()` rejects on 26.2 and tolerates on 26.8, and
the needle stays a native constant for the text index either way. The PostgreSQL TLS helper
now emits `sslmode` and certificate arguments only when the control URL names them; libpq
defaults to `sslmode=prefer` on its own, and 26.2 rejects every TLS key-value argument.

The security suite asserts that the stored index expression contains no `stem(` call and
that inflected and base forms normalize to the same terms. Verification against the
ClickHouse Cloud service (26.2.1.641) from this checkout, in a throwaway database that was
dropped afterwards together with its users, roles and row policies: `migrateTraces` now
gets past the `message_terms` index, the vector indexes, the PostgreSQL control tables, the
dictionaries, the row policies and the base views, and stops at the analytics views, whose
`WITH … AS MATERIALIZED` syntax 26.2 does not parse (a separate 26.8 dependency, also used
by the metrics service and the reader principals' `enable_materialized_cte` setting). The
real `search_messages` view body, the text index on the real `messages` shape and the
100,000-row index probe were then created and queried directly on Cloud: an inflected query
returns the expected row, the plan names `message_terms`, and inflected and base forms
normalize identically.

## Consequences

- One search DDL runs self-hosted and on ClickHouse Cloud; the Cloud release plan in
  `infra/OPERATIONS.md` no longer blocks on search. It still blocks on the materialized
  CTE syntax and on TLS arguments for the PostgreSQL engine until the Cloud service runs
  a release that has them or those uses change.
- Derivational matches (`-ly`, `-ization`, agent `-er`) that Snowball provided are gone.
  Adding a rule means extending `englishInflectionRules`, re-running the golden suite, and
  updating this ADR's table; it never means a second expression.
- The index expression is longer (about 540 characters instead of 94) and evaluates eight
  regular-expression replacements per token at insert, merge and query time. The 100,000-row
  index probe in the security suite still uses the `message_terms` index.
