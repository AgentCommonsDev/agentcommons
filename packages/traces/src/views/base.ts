import { traceViewCatalog } from "@agentcommons/core/sql";
import {
  principalFieldSql,
  principalFlags,
  sqlIdentifier,
  sqlString,
} from "../client.js";
import { emptyTraceRow } from "../rows.js";
import {
  sessionColumns,
  messageColumns,
  traceTables,
  type TraceTable,
} from "../schema.js";

/** Who may read a canonical view: every reader, vector readers only, or no one (it backs other views). */
export type TraceViewGrant = "reader" | "vector" | "internal";
export interface TraceViewDefinition {
  name: string;
  sql: string;
  grant: TraceViewGrant;
}
export const traceView = (
  name: string,
  sql: string,
  grant: TraceViewGrant = "reader",
): TraceViewDefinition => ({ name, sql, grant });

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
export function latestRowsSql(
  database: string,
  table: TraceTable,
  columns: Record<string, string> = traceTables[table].columns,
  expressions: Record<string, string> = {},
): string {
  const { identity } = traceTables[table];
  const names = Object.keys(columns);
  const selected = names
    .map((name) =>
      ["organization_id", "session_id", identity].includes(name)
        ? `r.${sqlIdentifier(name)} AS ${sqlIdentifier(name)}`
        : `tupleElement(argMax(tuple(${expressions[name] ?? `r.${sqlIdentifier(name)}`}),r.revision),1) AS ${sqlIdentifier(name)}`,
    )
    .join(",");
  // Independent aggregates let native column pruning omit large JSON/content fields.
  // The one-element tuple preserves a latest null instead of skipping that revision.
  // Native row policies fence organization, generation, publication and visibility; the
  // organization predicate only narrows the scan to the caller's primary-key range.
  return `SELECT ${selected} FROM ${sqlIdentifier(database)}.${sqlIdentifier(table)} r FINAL WHERE r.organization_id=${traceScopeSql.organization} GROUP BY r.organization_id,r.session_id,r.${sqlIdentifier(identity)} HAVING argMax(r.deleted,r.revision)=0`;
}
/** The `sessions` columns in catalog order, before analytics appends `reuse_count`. */
export const sessionDetailColumns = Object.keys(
  traceViewCatalog.sessions.columns,
).filter((name) => name !== "reuse_count");
export function baseViews(database: string): TraceViewDefinition[] {
  const headerNames = Object.keys(sessionColumns);
  const override = new Set([
    "parent_session_id",
    "parent_relation",
    "parent_native_ref",
    "status",
    "ended_at",
    "last_activity_at",
  ]);
  const headerSelect = headerNames
    .filter((name) => !override.has(name))
    .map((name) => `s.${sqlIdentifier(name)} AS ${sqlIdentifier(name)}`)
    .join(",");
  const metadata = (scope: string, attribute: string, key: string) =>
    `dictGet(${sqlString(database + "." + scope)},${sqlString(attribute)},${key})`;
  const sessionMetadata = (attribute: string) =>
    metadata("session_scope", attribute, "(s.organization_id,s.session_id)");
  const userMetadata = (alias: string, attribute: string) =>
    metadata(
      "user_scope",
      attribute,
      `(${alias}.organization_id,${alias}.user_id)`,
    );
  const installationMetadata = (alias: string) =>
    metadata(
      "installation_scope",
      "hostname",
      `(${alias}.organization_id,${alias}.installation_id)`,
    );
  // Control owns parent links, including the spawning call: the parent's evidence can
  // arrive after the child's last projection, so it is read live, never from the row.
  const base = `SELECT ${headerSelect},${sessionMetadata("parent_session_id")} AS parent_session_id,${sessionMetadata("parent_relation")} AS parent_relation,if(${traceScopeSql.admin},${sessionMetadata("parent_native_ref")},NULL) AS parent_native_ref,${sessionMetadata("parent_tool_use_id")} AS parent_tool_use_id,${sessionMetadata("status")} AS status,${sessionMetadata("ended_at")} AS ended_at,${sessionMetadata("last_activity_at")} AS last_activity_at,${sessionMetadata("visibility")} AS visibility,${sessionMetadata("purged_at")} AS purged_at,${userMetadata("s", "email")} AS user_email,${userMetadata("s", "name")} AS user_name,${installationMetadata("s")} AS installation_hostname FROM (${latestRowsSql(database, "sessions")}) s`;
  const empty = emptyTraceRow("sessions");
  const retained = new Set([
    "session_id",
    "organization_id",
    "harness",
    "harness_session_id",
    "user_id",
    "ingest_api_key_id",
    "installation_id",
    "started_at",
    "ended_at",
    "last_activity_at",
    "status",
    "parent_session_id",
    "parent_relation",
    "parent_native_ref",
  ]);
  const skeleton = headerNames
    .map((name) => {
      const value = empty[name];
      const expression = retained.has(name)
        ? `c.${sqlIdentifier(name)}`
        : name === "observed_commits" || name === "observed_diff_stat"
          ? "'null'"
          : value === null
            ? "NULL"
            : Array.isArray(value)
              ? "[]"
              : typeof value === "number"
                ? String(value)
                : sqlString(typeof value === "string" ? value : "");
      return `CAST(${expression},${sqlString(sessionColumns[name as keyof typeof sessionColumns])}) AS ${sqlIdentifier(name)}`;
    })
    .join(",");
  const skeletonControl = `SELECT i.organization_id AS organization_id,i.session_id AS session_id,${[
    ...retained,
  ]
    .filter((name) => !["organization_id", "session_id"].includes(name))
    .concat([
      "parent_tool_use_id",
      "visibility",
      "purged_at",
      "published_revision",
    ])
    .map(
      (name) =>
        `${metadata("session_scope", name, "(i.organization_id,i.session_id)")} AS ${sqlIdentifier(name)}`,
    )
    .join(",")} FROM ${sqlIdentifier(database)}.session_identities i FINAL`;
  const skeletonSql = `SELECT ${skeleton},c.parent_tool_use_id AS parent_tool_use_id,c.visibility AS visibility,c.purged_at AS purged_at,${userMetadata("c", "email")} AS user_email,${userMetadata("c", "name")} AS user_name,${installationMetadata("c")} AS installation_hostname FROM (${skeletonControl}) c WHERE c.organization_id=${traceScopeSql.organization} AND ${traceScopeSql.admin} AND c.purged_at IS NOT NULL AND c.published_revision>0`;
  // The skeleton retains only native IDs; current compact metadata comes from PostgreSQL.
  const baseNames = [
    ...headerNames,
    "parent_tool_use_id",
    "visibility",
    "purged_at",
    "user_email",
    "user_name",
    "installation_hostname",
  ];
  const baseOrder = baseNames.map(sqlIdentifier).join(",");
  const publicFields = baseNames
    .filter(
      (name) =>
        ![
          "parent_session_id",
          "parent_relation",
          "parent_native_ref",
          "parent_tool_use_id",
        ].includes(name),
    )
    .map((name) => `s.${sqlIdentifier(name)} AS ${sqlIdentifier(name)}`)
    .join(",");
  return [
    traceView("session_live", `SELECT ${baseOrder} FROM (${base})`, "internal"),
    traceView(
      "session_base",
      `SELECT ${baseOrder} FROM api_ro.session_live UNION ALL SELECT ${baseOrder} FROM (${skeletonSql})`,
      "internal",
    ),
    traceView(
      "session_state",
      "SELECT session_id,status,message_count,last_activity_at FROM api_ro.session_base",
    ),
    traceView(
      "session_details",
      `SELECT ${publicFields},p.session_id AS parent_session_id,if(p.session_id IS NOT NULL,s.parent_relation,NULL) AS parent_relation,s.parent_native_ref AS parent_native_ref,if(p.session_id IS NOT NULL,s.parent_tool_use_id,NULL) AS parent_tool_use_id,p.title AS parent_title,coalesce(c.child_count,0) AS child_count,coalesce(f.file_count,0) AS file_count,dateDiff('microsecond',s.started_at,coalesce(s.ended_at,s.last_activity_at))/1000000.0 AS duration_seconds,JSONLength(s.observed_commits) AS observed_commit_count FROM api_ro.session_base s LEFT ANY JOIN api_ro.session_base p ON p.session_id=s.parent_session_id LEFT ANY JOIN (SELECT parent_session_id,count(*) child_count FROM api_ro.session_base WHERE parent_session_id IS NOT NULL GROUP BY parent_session_id)c ON c.parent_session_id=s.session_id LEFT ANY JOIN (SELECT session_id,count(*) file_count FROM (${latestRowsSql(database, "session_files")}) GROUP BY session_id)f ON f.session_id=s.session_id`,
    ),
    traceView(
      "message_metadata",
      latestRowsSql(
        database,
        "messages",
        {
          ...Object.fromEntries(
            Object.entries(messageColumns).filter(
              ([name]) =>
                !["content", "tool_input", "search_text"].includes(name),
            ),
          ),
          payload_bytes: "UInt64",
        },
        { payload_bytes: "length(r.content)+length(r.tool_input)" },
      ),
    ),
    traceView(
      "messages",
      `SELECT m.*,s.title AS session_title,s.repo_name,s.branch,s.user_email FROM (${latestRowsSql(database, "messages")})m JOIN api_ro.session_live s USING(organization_id,session_id)`,
    ),
    traceView(
      "message_chunks",
      latestRowsSql(database, "message_chunks"),
      "vector",
    ),
    traceView(
      "session_embeddings",
      latestRowsSql(database, "session_embeddings"),
      "vector",
    ),
    traceView("raw_records", latestRowsSql(database, "raw_records")),
    traceView("session_files", latestRowsSql(database, "session_files")),
    traceView(
      "users",
      `SELECT DISTINCT user_id AS id,user_email AS email,user_name AS name FROM api_ro.session_base`,
    ),
    traceView(
      "repos",
      `SELECT organization_id,repo_name,min(repo_url) AS repo_url,count(*) AS session_count,uniqExact(user_id) AS user_count,min(started_at) AS first_seen_at,max(last_activity_at) AS last_activity_at FROM api_ro.session_base WHERE repo_name IS NOT NULL GROUP BY organization_id,repo_name`,
    ),
    traceView(
      "installations",
      `SELECT i.organization_id,i.id AS installation_id,any(i.hostname) AS hostname,any(i.os_user) AS os_user,any(i.platform) AS platform,any(i.arch) AS arch,any(i.hook_sha256) AS hook_sha256,toBool(any(i.tools_enabled)) AS tools_enabled,min(s.started_at) AS first_seen_at,max(s.last_activity_at) AS last_seen_at,count(*) AS session_count FROM ${sqlIdentifier(database)}.control_installations i JOIN api_ro.session_base s ON i.organization_id=s.organization_id AND i.id=s.installation_id GROUP BY i.organization_id,i.id`,
    ),
    traceView(
      "session_tools",
      `SELECT organization_id,session_id,arrayJoin(tools_used) AS tool_name FROM api_ro.session_base`,
    ),
    traceView(
      "session_observed_commits",
      `SELECT organization_id,session_id,ordinal,JSONExtractString(value,'sha') AS sha,JSONExtractString(value,'subject') AS subject,JSONExtractString(value,'author') AS author,JSONExtractString(value,'timestamp') AS timestamp FROM api_ro.session_base ARRAY JOIN JSONExtractArrayRaw(observed_commits) AS value,arrayEnumerate(JSONExtractArrayRaw(observed_commits)) AS ordinal`,
    ),
  ];
}
