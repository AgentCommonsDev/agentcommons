import { sqlString } from "./client.js";

/**
 * Which audit rows a session active on the calling installation is credited with
 * (spec §10, ADR 0060): successful `search`, `get` or `sql` calls made through MCP or REST
 * with an API key. The audit projection worker filters its candidates with
 * `isAttributableRead` and the `attributed_reads` view applies the same rule in SQL; both
 * read this one table, so the rule exists once.
 */
export const attributedReadRule = {
  actions: ["search", "get", "sql"],
  transports: ["mcp", "rest"],
  authMethod: "key",
  status: { min: 200, max: 299 },
} as const;
/** `target_session_id` of a `session_reads` row whose call named no session (search, sql). */
export const NO_TARGET_SESSION_ID = "00000000-0000-0000-0000-000000000000";
/** The ClickHouse table holding attributed reads; `api_ro.reuse_edges` and its aggregates read it. */
export const SESSION_READS_TABLE = "session_reads";
/** Name of the one-time derivation of `session_reads` from retained audit history. */
export const SESSION_READS_BACKFILL = "session_reads";

export function isAttributableRead(row: {
  action: string;
  transport: string;
  auth_method: string;
  status_code: number;
  installation_id: string | null;
}): boolean {
  const actions: readonly string[] = attributedReadRule.actions;
  const transports: readonly string[] = attributedReadRule.transports;
  return (
    row.installation_id !== null &&
    row.auth_method === attributedReadRule.authMethod &&
    transports.includes(row.transport) &&
    actions.includes(row.action) &&
    row.status_code >= attributedReadRule.status.min &&
    row.status_code <= attributedReadRule.status.max
  );
}
/** The same rule over an `audit_events` row aliased `alias`, for the `attributed_reads` view. */
export function attributedReadSql(alias: string): string {
  const list = (values: readonly string[]) => values.map(sqlString).join(",");
  return `${alias}.installation_id IS NOT NULL AND ${alias}.auth_method=${sqlString(attributedReadRule.authMethod)} AND ${alias}.transport IN (${list(attributedReadRule.transports)}) AND ${alias}.action IN (${list(attributedReadRule.actions)}) AND ${alias}.status_code BETWEEN ${String(attributedReadRule.status.min)} AND ${String(attributedReadRule.status.max)}`;
}
