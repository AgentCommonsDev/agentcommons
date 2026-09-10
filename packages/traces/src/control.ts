import {
  principalFieldSql,
  principalFlags,
  sqlIdentifier,
  sqlString,
} from "./client.js";

const flagSql = (field: keyof typeof principalFlags) =>
  `${principalFieldSql(field)}=${sqlString(principalFlags[field][0])}`;
/** Caller facts read back from the native principal name inside policies and views. */
export const traceScopeSql = {
  organization: `unhex(${principalFieldSql("organization")})`,
  user: `unhex(${principalFieldSql("user")})`,
  admin: flagSql("authority"),
  embeddings: flagSql("embeddings"),
  saas: flagSql("saas"),
};
/** The PostgreSQL-engine mirror of one `trace_control` view (ADR 0062). */
export function controlTableSql(database: string, name: string): string {
  return `${sqlIdentifier(database)}.${sqlIdentifier(`control_${name}`)}`;
}
/** Control attributes a policy or view can look up for a row's session. */
const sessionScopeAttributes = [
  "redaction_generation",
  "published_revision",
  "embedding_revision",
  "purged",
  "embeddings_enabled",
  "embedding_source_revision",
  "paid_embeddings",
] as const;
type SessionScopeAttribute = (typeof sessionScopeAttributes)[number];
/**
 * Control attributes of the row's session, read once per query context (ADR 0062). One
 * scalar subquery fetches the caller-visible control rows of the caller's organization as
 * constant arrays, and `transform` hashes the row's `key` against them, so a scan costs one
 * PostgreSQL read instead of one dictionary round trip per block. The scalar's text is the
 * same for every table, view and attribute, so ClickHouse evaluates it once per query
 * context however many guarded tables that context reads. A session absent from the arrays
 * yields `fallback`; every predicate chooses one that fails closed, so a hidden session, a
 * missing control row or an unavailable control source hides the row.
 */
export function sessionScopeLookup(database: string, key: string) {
  const arrays = `(SELECT (${["session_id", ...sessionScopeAttributes].map((column) => `groupArray(${column})`).join(",")}) FROM ${controlTableSql(database, "session_scope")} WHERE organization_id=${traceScopeSql.organization})`;
  return (attribute: SessionScopeAttribute, fallback: string) =>
    `transform(${key},tupleElement(${arrays},1),tupleElement(${arrays},${String(sessionScopeAttributes.indexOf(attribute) + 2)}),${fallback})`;
}
