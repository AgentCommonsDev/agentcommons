import type { PoolClient } from "pg";
import { hasAdminAuthority, type PrismaClient } from "@agentcommons/db";
import {
  sessionHeaderSchema,
  type CallerContext,
  type SearchFilters,
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
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${String(this.values.length)}`;
  }
}
function array<T>(value: T | readonly T[]): readonly T[] {
  return Array.isArray(value) ? value : [value as T];
}
export async function filterSql(
  client: PoolClient,
  filters: SearchFilters,
  params: Parameters,
): Promise<string> {
  const conditions: string[] = [];
  if (filters.repo_name !== undefined) {
    const names: string[] = [];
    for (const repo of array(filters.repo_name)) {
      if (repo.includes("/")) {
        names.push(repo);
        continue;
      }
      const matches = await client.query<{ repo_name: string }>(
        "SELECT repo_name FROM api_ro.repos WHERE regexp_replace(repo_name, '^.*/', '') = $1",
        [repo],
      );
      if (matches.rows.length > 1)
        throw new ServiceError(
          400,
          "AMBIGUOUS_REPO",
          "This repository name matches several repositories. Use its full host/organization/repository name.",
        );
      names.push(matches.rows[0]?.repo_name ?? repo);
    }
    conditions.push(`s.repo_name = ANY(${params.add(names)}::text[])`);
  }
  for (const key of ["branch", "user_email", "session_id"] as const) {
    const value = filters[key];
    if (value !== undefined)
      conditions.push(
        `s.${key} = ANY(${params.add(array(value))}::${key === "session_id" ? "uuid" : "text"}[])`,
      );
  }
  for (const key of ["role", "tool_name"] as const) {
    const value = filters[key];
    if (value !== undefined)
      conditions.push(
        `m.${key}::text = ANY(${params.add(array(value))}::text[])`,
      );
  }
  if (filters.file_prefix !== undefined)
    conditions.push(
      `EXISTS (SELECT 1 FROM api_ro.session_files f WHERE f.session_id = s.session_id AND EXISTS (SELECT 1 FROM unnest(${params.add(array(filters.file_prefix))}::text[]) prefix WHERE starts_with(f.path, prefix)))`,
    );
  if (filters.since !== undefined)
    conditions.push(
      `coalesce(m.timestamp,m.received_at) >= ANY(${params.add(array(filters.since))}::timestamptz[])`,
    );
  if (filters.until !== undefined)
    conditions.push(
      `coalesce(m.timestamp,m.received_at) < ANY(${params.add(array(filters.until))}::timestamptz[])`,
    );
  return conditions.length ? conditions.join(" AND ") : "true";
}

export async function visibleSession(
  client: PoolClient,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const result = await client.query<Record<string, unknown>>(
    "SELECT * FROM api_ro.sessions WHERE session_id=$1::uuid",
    [sessionId],
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
const refSql = "session_id,title,parent_relation,agent_type";
export async function sessionHeader(
  client: PoolClient,
  row: Record<string, unknown>,
): Promise<SessionHeader> {
  const sessionId = String(row.session_id);
  const relatives = await client.query<Record<string, unknown>>(
    `(SELECT ${refSql}, parent_session_id FROM api_ro.sessions WHERE session_id=$1::uuid) UNION ALL (SELECT ${refSql}, parent_session_id FROM api_ro.sessions WHERE parent_session_id=$2::uuid ORDER BY started_at,session_id LIMIT 10)`,
    [row.parent_session_id, sessionId],
  );
  const root = await client.query<{ session_id: string }>(
    `WITH RECURSIVE ancestors AS (
    SELECT session_id,parent_session_id,ARRAY[session_id] path FROM api_ro.sessions WHERE session_id=$1::uuid
    UNION ALL SELECT s.session_id,s.parent_session_id,a.path||s.session_id FROM api_ro.sessions s JOIN ancestors a ON s.session_id=a.parent_session_id WHERE NOT s.session_id=ANY(a.path)
  ) SELECT session_id FROM ancestors ORDER BY cardinality(path) DESC LIMIT 1`,
    [sessionId],
  );
  const ref = (value: Record<string, unknown>) => ({
    session_id: value.session_id,
    title: value.title,
    parent_relation: value.parent_relation,
    agent_type: value.agent_type,
  });
  const header: Record<string, unknown> = {};
  const wire = wireRow(row);
  for (const key of Object.keys(sessionHeaderSchema.shape))
    if (key in wire) header[key] = wire[key];
  header.file_count = Number(row.file_count);
  header.observed_commit_count = Number(row.observed_commit_count);
  header.reuse_count = Number(row.reuse_count);
  header.parent = relatives.rows.find(
    (relative) => relative.session_id === row.parent_session_id,
  );
  header.parent = header.parent
    ? ref(header.parent as Record<string, unknown>)
    : null;
  header.children = relatives.rows
    .filter((relative) => relative.parent_session_id === sessionId)
    .map(ref);
  header.root_session_id = root.rows[0]?.session_id ?? sessionId;
  header.child_count = Number(row.child_count);
  header.children_truncated =
    Number(row.child_count) > (header.children as unknown[]).length;
  header.truncated_fields = [];
  return boundedHeader(sessionHeaderSchema.parse(header));
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

/** Prisma paths use the same tenant and effective visibility rule as the reader views. */
function visibleSessionWhere(caller: CallerContext, sessionId: string) {
  return {
    id: sessionId,
    organizationId: caller.organizationId,
    ...(hasAdminAuthority(caller)
      ? {}
      : { visibility: "PUBLIC" as const, purgedAt: null }),
  };
}
export async function rawRecords(
  prisma: PrismaClient,
  caller: CallerContext,
  sessionId: string,
  after: {
    pos: string;
    sourceVersion: number;
    id: string;
    offset: number;
  } | null,
  limit: number,
) {
  const session = await prisma.agentSession.findFirst({
    where: visibleSessionWhere(caller, sessionId),
    select: { id: true },
  });
  if (!session)
    throw new ServiceError(
      404,
      "SESSION_NOT_FOUND",
      "This session is not available.",
    );
  return prisma.rawRecord.findMany({
    where: {
      organizationId: caller.organizationId,
      sessionId,
      session: visibleSessionWhere(caller, sessionId),
      ...(after
        ? {
            OR: [
              { pos: { gt: BigInt(after.pos) } },
              {
                pos: BigInt(after.pos),
                sourceVersion: { gt: after.sourceVersion },
              },
              {
                pos: BigInt(after.pos),
                sourceVersion: after.sourceVersion,
                id: after.offset > 0 ? { gte: after.id } : { gt: after.id },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ pos: "asc" }, { sourceVersion: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
}

export function sessionTreePage(
  prisma: PrismaClient,
  caller: CallerContext,
  sessionId: string,
  after: { time: string; id: string } | null,
  limit: number,
) {
  const admin = hasAdminAuthority(caller);
  return prisma.$queryRaw<Record<string, unknown>[]>`
    WITH RECURSIVE ancestors AS (
      SELECT id,parent_session_id,ARRAY[id] path FROM public.agent_session
      WHERE organization_id=${caller.organizationId} AND id=${sessionId}::uuid
      UNION ALL SELECT s.id,s.parent_session_id,a.path||s.id FROM public.agent_session s
      JOIN ancestors a ON s.id=a.parent_session_id
      WHERE s.organization_id=${caller.organizationId} AND NOT s.id=ANY(a.path)
    ), root AS (SELECT id FROM ancestors ORDER BY cardinality(path) DESC LIMIT 1), descendants AS (
      SELECT s.id,ARRAY[s.id] path,NULL::uuid visible_parent_id,false gap,
        ((s.visibility='PUBLIC' AND s.purged_at IS NULL) OR ${admin}) visible
      FROM public.agent_session s JOIN root r ON s.id=r.id WHERE s.organization_id=${caller.organizationId}
      UNION ALL SELECT s.id,d.path||s.id,CASE WHEN d.visible THEN d.id ELSE d.visible_parent_id END,NOT d.visible,
        ((s.visibility='PUBLIC' AND s.purged_at IS NULL) OR ${admin}) visible
      FROM public.agent_session s JOIN descendants d ON s.parent_session_id=d.id
      WHERE s.organization_id=${caller.organizationId} AND NOT s.id=ANY(d.path)
    ) SELECT s.id session_id,s.title,s.harness,s.agent_type,s.parent_relation,d.visible_parent_id parent_session_id,
      u.email user_email,to_char(s.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') started_at,s.status,s.message_count,d.gap
    FROM descendants d JOIN public.agent_session s ON s.id=d.id AND s.organization_id=${caller.organizationId}
    JOIN public."user" u ON u.id=s.user_id
    WHERE d.visible AND (${after?.time ?? null}::timestamptz IS NULL OR (s.started_at,s.id)>(${after?.time ?? null}::timestamptz,${after?.id ?? null}::uuid))
    ORDER BY s.started_at,s.id LIMIT ${limit + 1}`;
}

/** Shared projection for a caller-visible, filtered edge CTE named peers. */
const reuseEdgeSelectSql = `SELECT e.source_session_id,e.target_session_id,s.title AS source_title,t.title AS target_title,
  e.reader_user_id,e.reader_email,e.reader_harness,e.audit_id,
  to_char(e.read_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS read_at
FROM peers e JOIN api_ro.sessions s ON s.session_id=e.source_session_id
JOIN api_ro.sessions t ON t.session_id=e.target_session_id`;
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
  client: PoolClient,
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
  const predicates = [`e.read_at<=${params.add(options.asOf)}::timestamptz`];
  if ("sessionId" in options.scope) {
    const column = { by: "target_session_id", from: "source_session_id" }[
      options.scope.direction
    ];
    predicates.push(`e.${column}=${params.add(options.scope.sessionId)}::uuid`);
  } else {
    const owner = { reused: null, inbound: "target", outbound: "source" }[
      options.scope.home
    ];
    if (owner)
      predicates.push(`${owner}.user_id=${params.add(options.scope.userId)}`);
    if (options.scope.home === "reused")
      predicates.push(
        `e.read_at>=date_trunc('week',${params.add(options.asOf)}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      );
  }
  if (options.readerUserId !== undefined)
    predicates.push(`e.reader_user_id=${params.add(options.readerUserId)}`);
  const sortExpression =
    options.sort === "read_at"
      ? "read_at::timestamptz"
      : `left(${options.sort},256) COLLATE "C"`;
  const after = options.after;
  let checkpoint = "true";
  if (after) {
    const ties = `(source_session_id,target_session_id)>(${params.add(after.source_session_id)}::uuid,${params.add(after.target_session_id)}::uuid)`;
    if (after.value === null) checkpoint = `sort_value IS NULL AND ${ties}`;
    else {
      const value = params.add(after.value);
      const typed =
        options.sort === "read_at"
          ? `${value}::timestamptz`
          : `${value}::text COLLATE "C"`;
      checkpoint = `(sort_value IS NULL OR sort_value${options.order === "asc" ? ">" : "<"}${typed} OR (sort_value=${typed} AND ${ties}))`;
    }
  }
  const result = await client.query<Record<string, unknown>>(
    `WITH peers AS (
      SELECT DISTINCT ON(e.source_session_id,e.target_session_id) e.*
      FROM api_ro.reuse_edges e JOIN api_ro.sessions source ON source.session_id=e.source_session_id
      JOIN api_ro.sessions target ON target.session_id=e.target_session_id
      WHERE ${predicates.join(" AND ")}
      ORDER BY e.source_session_id,e.target_session_id,e.read_at DESC,e.audit_id DESC
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
