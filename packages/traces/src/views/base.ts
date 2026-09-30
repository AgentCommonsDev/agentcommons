import {
  sessionReadAggregateColumns,
  traceViewCatalog,
} from "@agentcommons/core/sql";
import { sqlIdentifier, sqlString } from "../client.js";
import { controlTableSql, traceScopeSql } from "../control.js";
import { emptyTraceRow } from "../rows.js";
import {
  sessionColumns,
  messageColumns,
  traceTables,
  type TraceTable,
} from "../schema.js";

export { traceScopeSql } from "../control.js";

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

export function latestRowsSql(
  database: string,
  table: TraceTable,
  columns: Record<string, string> = traceTables[table].columns,
  expressions: Record<string, string> = {},
  identityParameters?: { sessions: string; rows: string },
): string {
  const { identity, identityType } = traceTables[table];
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
  // Only identity predicates belong in PREWHERE: every revision and generation of a
  // selected identity must survive until the native policies and latest-row aggregate.
  const identityPrewhere = identityParameters
    ? `r.session_id IN {${identityParameters.sessions}:Array(UUID)} AND r.${sqlIdentifier(identity)} IN {${identityParameters.rows}:Array(${identityType})}`
    : "";
  return `SELECT ${selected} FROM ${sqlIdentifier(database)}.${sqlIdentifier(table)} r FINAL${identityPrewhere ? ` PREWHERE ${identityPrewhere}` : ""} WHERE r.organization_id=${traceScopeSql.organization} GROUP BY r.organization_id,r.session_id,r.${sqlIdentifier(identity)} HAVING argMax(r.deleted,r.revision)=0`;
}

/** The canonical message relation, optionally bounded to requested identity keys. */
function messageRelationSql(database: string, bounded = false): string {
  const rows = latestRowsSql(
    database,
    "messages",
    messageColumns,
    {},
    bounded ? { sessions: "session_ids", rows: "message_ids" } : undefined,
  );
  const projection = liveProjectionSql(database, ["users"]);
  const sessions = bounded
    ? `SELECT * FROM (${projection}) WHERE session_id IN {session_ids:Array(UUID)}`
    : projection;
  return `SELECT m.*,s.title AS session_title,s.repo_name,s.branch,s.user_email FROM (${rows})m JOIN (${sessions}) s USING(organization_id,session_id)`;
}
/** The `sessions` columns in catalog order, before analytics appends the read aggregates. */
const aggregated: readonly string[] = sessionReadAggregateColumns;
export const sessionDetailColumns = Object.keys(
  traceViewCatalog.sessions.columns,
).filter((name) => !aggregated.includes(name));

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const headerNames = Object.keys(sessionColumns);
/**
 * Header columns control owns, including the spawning call: the parent's evidence can
 * arrive after the child's last projection, so they are read live, never from the row.
 */
const controlOwned = new Set([
  "parent_session_id",
  "parent_relation",
  "parent_native_ref",
  "status",
  "ended_at",
  "last_activity_at",
]);
/** Control columns the session relations expose beyond the projection header. */
const controlExtra = ["parent_tool_use_id", "visibility", "purged_at"];
/** Header columns the purge skeleton retains; every other column shows its empty value. */
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
/** Member and machine metadata columns, in the order `session_live` exposes them. */
const memberMetadata = {
  users: {
    user_email: "coalesce(u.email,'')",
    user_name: "coalesce(u.name,'')",
  },
  installations: { installation_hostname: "coalesce(i.hostname,'')" },
} as const;
type SessionMetadata = keyof typeof memberMetadata;
/** Columns of `session_live` and `session_base`, in order. */
const baseNames = [
  ...headerNames,
  ...controlExtra,
  ...Object.values(memberMetadata).flatMap((columns) => Object.keys(columns)),
];
const columnList = (names: readonly string[], alias: string) =>
  names
    .map((name) => `${alias}.${sqlIdentifier(name)} AS ${sqlIdentifier(name)}`)
    .join(",");

/**
 * The caller-visible sessions as one relation: the latest projection row of every live
 * session joined to its control row, plus (with `skeleton`) the admin-only purge skeleton
 * of every published, purged session that still has an identity row. Session control is
 * read once per branch from the PostgreSQL-engine control table, whose row policy admits
 * only caller-visible sessions, instead of once per row through the dictionary; that same
 * read counts each session's caller-visible children (`childCount`). Member email/name
 * and machine hostname are joined once per query from the scope tables the `metadata`
 * option names. Every branch lists the same columns in `session_live` order.
 */
export function sessionRelationSql(
  database: string,
  options: {
    skeleton?: boolean;
    childCount?: boolean;
    metadata?: readonly SessionMetadata[];
  } = {},
): string {
  const org = traceScopeSql.organization;
  const coreNames = [
    ...headerNames,
    ...controlExtra,
    ...(options.childCount ? ["child_count"] : []),
  ];
  // Every control column either branch reads; the skeleton also retains the identity
  // columns the projection row would otherwise provide.
  const controlNames = [
    ...new Set([
      ...[...headerNames, ...controlExtra].filter(
        (name) => controlOwned.has(name) || controlExtra.includes(name),
      ),
      ...[...retained].filter((name) => name !== "session_id"),
      "purged",
    ]),
  ];
  // One control read per branch: each session's own row (`self`) carries its metadata and
  // every row is also credited to its parent, so the same aggregate yields the child count.
  // A purged child is excluded from that count: control admits purged rows (for the skeleton
  // and Moderation), but a purged session is gone from the browse surfaces for every caller,
  // admins included (ADR 0088), so the count matches the browsable children (R-SEC-03).
  // A condition inside the read (the admin flag) lets ClickHouse drop the branch outright.
  const controlRows = (condition: string) =>
    `SELECT tupleElement(e,1) AS session_id,${controlNames.map((name) => `anyIf(c.${sqlIdentifier(name)},tupleElement(e,2)=1) AS ${sqlIdentifier(name)}`).join(",")},countIf(tupleElement(e,2)=0 AND c.purged=0) AS child_count FROM (SELECT ${["session_id", ...controlNames].map(sqlIdentifier).join(",")} FROM ${controlTableSql(database, "session_scope")} WHERE organization_id=${org}${condition ? ` AND ${condition}` : ""}) c ARRAY JOIN [tuple(c.session_id,1),tuple(coalesce(c.parent_session_id,toUUID(${sqlString(ZERO_UUID)})),0)] AS e GROUP BY tupleElement(e,1) HAVING countIf(tupleElement(e,2)=1)=1`;
  const liveHeader = (name: string) =>
    name === "parent_native_ref"
      ? `if(${traceScopeSql.admin},c.parent_native_ref,NULL)`
      : controlOwned.has(name)
        ? `c.${sqlIdentifier(name)}`
        : `s.${sqlIdentifier(name)}`;
  const fromControl = (name: string) =>
    controlExtra.includes(name) || name === "child_count";
  const live = `SELECT ${coreNames.map((name) => `${fromControl(name) ? `c.${sqlIdentifier(name)}` : liveHeader(name)} AS ${sqlIdentifier(name)}`).join(",")} FROM (${latestRowsSql(database, "sessions")}) s JOIN (${controlRows("")}) c ON c.session_id=s.session_id`;
  const empty = emptyTraceRow("sessions");
  const skeletonHeader = (name: string) => {
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
    return `CAST(${expression},${sqlString(sessionColumns[name as keyof typeof sessionColumns])})`;
  };
  // The skeleton retains only native identities; every compact field comes from control.
  const skeleton = `SELECT ${coreNames.map((name) => `${fromControl(name) ? `c.${sqlIdentifier(name)}` : skeletonHeader(name)} AS ${sqlIdentifier(name)}`).join(",")} FROM (${controlRows(traceScopeSql.admin)}) c JOIN (SELECT session_id FROM ${sqlIdentifier(database)}.session_identities FINAL WHERE organization_id=${org}) i ON i.session_id=c.session_id WHERE c.purged=1`;
  const core = options.skeleton ? `${live} UNION ALL ${skeleton}` : live;
  return withMemberMetadata(database, core, coreNames, options.metadata ?? []);
}
/**
 * Member email/name and machine hostname for a session relation `core` whose columns are
 * `names`, joined once per query from the scope tables the `metadata` list names.
 */
function withMemberMetadata(
  database: string,
  core: string,
  names: readonly string[],
  metadata: readonly SessionMetadata[],
): string {
  if (!metadata.length) return core;
  const org = traceScopeSql.organization;
  const joins = {
    users: `LEFT ANY JOIN (SELECT id,email,name FROM ${controlTableSql(database, "user_scope")} WHERE organization_id=${org}) u ON u.id=b.user_id`,
    installations: `LEFT ANY JOIN (SELECT id,hostname FROM ${controlTableSql(database, "installation_scope")} WHERE organization_id=${org}) i ON i.id=b.installation_id`,
  };
  const selected = (Object.keys(memberMetadata) as SessionMetadata[])
    .filter((name) => metadata.includes(name))
    .flatMap((name) =>
      Object.entries(memberMetadata[name]).map(
        ([column, expression]) => `${expression} AS ${sqlIdentifier(column)}`,
      ),
    );
  return `SELECT ${columnList(names, "b")},${selected.join(",")} FROM (${core}) b ${(
    Object.keys(joins) as SessionMetadata[]
  )
    .filter((name) => metadata.includes(name))
    .map((name) => joins[name])
    .join(" ")}`;
}
/**
 * The live sessions as their latest projection rows only, for relations that read nothing
 * control owns (no lifecycle, parent or visibility columns): the row policy already admits
 * only published, unpurged, caller-visible sessions, so `purged_at` is null by construction
 * and no control table is joined. Every read of it in one query context shares the policy
 * scalar with the other guarded tables of that context.
 */
export function liveProjectionSql(
  database: string,
  metadata: readonly SessionMetadata[] = [],
): string {
  const core = `SELECT ${columnList(headerNames, "s")},CAST(NULL,${sqlString(sessionColumns.ended_at)}) AS purged_at FROM (${latestRowsSql(database, "sessions")}) s`;
  return withMemberMetadata(
    database,
    core,
    [...headerNames, "purged_at"],
    metadata,
  );
}
/** Every session relation column, including member metadata. */
const allMetadata: readonly SessionMetadata[] = ["users", "installations"];

/**
 * `session_details`: the session relation with its caller-visible parent link, parent
 * title, child and file counts and duration, as one query context. The sessions table is
 * scanned once for the rows and once, two columns wide, for the titles of visible parents;
 * a purged parent is present for admins through its identity row, which the same policy
 * scalar admits; child counts come with the control read of the rows themselves.
 */
export function sessionDetailsSql(database: string): string {
  const org = traceScopeSql.organization;
  const hidden = new Set([
    "parent_session_id",
    "parent_relation",
    "parent_native_ref",
    "parent_tool_use_id",
  ]);
  const publicFields = columnList(
    baseNames.filter((name) => !hidden.has(name)),
    "s",
  );
  const titles = latestRowsSql(database, "sessions", {
    organization_id: sessionColumns.organization_id,
    session_id: sessionColumns.session_id,
    title: sessionColumns.title,
  });
  const parents = `SELECT session_id,title FROM (${titles}) UNION ALL SELECT session_id,NULL AS title FROM ${sqlIdentifier(database)}.session_identities FINAL WHERE organization_id=${org}`;
  return `SELECT ${publicFields},p.session_id AS parent_session_id,if(p.session_id IS NOT NULL,s.parent_relation,NULL) AS parent_relation,s.parent_native_ref AS parent_native_ref,if(p.session_id IS NOT NULL,s.parent_tool_use_id,NULL) AS parent_tool_use_id,p.title AS parent_title,s.child_count AS child_count,coalesce(f.file_count,0) AS file_count,dateDiff('microsecond',s.started_at,coalesce(s.ended_at,s.last_activity_at))/1000000.0 AS duration_seconds,JSONLength(s.observed_commits) AS observed_commit_count,length(s.observed_branches) AS observed_branch_count FROM (${sessionRelationSql(database, { skeleton: true, childCount: true, metadata: allMetadata })}) s LEFT ANY JOIN (${parents}) p ON p.session_id=s.parent_session_id LEFT ANY JOIN (SELECT session_id,count() AS file_count FROM (${latestRowsSql(database, "session_files")}) GROUP BY session_id) f ON f.session_id=s.session_id`;
}

export function baseViews(database: string): TraceViewDefinition[] {
  return [
    traceView(
      "session_live",
      sessionRelationSql(database, { metadata: allMetadata }),
      "internal",
    ),
    traceView(
      "session_base",
      sessionRelationSql(database, { skeleton: true, metadata: allMetadata }),
      "internal",
    ),
    traceView(
      "session_state",
      `SELECT session_id,status,message_count,last_activity_at FROM (${sessionRelationSql(database, { skeleton: true })})`,
    ),
    traceView("session_details", sessionDetailsSql(database)),
    // The session→author map the search teammate boost joins (ADR 0090): one scan of the
    // sessions projection, three columns wide, fenced by the same row policy as every other
    // session relation. Search bounds it to the candidate session ids, so it reads only
    // those rows and never scans the whole corpus.
    traceView(
      "session_authors",
      latestRowsSql(database, "sessions", {
        organization_id: sessionColumns.organization_id,
        session_id: sessionColumns.session_id,
        user_id: sessionColumns.user_id,
      }),
    ),
    traceView(
      "message_metadata",
      latestRowsSql(database, "messages", {
        ...Object.fromEntries(
          Object.entries(messageColumns).filter(
            ([name]) =>
              !["content", "tool_input", "search_text"].includes(name),
          ),
        ),
        // Stored at write time: sizing a transcript page never reads its payload.
        payload_bytes: "UInt64",
      }),
    ),
    traceView("messages", messageRelationSql(database)),
    traceView(
      "message_payloads",
      `SELECT message_id,content,tool_input FROM (${messageRelationSql(database, true)})`,
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
      `SELECT i.organization_id,i.id AS installation_id,any(i.hostname) AS hostname,any(i.os_user) AS os_user,any(i.platform) AS platform,any(i.arch) AS arch,any(i.hook_sha256) AS hook_sha256,toBool(any(i.tools_enabled)) AS tools_enabled,min(s.started_at) AS first_seen_at,max(s.last_activity_at) AS last_seen_at,count(*) AS session_count FROM ${controlTableSql(database, "installations")} i JOIN api_ro.session_base s ON i.organization_id=s.organization_id AND i.id=s.installation_id GROUP BY i.organization_id,i.id`,
    ),
    traceView(
      "session_tools",
      `SELECT organization_id,session_id,arrayJoin(tools_used) AS tool_name FROM api_ro.session_base`,
    ),
    traceView(
      "session_observed_commits",
      `SELECT organization_id,session_id,ordinal,JSONExtractString(value,'sha') AS sha,JSONExtractString(value,'subject') AS subject,JSONExtractString(value,'author') AS author,JSONExtractString(value,'timestamp') AS timestamp FROM api_ro.session_base ARRAY JOIN JSONExtractArrayRaw(observed_commits) AS value,arrayEnumerate(JSONExtractArrayRaw(observed_commits)) AS ordinal`,
    ),
    traceView(
      "session_observed_branches",
      `SELECT organization_id,session_id,branch,ordinal FROM api_ro.session_base ARRAY JOIN observed_branches AS branch,arrayEnumerate(observed_branches) AS ordinal`,
    ),
  ];
}
