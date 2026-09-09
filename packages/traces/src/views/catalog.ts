import {
  traceColumnDescriptions,
  traceEmbeddingViews,
  traceViews,
} from "@agentcommons/core/sql";
import { sqlIdentifier, sqlString } from "../client.js";
import { traceScopeSql, traceView, type TraceViewDefinition } from "./base.js";

/** Reads `system.columns`; the migration grants the view owner that table. */
export function catalogViews(database: string): TraceViewDefinition[] {
  const enabled = `${traceScopeSql.embeddings} AND EXISTS(SELECT 1 FROM ${sqlIdentifier(database)}.control_organization_settings WHERE organization_id=${traceScopeSql.organization} AND embeddings_enabled=1 AND (NOT ${traceScopeSql.saas} OR paid_embeddings=1))`;
  // A native column comment wins, then the shared catalog, then the readable column name,
  // so a migration-added column still appears without rebuilding the catalog.
  const descriptions = traceColumnDescriptions();
  const catalog = `transform(concat(table,'.',name),[${descriptions
    .map(({ view, column }) => sqlString(`${view}.${column}`))
    .join(",")}],[${descriptions
    .map(({ description }) => sqlString(description))
    .join(",")}],'')`;
  return [
    traceView(
      "schema_columns",
      `SELECT table AS view_name,name AS column_name,type AS data_type,toUInt32(position) AS ordinal_position,
        coalesce(nullIf(comment,''),nullIf(${catalog},''),replaceAll(name,'_',' ')) AS description
      FROM system.columns WHERE database='api_ro' AND (table IN (${traceViews.map(sqlString).join(",")})
        OR (table IN (${traceEmbeddingViews.map(sqlString).join(",")}) AND (${enabled})))`,
    ),
    traceView(
      "schema_functions",
      `SELECT 'search_messages' AS function_name,'q=String' AS arguments,'session_id UUID, seq UInt32, rank Float64' AS result_type,
        ${sqlString("Uncapped visible lexical matches. Use search_messages(q='words') and order by rank DESC, session_id, seq. All query tokens must match; English inflections share a stem.")} AS description
      UNION ALL SELECT 'similar_sessions','source=UUID, max_rows=UInt32','session_id UUID, distance Float32',
        ${sqlString("Visible sessions nearest to one session by cosine distance of their session vectors; the source itself is excluded. Use similar_sessions(source='session UUID', max_rows=5), join sessions on session_id and order by distance ASC.")} WHERE ${enabled}`,
    ),
  ];
}
