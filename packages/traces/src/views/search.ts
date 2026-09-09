import { sqlIdentifier, sqlString } from "../client.js";

/**
 * English inflection rules applied in order to every lowercase token, identically on the
 * indexed and the query side. They cover number, tense and aspect (plural `-s`/`-es`/`-ies`,
 * `-ed`/`-ing` with a doubled consonant, consonant + `-y`, a final `-e`) with standard string
 * functions only, so the same DDL runs on every ClickHouse deployment: `stem()` is an
 * experimental function and ClickHouse Cloud locks `allow_experimental_nlp_functions` off.
 * Every pattern is anchored on ASCII letters, so identifiers with digits or non-ASCII text
 * stay literal. ADR 0056 records the measurement behind this table.
 */
export const englishInflectionRules: ReadonlyArray<
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
export function normalizeTokenSql(token: string): string {
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

export function searchViews(database: string): string[] {
  const db = sqlIdentifier(database);
  const owner = sqlIdentifier(`${database}_view_owner`);
  const terms = searchTermsSql("search_text");
  // The scalar subquery makes the normalized needle a native constant for the text index;
  // assumeNotNull strips the Nullable wrapper every release gives scalar subqueries, which
  // tokens() rejects on ClickHouse 26.2 (ClickHouse Cloud) and tolerates on 26.8.
  const query = `assumeNotNull((SELECT ${searchTermsSql("{q:String}")}))`;
  // Match history through the text index, then require the latest published row. Filtering before
  // the latest-version check would resurrect a previous edit that still contains the query.
  return [
    `CREATE OR REPLACE VIEW api_ro.search_messages DEFINER=${owner} SQL SECURITY DEFINER AS
      SELECT session_id,seq,
        multiIf(role='USER',1.0,kind='TEXT',0.4,kind='TOOL_USE',0.2,0.1)
        * arrayCount(token -> has(tokens(${query}),token),tokens(${terms}))
        / (1 + log(1 + length(tokens(search_text)))) AS rank
      FROM ${db}.messages FINAL
      WHERE searchable AND NOT deleted AND notEmpty(tokens(${query}))
        AND hasAllTokens(${terms},${query})
        AND (message_id,revision) IN (
          SELECT message_id,max(revision) FROM ${db}.messages GROUP BY message_id
        )`,
    `CREATE OR REPLACE VIEW api_ro.similar_sessions DEFINER=${owner} SQL SECURITY DEFINER AS
      SELECT candidate.session_id,cosineDistance(candidate.embedding,source.embedding) AS distance
      FROM api_ro.session_embeddings candidate
      CROSS JOIN (SELECT embedding FROM api_ro.session_embeddings WHERE session_id={source:UUID}) source
      WHERE candidate.session_id!={source:UUID}
      ORDER BY distance,session_id LIMIT {max_rows:UInt32}`,
  ];
}
