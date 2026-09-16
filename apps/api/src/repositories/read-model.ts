import {
  sqlIdentifier,
  type TraceQueryClient,
  type TraceReadClient,
  type TraceParameters,
} from "@agentcommons/traces";
import { hasAdminAuthority, Prisma } from "@agentcommons/db";
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
import {
  sessionReadAggregateColumns,
  traceViewCatalog,
} from "@agentcommons/core/sql";
import { ServiceError } from "../services/context.js";
import {
  wireRow,
  compactMetadata,
  pickSchema,
} from "../services/read-budget.js";

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
/** The message columns only the payload-carrying `messages` view has. */
const PAYLOAD_FIELDS = new Set<SearchCondition["field"]>([
  "content",
  "tool_input",
]);
/**
 * One filter set split by the relation each predicate reads, so a caller scans each
 * relation once: session predicates over the alias `s` (`api_ro.sessions` or
 * `api_ro.session_details`), message predicates over the alias `m`, and the lightest
 * message relation that serves them (`message_metadata` unless a predicate needs content).
 */
interface FilterPlan {
  session: string[];
  message: string[];
  messageView: "messages" | "message_metadata";
}
/** Predicates joined with AND; `true` when there are none. */
export function andSql(predicates: readonly string[]): string {
  return predicates.length
    ? predicates.map((predicate) => `(${predicate})`).join(" AND ")
    : "true";
}
export async function filterSql(
  client: TraceQueryClient,
  filters: SearchFilters,
  params: Parameters,
): Promise<FilterPlan> {
  const where = filters.where ?? [];
  const plan: FilterPlan = {
    session: [],
    message: [],
    messageView: where.some((condition) => PAYLOAD_FIELDS.has(condition.field))
      ? "messages"
      : "message_metadata",
  };
  for (const condition of where)
    plan[searchConditionFields[condition.field]].push(
      conditionSql(condition, params),
    );
  const conditions = plan.session;
  if (filters.repo_name !== undefined) {
    // Three accepted forms (§7.2): the canonical `host/org/repo` (exact), the `org/repo`
    // pair agents read off a remote (one slash: exact, or the unique repository whose
    // name ends with it), and the bare repository name (unique last segment). The
    // canonical form needs no lookup; the other two share one query over the repos view.
    const requested = array(filters.repo_name);
    const slashes = (repo: string) => repo.split("/").length - 1;
    const aliases = [
      ...new Set(requested.filter((repo) => slashes(repo) === 0)),
    ];
    const pairs = [...new Set(requested.filter((repo) => slashes(repo) === 1))];
    const matches =
      aliases.length || pairs.length
        ? await client.query<{ repo_name: string; alias: string }>(
            "SELECT repo_name,arrayElement(splitByChar('/',repo_name),-1) AS alias FROM api_ro.repos WHERE alias IN {aliases:Array(String)} OR repo_name IN {pairs:Array(String)} OR arrayExists(pair -> endsWith(repo_name,concat('/',pair)),{pairs:Array(String)})",
            { aliases, pairs },
          )
        : { rows: [] };
    const resolve = (repo: string): string[] =>
      slashes(repo) === 0
        ? matches.rows
            .filter((match) => match.alias === repo)
            .map((match) => match.repo_name)
        : matches.rows.some((match) => match.repo_name === repo)
          ? [repo]
          : matches.rows
              .filter((match) => match.repo_name.endsWith(`/${repo}`))
              .map((match) => match.repo_name);
    const names: string[] = [];
    for (const repo of requested) {
      if (slashes(repo) > 1) {
        names.push(repo);
        continue;
      }
      const resolved = resolve(repo);
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
  // A branch filter matches every branch the session worked on, not only the last one,
  // so a session that switched to the named branch is found. New rows carry the whole set
  // in observed_branches (which always includes the current branch); rows projected before
  // observed_branches existed have an empty set, so the equality test on `branch` keeps
  // them findable until they re-project.
  if (filters.branch !== undefined) {
    const branches = params.add(array(filters.branch), "Array(String)");
    conditions.push(
      `(hasAny(s.observed_branches,${branches}) OR s.branch IN ${branches})`,
    );
  }
  for (const key of [
    "user_email",
    "session_id",
    "ingest_api_key_id",
  ] as const) {
    const value = filters[key];
    if (value !== undefined)
      conditions.push(
        `s.${key} IN ${params.add(array(value), key === "session_id" ? "Array(UUID)" : "Array(String)")}`,
      );
  }
  for (const key of ["role", "tool_name"] as const) {
    const value = filters[key];
    if (value !== undefined)
      plan.message.push(`m.${key} IN ${params.add(array(value))}`);
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
      plan.message.push(
        `arrayExists(bound -> coalesce(m.timestamp,m.received_at) ${key === "since" ? ">=" : "<"} parseDateTime64BestEffort(bound,6,'UTC'),${params.add(array(value))})`,
      );
  }
  return plan;
}

const sessionNotFound = () =>
  new ServiceError(404, "SESSION_NOT_FOUND", "This session is not available.");
/** The light visibility answer for a read that carries no header: state from `session_state`. */
export async function visibleSession(
  client: TraceQueryClient,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const result = await client.query(
    "SELECT session_id,status,message_count,last_activity_at FROM api_ro.session_state WHERE session_id={id:UUID}",
    { id: sessionId },
  );
  const row = result.rows[0];
  if (!row) throw sessionNotFound();
  return row;
}
/**
 * The control-side visibility rule the tree and the header links share (alias `s` over
 * `trace_session_control`): published, and public and unpurged unless the caller is an
 * admin. It mirrors the native row policies, which read the same control columns.
 */
function visibleControlSql(caller: CallerContext): Prisma.Sql {
  const admin = hasAdminAuthority(caller);
  return Prisma.sql`(s.published_revision>0 AND ((s.visibility='PUBLIC' AND s.purged_at IS NULL) OR ${admin}))`;
}
interface SessionLinks {
  /** The nearest visible ancestor; null when the session is a visible root. */
  parent_session_id: string | null;
  /** The top of the visible parent chain; the session itself for a root. */
  root_session_id: string;
}
/**
 * Parent and root links of a batch of sessions from compact control in the fenced
 * transaction, walking parents while they stay caller-visible; one recursive PostgreSQL
 * query instead of a recursive scan of the `session_details` view per batch.
 */
export async function sessionLinks(
  control: Prisma.TransactionClient,
  caller: CallerContext,
  ids: readonly string[],
): Promise<Map<string, SessionLinks>> {
  if (!ids.length) return new Map();
  const visible = visibleControlSql(caller);
  const rows = await control.$queryRaw<
    {
      origin: string;
      root_session_id: string;
      parent_session_id: string | null;
    }[]
  >`
    WITH RECURSIVE ancestors AS (
      SELECT s.id AS origin,s.id,s.parent_session_id,ARRAY[s.id] AS path FROM public.trace_session_control s
      WHERE s.organization_id=${caller.organizationId} AND s.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) AND ${visible}
      UNION ALL SELECT a.origin,s.id,s.parent_session_id,a.path||s.id FROM public.trace_session_control s JOIN ancestors a ON s.id=a.parent_session_id
      WHERE s.organization_id=${caller.organizationId} AND NOT s.id=ANY(a.path) AND ${visible}
    ) SELECT origin,(array_agg(id ORDER BY cardinality(path) DESC))[1] AS root_session_id,
      (array_agg(id ORDER BY cardinality(path)) FILTER (WHERE cardinality(path)=2))[1] AS parent_session_id
    FROM ancestors GROUP BY origin`;
  return new Map(
    rows.map((row) => [
      row.origin,
      {
        parent_session_id: row.parent_session_id,
        root_session_id: row.root_session_id,
      },
    ]),
  );
}
/** The `sessions` columns in catalog order; the relatives query pads the read aggregates per branch. */
const AGGREGATE_COLUMNS: readonly string[] = sessionReadAggregateColumns;
const RELATIVE_COLUMNS = Object.keys(traceViewCatalog.sessions.columns).filter(
  (name) => !AGGREGATE_COLUMNS.includes(name),
);
/** Every `sessions` column from alias `s`; branches over `session_details` pad the aggregates with zero. */
function relativeSelect(aggregated: boolean): string {
  return [
    ...RELATIVE_COLUMNS.map(
      (name) => `s.${sqlIdentifier(name)} AS ${sqlIdentifier(name)}`,
    ),
    ...AGGREGATE_COLUMNS.map(
      (name) =>
        `${aggregated ? `s.${sqlIdentifier(name)}` : "toUInt64(0)"} AS ${sqlIdentifier(name)}`,
    ),
  ].join(",");
}
/**
 * One ClickHouse query for a batch of sessions: the `sessions` rows of `self` (a get reads
 * its header and its visibility answer in the same scan), the parent rows and up to ten
 * children per session from `session_details`. Each branch names its relation.
 */
async function sessionRelatives(
  client: TraceQueryClient,
  scope: {
    self: readonly string[];
    parents: readonly string[];
    ids: readonly string[];
  },
) {
  const branches = [
    ...(scope.self.length
      ? [
          `SELECT 'self' AS relation,${relativeSelect(true)} FROM api_ro.sessions s WHERE s.session_id IN {self:Array(UUID)}`,
        ]
      : []),
    ...(scope.parents.length
      ? [
          `SELECT 'parent' AS relation,${relativeSelect(false)} FROM api_ro.session_details s WHERE s.session_id IN {parents:Array(UUID)}`,
        ]
      : []),
    `SELECT 'child' AS relation,${relativeSelect(false)} FROM (SELECT * FROM api_ro.session_details WHERE parent_session_id IN {ids:Array(UUID)} ORDER BY started_at,session_id LIMIT 10 BY parent_session_id) s`,
  ];
  const result = await client.query(branches.join(" UNION ALL "), {
    self: [...scope.self],
    parents: [...scope.parents],
    ids: [...scope.ids],
  });
  const self = new Map<string, Record<string, unknown>>();
  const parents = new Map<unknown, Record<string, unknown>>();
  const children = new Map<unknown, Record<string, unknown>[]>();
  for (const row of result.rows) {
    if (row.relation === "self") self.set(String(row.session_id), row);
    else if (row.relation === "parent") parents.set(row.session_id, row);
    else {
      const siblings = children.get(row.parent_session_id) ?? [];
      siblings.push(row);
      children.set(row.parent_session_id, siblings);
    }
  }
  return { self, parents, children };
}
type Relatives = Awaited<ReturnType<typeof sessionRelatives>>;
function sessionRef(value: Record<string, unknown>) {
  return {
    session_id: value.session_id,
    title: value.title,
    parent_relation: value.parent_relation,
    parent_tool_use_id: value.parent_tool_use_id,
    agent_type: value.agent_type,
  };
}
function assembleHeader(
  row: Record<string, unknown>,
  relatives: Relatives,
  links: ReadonlyMap<string, SessionLinks>,
): SessionHeader {
  const header: Record<string, unknown> = pickSchema(
    wireRow(row),
    sessionHeaderSchema,
  );
  for (const key of [
    "file_count",
    "observed_commit_count",
    "observed_branch_count",
    ...AGGREGATE_COLUMNS,
    "child_count",
  ])
    header[key] = Number(row[key]);
  const parent = relatives.parents.get(row.parent_session_id);
  const children = (relatives.children.get(row.session_id) ?? []).slice(0, 10);
  header.parent = parent ? sessionRef(parent) : null;
  header.children = children.map(sessionRef);
  header.root_session_id =
    links.get(String(row.session_id))?.root_session_id ?? row.session_id;
  header.children_truncated = Number(row.child_count) > children.length;
  header.truncated_fields = [];
  return boundedHeader(sessionHeaderSchema.parse(header));
}
/**
 * The header of one session by id: its `sessions` row, parent and children in one
 * ClickHouse query (404 when the row is not caller-visible), with its links from control.
 */
export async function sessionHeaderById(
  client: TraceReadClient,
  caller: CallerContext,
  sessionId: string,
): Promise<SessionHeader> {
  const links = await sessionLinks(client.control, caller, [sessionId]);
  const parent = links.get(sessionId)?.parent_session_id ?? null;
  const relatives = await sessionRelatives(client, {
    self: [sessionId],
    parents: parent === null ? [] : [parent],
    ids: [sessionId],
  });
  const row = relatives.self.get(sessionId);
  if (!row) throw sessionNotFound();
  return assembleHeader(row, relatives, links);
}
/**
 * Headers for `sessions` rows already read: one ClickHouse query for every parent and
 * child reference of the batch and one control query for the links, run together.
 */
export async function sessionHeaders(
  client: TraceReadClient,
  caller: CallerContext,
  rows: Record<string, unknown>[],
): Promise<SessionHeader[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => String(row.session_id));
  const parents = rows.flatMap((row) =>
    typeof row.parent_session_id === "string" ? [row.parent_session_id] : [],
  );
  const [relatives, links] = await Promise.all([
    sessionRelatives(client, { self: [], parents, ids }),
    sessionLinks(client.control, caller, ids),
  ]);
  return rows.map((row) => assembleHeader(row, relatives, links));
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
    for (const field of [
      "models_used",
      "tools_used",
      "observed_branches",
    ] as const) {
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

/**
 * Graph traversal uses only compact control; visible presentation comes from ClickHouse.
 * The requested session rides along in the one `session_details` scan, so its visibility
 * answer (404) needs no scan of its own.
 */
export async function sessionTreePage(
  client: TraceReadClient,
  caller: CallerContext,
  sessionId: string,
  after: { time: string; id: string } | null,
  limit: number,
) {
  const visible = visibleControlSql(caller);
  const graph = await client.control.$queryRaw<
    { session_id: string; parent_session_id: string | null; gap: boolean }[]
  >`
    WITH RECURSIVE ancestors AS (
      SELECT id,parent_session_id,ARRAY[id] path FROM public.trace_session_control
      WHERE organization_id=${caller.organizationId} AND id=${sessionId}::uuid
      UNION ALL SELECT s.id,s.parent_session_id,a.path||s.id FROM public.trace_session_control s JOIN ancestors a ON s.id=a.parent_session_id
      WHERE s.organization_id=${caller.organizationId} AND NOT s.id=ANY(a.path)
    ), root AS (SELECT id FROM ancestors ORDER BY cardinality(path) DESC LIMIT 1), descendants AS (
      SELECT s.id,ARRAY[s.id] path,NULL::uuid visible_parent_id,false gap,${visible} visible
      FROM public.trace_session_control s JOIN root r ON s.id=r.id WHERE s.organization_id=${caller.organizationId}
      UNION ALL SELECT s.id,d.path||s.id,CASE WHEN d.visible THEN d.id ELSE d.visible_parent_id END,NOT d.visible,${visible} visible
      FROM public.trace_session_control s JOIN descendants d ON s.parent_session_id=d.id WHERE s.organization_id=${caller.organizationId} AND NOT s.id=ANY(d.path)
    ) SELECT s.id session_id,d.visible_parent_id parent_session_id,d.gap FROM descendants d
    JOIN public.trace_session_control s ON s.id=d.id AND s.organization_id=${caller.organizationId}
    WHERE d.visible AND (${after?.time ?? null}::timestamptz IS NULL OR (s.started_at,s.id)>(${after?.time ?? null}::timestamptz,${after?.id ?? null}::uuid))
    ORDER BY s.started_at,s.id LIMIT ${limit + 1}`;
  const result = await client.query(
    `SELECT session_id,title,harness,agent_type,parent_relation,parent_tool_use_id,user_email,started_at,status,message_count FROM api_ro.session_details WHERE session_id IN {ids:Array(UUID)}`,
    { ids: [...new Set([sessionId, ...graph.map((row) => row.session_id)])] },
  );
  const byId = new Map(result.rows.map((row) => [String(row.session_id), row]));
  if (!byId.has(sessionId)) throw sessionNotFound();
  // PostgreSQL and ClickHouse order UUIDs differently. Keep the graph's keyset order.
  return graph.flatMap((node) => {
    const row = byId.get(node.session_id);
    return row ? [{ ...row, ...node }] : [];
  });
}

/** The edge columns one peer row carries besides its two titles. */
const reuseEdgeColumns =
  "e.source_session_id,e.target_session_id,e.reader_user_id,e.reader_email,e.reader_harness,e.audit_id,e.read_at";
/**
 * Titles for both ends of every edge in the CTE named peers from one pass over
 * `session_details`: each edge unfolds into its two ends, joins the titles once and folds
 * back; an edge keeps only when both ends are caller-visible, as the former two inner joins
 * required.
 */
const reuseTitlesSql = `SELECT session_id,title FROM api_ro.session_details WHERE session_id IN (SELECT arrayJoin([source_session_id,target_session_id]) FROM peers)`;
const reuseEdgeSelectSql = `SELECT ${reuseEdgeColumns},anyIf(t.title,e.side='source') AS source_title,anyIf(t.title,e.side='target') AS target_title
  FROM (SELECT e.*,arrayJoin([('source',e.source_session_id),('target',e.target_session_id)]) AS pair,pair.1 AS side,pair.2 AS side_session_id FROM peers e) e
  JOIN titles t ON t.session_id=e.side_session_id
  GROUP BY ${reuseEdgeColumns} HAVING count()=2`;
function reuseEdge(row: Record<string, unknown>) {
  return reuseEdgeSchema.parse(
    compactMetadata(wireRow(row), [
      "source_title",
      "target_title",
      "reader_email",
    ]),
  );
}

/**
 * Latest edge per visible peer pair, with a bounded, deletion-safe keyset. The snapshot
 * time `asOf` bounds the edges; a first page passes null and reads the database clock
 * back with its rows (`asOf` of each row) for the cursor, so no separate clock query runs.
 */
export async function reuseEdgePage(
  client: TraceQueryClient,
  options: {
    scope:
      | { sessionId: string; direction: "by" | "from" }
      | { home: "reused" | "inbound" | "outbound"; userId: string };
    asOf: string | null;
    sort: ReuseSort;
    order: "asc" | "desc";
    readerUserId?: string | undefined;
    after: ReusePagePosition | null;
    limit: number;
  },
) {
  const params = new Parameters();
  const asOf =
    options.asOf === null
      ? "now64(6,'UTC')"
      : params.add(options.asOf, "DateTime64(6, 'UTC')");
  const predicates = [`e.read_at<=${asOf}`];
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
      predicates.push(`e.read_at>=toStartOfWeek(${asOf},1,'UTC')`);
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
      checkpoint = `(sort_value IS NULL OR sort_value${options.order === "asc" ? ">" : "<"}${value} OR (sort_value=${value} AND ${ties}))`;
    }
  }
  const result = await client.query(
    `WITH peers AS (
      SELECT e.*
      FROM api_ro.reuse_edges e
      WHERE ${predicates.join(" AND ")}
      ORDER BY e.read_at DESC,e.audit_id DESC LIMIT 1 BY e.source_session_id,e.target_session_id
    ), titles AS (${reuseTitlesSql}), selected AS (${reuseEdgeSelectSql}), sorted AS (SELECT selected.*,${sortExpression} AS sort_value,${asOf} AS as_of FROM selected)
    SELECT * FROM sorted WHERE ${checkpoint}
    ORDER BY sort_value ${options.order} NULLS LAST,source_session_id,target_session_id LIMIT ${params.add(options.limit)}`,
    params.values,
  );
  return result.rows.map(({ sort_value, as_of, ...row }) => ({
    item: reuseEdge(row),
    position: reusePagePositionSchema.parse({
      value: options.sort === "read_at" ? row.read_at : sort_value,
      source_session_id: row.source_session_id,
      target_session_id: row.target_session_id,
    }),
    asOf: String(as_of),
  }));
}
