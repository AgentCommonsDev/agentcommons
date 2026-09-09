import type { TraceQueryClient, TraceParameters } from "@agentcommons/traces";
import { hasAdminAuthority, type Prisma } from "@agentcommons/db";
import {
  sessionHeaderSchema,
  jsonValueSchema,
  type CallerContext,
  type SearchFilters,
  type SearchCondition,
  searchConditionFields,
  type SessionHeader,
  truncateUtf8,
  reuseEdgeSchema,
  reusePagePositionSchema,
  type ReuseSort,
  type ReusePagePosition,
} from "@agentcommons/core";
import { ServiceError } from "../services/context.js";
import { wireRow, compactMetadata } from "../services/read-budget.js";

export class Parameters {
  readonly values: TraceParameters = {};
  add(value: TraceParameters[string], type?: string): string {
    const name = `p${String(Object.keys(this.values).length + 1)}`;
    this.values[name] = value;
    if (type === "DateTime64(6, 'UTC')")
      return `parseDateTime64BestEffort({${name}:String},6,'UTC')`;
    const inferred =
      typeof value === "boolean"
        ? "Bool"
        : typeof value === "number"
          ? Number.isInteger(value)
            ? "Int64"
            : "Float64"
          : typeof value === "bigint"
            ? "Int64"
            : Array.isArray(value)
              ? "Array(String)"
              : value === null
                ? "Nullable(String)"
                : "String";
    return `{${name}:${type ?? inferred}}`;
  }
}
function array<T>(value: T | readonly T[]): readonly T[] {
  return Array.isArray(value) ? value : [value as T];
}
export function traceJson(value: unknown) {
  return jsonValueSchema.parse(
    typeof value === "string" ? JSON.parse(value) : value,
  );
}
function conditionSql(condition: SearchCondition, params: Parameters): string {
  if (condition.field === "tool_input") {
    // Traverse with native JSON functions. Object keys remain strings; array offsets are zero-based,
    // including negative offsets, matching the shared filter contract.
    const path = params.add(condition.path ?? [], "Array(String)");
    const offset = "accurateCastOrNull(key,'Int64')";
    const json = `arrayFold((value,key)->if(toString(JSONType(value))='Array' AND match(key,'^-?[0-9]+$'),JSONExtractRaw(value,ifNull(if(${offset}<0,${offset},if(${offset}<9223372036854775807,${offset}+1,NULL)),0)),JSONExtractRaw(value,key)),${path},m.tool_input)`;
    const exists = `${json}!=''`;
    const type = `toString(JSONType(${json}))`;
    const text = `JSONExtractString(${json})`;
    if (condition.op === "exists") return exists;
    if (condition.op === "eq") {
      const value = condition.value;
      if (value === null) return `(${exists} AND ${type}='Null')`;
      if (typeof value === "string")
        return `(${type}='String' AND ${text}=${params.add(value)})`;
      if (typeof value === "boolean")
        return `(${type}='Bool' AND JSONExtractBool(${json})=${params.add(value)})`;
      return `(${type} IN ('Int64','UInt64','Float64') AND JSONExtractFloat(${json})=${params.add(value, "Float64")})`;
    }
    const value = params.add(condition.value);
    const comparison =
      condition.op === "contains"
        ? `positionCaseInsensitiveUTF8(${text},${value})>0`
        : `startsWith(lowerUTF8(${text}),lowerUTF8(${value}))`;
    return `(${type}='String' AND ${comparison})`;
  }
  const expression = `${searchConditionFields[condition.field] === "message" ? "m" : "s"}.${condition.field}`;
  if (condition.op === "exists") return `${expression} IS NOT NULL`;
  if (condition.op === "eq")
    return condition.value === null
      ? `${expression} IS NULL`
      : `${expression}=${params.add(condition.value)}`;
  const value = params.add(condition.value);
  return condition.op === "contains"
    ? `positionCaseInsensitiveUTF8(${expression},${value})>0`
    : `startsWith(lowerUTF8(${expression}),lowerUTF8(${value}))`;
}
export async function filterSql(
  client: TraceQueryClient,
  filters: SearchFilters,
  params: Parameters,
): Promise<string> {
  const conditions = (filters.where ?? []).map((condition) =>
    conditionSql(condition, params),
  );
  if (filters.repo_name !== undefined) {
    const requested = array(filters.repo_name);
    const aliases = [
      ...new Set(requested.filter((repo) => !repo.includes("/"))),
    ];
    const matches = aliases.length
      ? await client.query<{ repo_name: string; alias: string }>(
          "SELECT repo_name,arrayElement(splitByChar('/',repo_name),-1) AS alias FROM api_ro.repos WHERE alias IN {aliases:Array(String)}",
          { aliases },
        )
      : { rows: [] };
    const byAlias = new Map<string, string[]>();
    for (const match of matches.rows) {
      const names = byAlias.get(match.alias) ?? [];
      names.push(match.repo_name);
      byAlias.set(match.alias, names);
    }
    const names: string[] = [];
    for (const repo of requested) {
      if (repo.includes("/")) {
        names.push(repo);
        continue;
      }
      const resolved = byAlias.get(repo) ?? [];
      if (resolved.length > 1)
        throw new ServiceError(
          400,
          "AMBIGUOUS_REPO",
          "This repository name matches several repositories. Use its full host/organization/repository name.",
        );
      names.push(resolved[0] ?? repo);
    }
    conditions.push(`s.repo_name IN ${params.add(names)}`);
  }
  for (const key of ["branch", "user_email", "session_id"] as const) {
    const value = filters[key];
    if (value !== undefined)
      conditions.push(
        `s.${key} IN ${params.add(array(value), key === "session_id" ? "Array(UUID)" : "Array(String)")}`,
      );
  }
  for (const key of ["role", "tool_name"] as const) {
    const value = filters[key];
    if (value !== undefined)
      conditions.push(`m.${key} IN ${params.add(array(value))}`);
  }
  // Both file filters test the same session_files row, so "edited a file under src/"
  // never matches a session that edited elsewhere and merely read src/.
  const file = [
    ...(filters.file_prefix === undefined
      ? []
      : [
          `arrayExists(prefix -> startsWith(path,prefix),${params.add(array(filters.file_prefix))})`,
        ]),
    ...(filters.file_operation === undefined
      ? []
      : [`hasAny(ops,${params.add(array(filters.file_operation))})`]),
  ];
  if (file.length)
    conditions.push(
      `s.session_id IN (SELECT session_id FROM api_ro.session_files WHERE ${file.join(" AND ")})`,
    );
  for (const key of ["since", "until"] as const) {
    const value = filters[key];
    if (value !== undefined)
      conditions.push(
        `arrayExists(bound -> coalesce(m.timestamp,m.received_at) ${key === "since" ? ">=" : "<"} parseDateTime64BestEffort(bound,6,'UTC'),${params.add(array(value))})`,
      );
  }
  return conditions.length
    ? conditions.map((condition) => `(${condition})`).join(" AND ")
    : "true";
}

export async function visibleSession(
  client: TraceQueryClient,
  sessionId: string,
  projection: "state" | "header" = "state",
): Promise<Record<string, unknown>> {
  const result = await client.query(
    projection === "header"
      ? "SELECT * FROM api_ro.sessions WHERE session_id={id:UUID}"
      : "SELECT session_id,status,message_count,last_activity_at FROM api_ro.session_state WHERE session_id={id:UUID}",
    { id: sessionId },
  );
  const row = result.rows[0];
  if (!row)
    throw new ServiceError(
      404,
      "SESSION_NOT_FOUND",
      "This session is not available.",
    );
  return row;
}
const refSql =
  "session_id,title,parent_relation,parent_tool_use_id,agent_type,parent_session_id";
export async function sessionHeader(
  client: TraceQueryClient,
  row: Record<string, unknown>,
): Promise<SessionHeader> {
  const headers = await sessionHeaders(client, [row]);
  const header = headers[0];
  if (!header) throw new Error("The session header is unavailable.");
  return header;
}
/**
 * The root of each session's tree, walking parents through the caller-visible view;
 * a session with no visible parent is its own root. One query for the whole batch.
 */
export async function rootSessionIds(
  client: TraceQueryClient,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const roots = await client.query(
    `WITH RECURSIVE ancestors AS (
      SELECT session_id AS origin,session_id,parent_session_id,[session_id] AS path FROM api_ro.session_details WHERE session_id IN {ids:Array(UUID)}
      UNION ALL SELECT a.origin,s.session_id,s.parent_session_id,arrayConcat(a.path,[s.session_id]) FROM api_ro.session_details s JOIN ancestors a ON s.session_id=a.parent_session_id WHERE NOT has(a.path,s.session_id)
    ) SELECT origin,argMax(session_id,length(path)) AS root_session_id FROM ancestors GROUP BY origin`,
    { ids: [...ids] },
  );
  return new Map(
    roots.rows.map((row) => [String(row.origin), String(row.root_session_id)]),
  );
}
/** Batch related references for a whole list instead of issuing queries per session. */
export async function sessionHeaders(
  client: TraceQueryClient,
  rows: Record<string, unknown>[],
): Promise<SessionHeader[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => String(row.session_id));
  const parents = rows.flatMap((row) =>
    typeof row.parent_session_id === "string" ? [row.parent_session_id] : [],
  );
  const relatives = await client.query(
    `SELECT ${refSql} FROM api_ro.session_details WHERE session_id IN {parents:Array(UUID)}
     UNION ALL SELECT ${refSql} FROM (SELECT * FROM api_ro.session_details WHERE parent_session_id IN {ids:Array(UUID)} ORDER BY started_at,session_id LIMIT 10 BY parent_session_id)`,
    { parents, ids },
  );
  const rootById = await rootSessionIds(client, ids);
  const ref = (value: Record<string, unknown>) => ({
    session_id: value.session_id,
    title: value.title,
    parent_relation: value.parent_relation,
    parent_tool_use_id: value.parent_tool_use_id,
    agent_type: value.agent_type,
  });
  return rows.map((row) => {
    const header: Record<string, unknown> = {};
    const wire = wireRow(row);
    for (const key of Object.keys(sessionHeaderSchema.shape))
      if (key in wire) header[key] = wire[key];
    for (const key of [
      "file_count",
      "observed_commit_count",
      "reuse_count",
      "child_count",
    ])
      header[key] = Number(row[key]);
    const parent = relatives.rows.find(
      (relative) => relative.session_id === row.parent_session_id,
    );
    const children = relatives.rows
      .filter((relative) => relative.parent_session_id === row.session_id)
      .slice(0, 10);
    header.parent = parent ? ref(parent) : null;
    header.children = children.map(ref);
    header.root_session_id =
      rootById.get(String(row.session_id)) ?? row.session_id;
    header.children_truncated = Number(row.child_count) > children.length;
    header.truncated_fields = [];
    return boundedHeader(sessionHeaderSchema.parse(header));
  });
}

function boundedHeader(original: SessionHeader): SessionHeader {
  const fields = [
    "title",
    "harness_version",
    "entrypoint",
    "model",
    "repo_name",
    "repo_url",
    "branch",
    "cwd_relative",
    "start_commit",
    "end_commit",
    "end_reason",
    "agent_type",
  ] as const;
  for (let maximum = 256; maximum >= 8; maximum /= 2) {
    const fieldsTruncated = new Set<string>();
    const bound = (value: string | null, field: string): string | null => {
      if (value === null) return null;
      const bounded = truncateUtf8(value, maximum);
      if (bounded !== value) fieldsTruncated.add(field);
      return bounded;
    };
    const result = { ...original };
    for (const field of fields) result[field] = bound(original[field], field);
    result.installation_hostname =
      bound(original.installation_hostname, "installation_hostname") ?? "";
    for (const field of ["models_used", "tools_used"] as const) {
      result[field] = original[field]
        .slice(0, 16)
        .map((value) => bound(value, field) ?? "");
      if (result[field].length < original[field].length)
        fieldsTruncated.add(field);
    }
    const ref = (value: SessionHeader["children"][number], field: string) => ({
      ...value,
      title: bound(value.title, field),
      agent_type: bound(value.agent_type, field),
    });
    result.children = original.children.map((value) => ref(value, "children"));
    result.parent = original.parent ? ref(original.parent, "parent") : null;
    result.truncated_fields = [...fieldsTruncated].sort();
    if (Buffer.byteLength(JSON.stringify(result)) <= 12 * 1024) return result;
  }
  throw new ServiceError(
    413,
    "SESSION_IDENTITY_TOO_LARGE",
    "The session identity exceeds the response limit.",
  );
}

export async function rawRecords(
  client: TraceQueryClient,
  sessionId: string,
  after: {
    pos: string;
    sourceVersion: number;
    id: string;
    offset: number;
  } | null,
  limit: number,
) {
  await visibleSession(client, sessionId);
  const params = new Parameters();
  const id = params.add(sessionId, "UUID");
  const checkpoint = after
    ? `(pos,source_version,raw_record_id) ${after.offset > 0 ? ">=" : ">"} (${params.add(after.pos, "Int64")},${params.add(after.sourceVersion, "UInt32")},${params.add(after.id, "UUID")})`
    : "true";
  const result = await client.query(
    `SELECT * FROM api_ro.raw_records WHERE session_id=${id} AND ${checkpoint} ORDER BY pos,source_version,raw_record_id LIMIT ${params.add(limit + 1)}`,
    params.values,
  );
  return result.rows.map((row) => ({
    id: String(row.raw_record_id),
    sessionId: String(row.session_id),
    organizationId: String(row.organization_id),
    pos: BigInt(String(row.pos)),
    sourceVersion: Number(row.source_version),
    key: row.key,
    recordType: String(row.record_type),
    payload: traceJson(row.payload),
    ingestBatchId: String(row.ingest_batch_id),
    receivedAt: new Date(String(row.received_at)),
  }));
}

/** Graph traversal uses only compact control; visible presentation comes from ClickHouse. */
export async function sessionTreePage(
  prisma: Prisma.TransactionClient,
  client: TraceQueryClient,
  caller: CallerContext,
  sessionId: string,
  after: { time: string; id: string } | null,
  limit: number,
) {
  const admin = hasAdminAuthority(caller);
  const graph = await prisma.$queryRaw<
    { session_id: string; parent_session_id: string | null; gap: boolean }[]
  >`
    WITH RECURSIVE ancestors AS (
      SELECT id,parent_session_id,ARRAY[id] path FROM public.trace_session_control
      WHERE organization_id=${caller.organizationId} AND id=${sessionId}::uuid
      UNION ALL SELECT s.id,s.parent_session_id,a.path||s.id FROM public.trace_session_control s JOIN ancestors a ON s.id=a.parent_session_id
      WHERE s.organization_id=${caller.organizationId} AND NOT s.id=ANY(a.path)
    ), root AS (SELECT id FROM ancestors ORDER BY cardinality(path) DESC LIMIT 1), descendants AS (
      SELECT s.id,ARRAY[s.id] path,NULL::uuid visible_parent_id,false gap,
        (s.published_revision>0 AND ((s.visibility='PUBLIC' AND s.purged_at IS NULL) OR ${admin})) visible
      FROM public.trace_session_control s JOIN root r ON s.id=r.id WHERE s.organization_id=${caller.organizationId}
      UNION ALL SELECT s.id,d.path||s.id,CASE WHEN d.visible THEN d.id ELSE d.visible_parent_id END,NOT d.visible,
        (s.published_revision>0 AND ((s.visibility='PUBLIC' AND s.purged_at IS NULL) OR ${admin})) visible
      FROM public.trace_session_control s JOIN descendants d ON s.parent_session_id=d.id WHERE s.organization_id=${caller.organizationId} AND NOT s.id=ANY(d.path)
    ) SELECT s.id session_id,d.visible_parent_id parent_session_id,d.gap FROM descendants d
    JOIN public.trace_session_control s ON s.id=d.id AND s.organization_id=${caller.organizationId}
    WHERE d.visible AND (${after?.time ?? null}::timestamptz IS NULL OR (s.started_at,s.id)>(${after?.time ?? null}::timestamptz,${after?.id ?? null}::uuid))
    ORDER BY s.started_at,s.id LIMIT ${limit + 1}`;
  if (!graph.length) return [];
  const result = await client.query(
    `SELECT session_id,title,harness,agent_type,parent_relation,parent_tool_use_id,user_email,started_at,status,message_count FROM api_ro.session_details WHERE session_id IN {ids:Array(UUID)}`,
    { ids: graph.map((row) => row.session_id) },
  );
  const byId = new Map(result.rows.map((row) => [String(row.session_id), row]));
  // PostgreSQL and ClickHouse order UUIDs differently. Keep the graph's keyset order.
  return graph.flatMap((node) => {
    const row = byId.get(node.session_id);
    return row ? [{ ...row, ...node }] : [];
  });
}

/** Shared projection for a caller-visible, filtered edge CTE named peers. */
const reuseEdgeSelectSql = `SELECT e.source_session_id,e.target_session_id,s.title AS source_title,t.title AS target_title,
  e.reader_user_id,e.reader_email,e.reader_harness,e.audit_id,
  e.read_at AS read_at
FROM peers e JOIN api_ro.session_details s ON s.session_id=e.source_session_id
JOIN api_ro.session_details t ON t.session_id=e.target_session_id`;
function reuseEdge(row: Record<string, unknown>) {
  return reuseEdgeSchema.parse(
    compactMetadata(wireRow(row), [
      "source_title",
      "target_title",
      "reader_email",
    ]),
  );
}

/** Latest edge per visible peer pair, with a bounded, deletion-safe keyset. */
export async function reuseEdgePage(
  client: TraceQueryClient,
  options: {
    scope:
      | { sessionId: string; direction: "by" | "from" }
      | { home: "reused" | "inbound" | "outbound"; userId: string };
    asOf: string;
    sort: ReuseSort;
    order: "asc" | "desc";
    readerUserId?: string | undefined;
    after: ReusePagePosition | null;
    limit: number;
  },
) {
  const params = new Parameters();
  const predicates = [
    `e.read_at<=${params.add(options.asOf, "DateTime64(6, 'UTC')")}`,
  ];
  if ("sessionId" in options.scope) {
    const column = { by: "target_session_id", from: "source_session_id" }[
      options.scope.direction
    ];
    predicates.push(
      `e.${column}=${params.add(options.scope.sessionId, "UUID")}`,
    );
  } else {
    const owner = { reused: null, inbound: "target", outbound: "source" }[
      options.scope.home
    ];
    if (owner)
      predicates.push(
        `e.${owner}_session_id IN (SELECT session_id FROM api_ro.session_details WHERE user_id=${params.add(options.scope.userId)})`,
      );
    if (options.scope.home === "reused")
      predicates.push(
        `e.read_at>=toStartOfWeek(${params.add(options.asOf, "DateTime64(6, 'UTC')")},1,'UTC')`,
      );
  }
  if (options.readerUserId !== undefined)
    predicates.push(`e.reader_user_id=${params.add(options.readerUserId)}`);
  const sortExpression =
    options.sort === "read_at"
      ? "read_at"
      : `substringUTF8(${options.sort},1,256)`;
  const after = options.after;
  let checkpoint = "true";
  if (after) {
    const ties = `(source_session_id,target_session_id)>(${params.add(after.source_session_id, "UUID")},${params.add(after.target_session_id, "UUID")})`;
    if (after.value === null) checkpoint = `sort_value IS NULL AND ${ties}`;
    else {
      const value = params.add(
        after.value,
        options.sort === "read_at" ? "DateTime64(6, 'UTC')" : "String",
      );
      const typed = options.sort === "read_at" ? value : value;
      checkpoint = `(sort_value IS NULL OR sort_value${options.order === "asc" ? ">" : "<"}${typed} OR (sort_value=${typed} AND ${ties}))`;
    }
  }
  const result = await client.query(
    `WITH peers AS (
      SELECT e.*
      FROM api_ro.reuse_edges e
      WHERE ${predicates.join(" AND ")}
      ORDER BY e.read_at DESC,e.audit_id DESC LIMIT 1 BY e.source_session_id,e.target_session_id
    ), selected AS (${reuseEdgeSelectSql}), sorted AS (SELECT selected.*,${sortExpression} AS sort_value FROM selected)
    SELECT * FROM sorted WHERE ${checkpoint}
    ORDER BY sort_value ${options.order} NULLS LAST,source_session_id,target_session_id LIMIT ${params.add(options.limit)}`,
    params.values,
  );
  return result.rows.map(({ sort_value, ...row }) => ({
    item: reuseEdge(row),
    position: reusePagePositionSchema.parse({
      value: options.sort === "read_at" ? row.read_at : sort_value,
      source_session_id: row.source_session_id,
      target_session_id: row.target_session_id,
    }),
  }));
}
