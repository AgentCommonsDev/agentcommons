import { sqlIdentifier } from "../client.js";

/** Native Snowball stemming keeps inflections searchable without an application query parser. */
export function searchTermsSql(expression: string): string {
  return `arrayStringConcat(arrayMap(token -> stem(token,'english'),tokens(lowerUTF8(${expression}))),' ')`;
}

export function searchViews(database: string): string[] {
  const db = sqlIdentifier(database);
  const owner = sqlIdentifier(`${database}_view_owner`);
  const terms = searchTermsSql("search_text");
  const query = `(SELECT ${searchTermsSql("{q:String}")})`;
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
