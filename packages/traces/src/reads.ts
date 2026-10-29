import { sqlString } from "./client.js";

/**
 * Which audit rows are credited to a session (spec §10, ADR 0060 as amended 2026-09-12):
 * successful `search`, `get` or `sql` tool calls made through MCP with an API key, after
 * that key completed the MCP handshake on the same installation (a raw `tools/call` posted
 * by curl or a script never handshakes and is not agent reuse). Each read is credited to
 * exactly one session: the one on the calling installation whose hook observation (its
 * start, a lifecycle or a sync receipt) is nearest to the read, among sessions active at
 * the read or observed within `observationAfterSeconds` after it. The audit projection
 * worker filters its candidates with `isAttributableRead` (the row-local half) and the
 * `attributed_reads` view applies the whole rule in SQL; both read this one table.
 */
export const attributedReadRule = {
  actions: ["search", "get", "sql"],
  transports: ["mcp"],
  authMethod: "key",
  status: { min: 200, max: 299 },
  handshake: { action: "mcp.tools.list", status: 200 },
  observationAfterSeconds: 600,
  /** An active window lasts at most this long after the observation that opened it. */
  windowHours: 6,
} as const;
/** The attributed actions that count as querying AgentCommons for search adoption (ADR 0067). */
export const searchReadActions = ["search", "sql"] as const;
/** `target_session_id` of a `session_reads` row whose call named no session (search, sql). */
export const NO_TARGET_SESSION_ID = "00000000-0000-0000-0000-000000000000";
/** The ClickHouse table holding attributed reads; `api_ro.reuse_edges` and its aggregates read it. */
export const SESSION_READS_TABLE = "session_reads";
/**
 * Name of the one-time derivation of `session_reads` from retained audit history. The
 * suffix changes when the attribution rule changes; a new name makes maintenance clear the
 * stored rows and derive them again (ADR 0060, amended 2026-09-12).
 */
export const SESSION_READS_BACKFILL = "session_reads_v2";

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
/** The handshake half of the rule over an `audit_events` row aliased `alias`. */
export function handshakeSql(alias: string): string {
  return `${alias}.action=${sqlString(attributedReadRule.handshake.action)} AND ${alias}.status_code=${String(attributedReadRule.handshake.status)} AND ${alias}.installation_id IS NOT NULL`;
}
/** The row-local half of the rule over an `audit_events` row aliased `alias`, for the `attributed_reads` view. */
export function attributedReadSql(alias: string): string {
  const list = (values: readonly string[]) => values.map(sqlString).join(",");
  return `${alias}.installation_id IS NOT NULL AND ${alias}.auth_method=${sqlString(attributedReadRule.authMethod)} AND ${alias}.transport IN (${list(attributedReadRule.transports)}) AND ${alias}.action IN (${list(attributedReadRule.actions)}) AND ${alias}.status_code BETWEEN ${String(attributedReadRule.status.min)} AND ${String(attributedReadRule.status.max)}`;
}
