import { sqlIdentifier, sqlString } from "../client.js";
import { MESSAGES_CURRENT_TABLE } from "../schema.js";
import { traceScopeSql, traceView, type TraceViewDefinition } from "./base.js";

/**
 * English inflection rules applied in order to every lowercase token, identically on the
 * indexed and the query side. They cover number, tense and aspect (plural `-s`/`-es`/`-ies`,
 * `-ed`/`-ing` with a doubled consonant, consonant + `-y`, a final `-e`) with standard string
 * functions only, so the same DDL runs on every ClickHouse deployment: `stem()` is an
 * experimental function and ClickHouse Cloud locks `allow_experimental_nlp_functions` off.
 * Every pattern is anchored on ASCII letters, so identifiers with digits or non-ASCII text
 * stay literal. ADR 0056 records the measurement behind this table.
 */
const englishInflectionRules: ReadonlyArray<
  readonly [pattern: string, replacement: string]
> = [
  ["^([a-z]{2,})sses$", "\\1ss"],
  ["^([a-z]{2,})ies$", "\\1i"],
  ["^([a-z]{2,}[a-rt-z])s$", "\\1"],
  ["^([a-z]+)eed$", "\\1ee"],
  [
    "^([a-z]*[aeiou][a-z]*)(?:(b)b|(g)g|(m)m|(n)n|(p)p|(r)r|(t)t)(?:ing|ed)$",
    "\\1\\2\\3\\4\\5\\6\\7\\8",
  ],
  ["^([a-z]*[aeiou][a-z]*)(?:ing|ed)$", "\\1"],
  ["^([a-z]*[b-df-hj-np-tv-z])y$", "\\1i"],
  ["^([a-z]+[a-df-z])e$", "\\1"],
];

/** The per-token normalization as one nested standard-function expression. */
function normalizeTokenSql(token: string): string {
  return englishInflectionRules.reduce<string>(
    (expression, [pattern, replacement]) =>
      `replaceRegexpOne(${expression},${sqlString(pattern)},${sqlString(replacement)})`,
    token,
  );
}

/** Lowercase tokens with their inflections normalized, joined for the text index. */
export function searchTermsSql(expression: string): string {
  return `arrayStringConcat(arrayMap(token -> ${normalizeTokenSql("token")},tokens(lowerUTF8(${expression}))),' ')`;
}

export function searchViews(database: string): TraceViewDefinition[] {
  const db = sqlIdentifier(database);
  // Search reads the published-only corpus `messages_current` (ADR 0092), not `messages`.
  // The corpus holds one row per message keyed by `(organization_id, session_id, message_id)`
  // and versioned by `revision`, so a single `FINAL` scan resolves the latest published
  // content and drops tombstones — no cross-revision `latest` GROUP-BY, no generation fan-out.
  // Its row policy fences organization, publication, visibility and purge from live control.
  const corpus = `${db}.${sqlIdentifier(MESSAGES_CURRENT_TABLE)} FINAL`;
  // The normalized tokens of every row are the stored `search_terms` column (copied at publish
  // from the `messages` row's materialized column, computed once at write time by the shared
  // expression), so a search costs one tokenization per row, never the inflection regexes.
  const terms = "search_terms";
  // The scalar subquery makes the normalized needle a native constant for the text index;
  // assumeNotNull strips the Nullable wrapper every release gives scalar subqueries, which
  // tokens() rejects on ClickHouse 26.2 (ClickHouse Cloud) and tolerates on 26.8.
  const query = `assumeNotNull((SELECT ${searchTermsSql("{q:String}")}))`;
  // A message's lexical rank: its role weight times how many of its tokens the query names,
  // damped by the message length so a long message does not outrank a focused one. Shared by
  // both matchers so the two views rank a hit identically.
  const rank = `multiIf(role='USER',1.0,kind='TEXT',0.4,kind='TOOL_USE',0.2,0.1)
        * arrayCount(token -> has(tokens(${query}),token),tokens(${terms}))
        / (1 + log(1 + length(tokens(${terms}))))`;
  // Match through the text index over the corpus. `FINAL` resolves the latest published
  // revision of each message intrinsically (revision is the ReplacingMergeTree version and
  // is not in the sort key), so a previous edit that still contains the query cannot
  // resurrect. The organization predicate narrows the scan to the caller's primary-key
  // range; the row policy fences everything else.
  return [
    traceView(
      "search_messages",
      `SELECT session_id,seq,${rank} AS rank
      FROM ${corpus}
      WHERE organization_id=${traceScopeSql.organization} AND searchable AND NOT deleted AND notEmpty(tokens(${query}))
        AND hasAllTokens(${terms},${query})`,
    ),
    // The relaxation fallback (ADR 0081): a session matches when its messages together carry
    // every query token, not one message alone, so a natural-language query whose words are
    // spread across a session still finds it. The service runs this only when the strict
    // matcher above returns nothing, so a search that already works is untouched. Every
    // message carrying at least one query token is returned and ranked like a strict hit, so
    // the block assembly, per-session cap and highlighting are identical.
    traceView(
      "search_messages_session",
      `SELECT session_id,seq,${rank} AS rank
      FROM ${corpus}
      WHERE organization_id=${traceScopeSql.organization} AND searchable AND NOT deleted AND notEmpty(tokens(${query}))
        AND hasAnyTokens(${terms},${query})
        AND session_id IN (
          SELECT session_id FROM ${corpus}
          WHERE organization_id=${traceScopeSql.organization} AND searchable AND NOT deleted
            AND hasAnyTokens(${terms},${query})
          GROUP BY session_id
          HAVING length(arrayDistinct(arrayFlatten(groupArray(
            arrayFilter(token -> has(tokens(${terms}),token),tokens(${query}))
          )))) = length(tokens(${query}))
        )`,
    ),
    traceView(
      "similar_sessions",
      `SELECT candidate.session_id,cosineDistance(candidate.embedding,source.embedding) AS distance
      FROM api_ro.session_embeddings candidate
      CROSS JOIN (SELECT embedding FROM api_ro.session_embeddings WHERE session_id={source:UUID}) source
      WHERE candidate.session_id!={source:UUID}
      ORDER BY distance,session_id LIMIT {max_rows:UInt32}`,
      "vector",
    ),
  ];
}
