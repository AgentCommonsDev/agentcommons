import { createHash } from "node:crypto";
import {
  utf8Slice,
  truncateUtf8,
  getInputSchema,
  getOutputSchema,
  messageSchema,
  paginationSchema,
  rawOutputSchema,
  sessionsInputSchema,
  sessionsOutputSchema,
  treeOutputSchema,
  treeInputSchema,
  schemaOutputSchema,
  reposOutputSchema,
  installationsOutputSchema,
  installationsInputSchema,
  reposInputSchema,
  sessionReuseInputSchema,
  sessionReuseOutputSchema,
  reusePagePositionSchema,
  sessionIdSchema,
  searchConditionFields,
  type GetOutput,
  type Message,
} from "@agentcommons/core";
import { formatGet, messageContent } from "@agentcommons/core/format";
import { hasAdminAuthority } from "@agentcommons/db";
import { z } from "zod";
import {
  Parameters,
  filterSql,
  rawRecords,
  sessionHeader,
  sessionHeaders,
  traceJson,
  visibleSession,
  sessionTreePage,
  reuseEdgePage,
} from "../repositories/read-model.js";
import {
  messagePayloadBatches,
  readMessagePayloads,
} from "../repositories/message-payload.js";
import { ServiceError, type ServiceContext } from "./context.js";
import {
  boundedPage,
  bytes,
  compactMetadata,
  wireRow,
  wireValue,
} from "./read-budget.js";
import { readOperation, type ReadDependencies } from "./read-operation.js";

const pagePosition = z.strictObject({ offset: z.number().int().nonnegative() });
const rawPosition = z.strictObject({
  pos: z.string().regex(/^\d+$/),
  sourceVersion: z.number().int().nonnegative(),
  id: z.uuid(),
  offset: z.number().int().nonnegative(),
  digest: z.string().nullable(),
});
const treePosition = z.strictObject({ time: z.iso.datetime(), id: z.uuid() });
const reusePosition = reusePagePositionSchema.extend({
  asOf: z.iso.datetime(),
});
function getFits(output: GetOutput): boolean {
  return (
    bytes(output) <= 32768 && Buffer.byteLength(formatGet(output).text) <= 32768
  );
}
function content(row: Record<string, unknown>): string {
  return messageContent(
    String(row.content),
    String(row.kind),
    row.tool_input === undefined ? undefined : traceJson(row.tool_input),
  );
}
export class SessionService {
  constructor(private readonly dependencies: ReadDependencies) {}

  reuse(context: ServiceContext, sessionId: string, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "sessions.reuse",
        resourceType: "session",
        resourceIds: [sessionId],
        detail: input ?? null,
      },
      async (caller) => {
        const id = sessionIdSchema.parse(sessionId);
        const request = sessionReuseInputSchema.parse(input);
        const binding = wireValue({
          operation: "sessions.reuse",
          organization: caller.organizationId,
          admin: hasAdminAuthority(caller),
          session_id: id,
          ...request,
          cursor: null,
        });
        const position = request.cursor
          ? this.dependencies.cursors.decode(
              request.cursor,
              binding,
              reusePosition,
            )
          : null;
        return this.dependencies.readers.read(caller, async (client) => {
          await visibleSession(client, id);
          const clock =
            position?.asOf ??
            (
              await client.query<{ time: string }>(
                "SELECT now64(6, 'UTC') AS time",
              )
            ).rows[0]?.time;
          if (!clock)
            throw new Error("The reuse snapshot time is unavailable.");
          const rows = await reuseEdgePage(client, {
            scope: { sessionId: id, direction: request.direction },
            asOf: clock,
            sort: request.sort ?? "read_at",
            order: request.order,
            readerUserId: request.reader_user_id,
            after: position,
            limit: request.limit + 1,
          });
          const items = rows.slice(0, request.limit).map((row) => row.item);
          return sessionReuseOutputSchema.parse(
            boundedPage(items, rows.length > request.limit, (_last, count) =>
              this.dependencies.cursors.encode(binding, {
                asOf: clock,
                ...rows[count - 1]?.position,
              }),
            ),
          );
        });
      },
      (result) => ({ session_id: sessionId, peers: result.items.length }),
    );
  }

  get(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "get", resourceType: "session", detail: input ?? null },
      async (caller) => {
        const request = getInputSchema.parse(input);
        return this.dependencies.readers.read(caller, async (client) => {
          const row = await visibleSession(
            client,
            request.session_id,
            "header",
          );
          const header = await sessionHeader(client, row);
          const output: GetOutput = { header, messages: [], next: null };
          if (!getFits(output))
            throw new ServiceError(
              413,
              "SESSION_HEADER_TOO_LARGE",
              "The session header exceeds the response limit. Use SQL to select the fields you need.",
            );
          const metadataColumns = Object.keys(messageSchema.shape)
            .filter(
              (key) =>
                !["content", "content_cursor", "truncated_fields"].includes(
                  key,
                ),
            )
            .join(",");
          const rows = await client.query(
            `SELECT ${metadataColumns},payload_bytes FROM api_ro.message_metadata WHERE session_id={id:UUID} AND seq >= {first:UInt32} AND ({last:Nullable(UInt32)} IS NULL OR seq <= {last:Nullable(UInt32)}) ORDER BY seq LIMIT 101`,
            {
              id: request.session_id,
              first: request.cursor?.seq ?? request.from ?? 0,
              last: request.to ?? null,
            },
          );
          // Fetch only a prefix that can contribute to this bounded page. One large
          // first message remains readable through the existing lossless byte cursor.
          const firstBatch = messagePayloadBatches(
            rows.rows.slice(0, 100),
            32768,
          ).next();
          const batch = firstBatch.done ? [] : firstBatch.value;
          const payloads = await readMessagePayloads(client, batch);
          const byId = new Map(
            payloads.map((value) => [value.message_id, value]),
          );
          for (const metadata of batch)
            Object.assign(metadata, byId.get(metadata.message_id));
          if (
            request.cursor &&
            (!rows.rows[0] || rows.rows[0].seq !== request.cursor.seq)
          )
            throw new ServiceError(
              400,
              "INVALID_CURSOR",
              "The cursor does not identify a message in this range.",
            );
          for (let index = 0; index < batch.length; index++) {
            const message = rows.rows[index];
            if (!message) continue;
            const seq = Number(message.seq);
            const offset = index === 0 ? (request.cursor?.offset ?? 0) : 0;
            const full = content(message);
            if (offset > Buffer.byteLength(full))
              throw new ServiceError(
                400,
                "INVALID_CURSOR",
                "The content cursor is beyond the end of this message.",
              );
            const wire = wireRow(message);
            const metadata: Record<string, unknown> = {};
            for (const key of Object.keys(messageSchema.shape))
              if (key in wire) metadata[key] = wire[key];
            const fields = compactMetadata(metadata, [
              "tool_name",
              "tool_use_id",
              "model",
              "agent_id",
            ]);
            let item: Message | null = null;
            // JSON escaping and the header affect the remaining byte budget. Reduce the
            // content slice until both representations fit, preserving character boundaries.
            for (
              let budget = Math.min(4096, Buffer.byteLength(full) - offset);
              budget >= 0;
              budget = budget === 0 ? -1 : Math.max(0, budget - 256)
            ) {
              let slice;
              try {
                slice = utf8Slice(full, offset, budget);
              } catch {
                throw new ServiceError(
                  400,
                  "INVALID_CURSOR",
                  "The content cursor must fall on a UTF-8 character boundary within this message.",
                );
              }
              const remainder =
                slice.nextOffset !== null
                  ? { seq, offset: slice.nextOffset }
                  : null;
              if (remainder && slice.nextOffset === offset) continue;
              const candidate = messageSchema.parse({
                ...fields,
                content: slice.content,
                content_cursor: remainder,
              });
              const next =
                remainder ??
                (rows.rows[index + 1]
                  ? { seq: Number(rows.rows[index + 1]?.seq), offset: 0 }
                  : null);
              if (
                getFits({
                  header,
                  messages: [...output.messages, candidate],
                  next,
                })
              ) {
                item = candidate;
                output.next = next;
                break;
              }
            }
            if (!item) {
              if (!output.messages.length)
                throw new ServiceError(
                  413,
                  "MESSAGE_METADATA_TOO_LARGE",
                  "The message metadata exceeds the response limit. Use SQL to select the fields you need.",
                );
              output.next = { seq, offset };
              break;
            }
            output.messages.push(item);
            if (item.content_cursor) break;
          }
          return getOutputSchema.parse(output);
        });
      },
      (result) => ({
        session_id: result.header.session_id,
        message_count: result.messages.length,
        next: result.next,
      }),
      "read",
      (result) => [result.header.session_id],
    );
  }

  list(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "sessions.list",
        resourceType: "session",
        detail: input ?? null,
      },
      async (caller) => {
        const request = sessionsInputSchema.parse(input);
        const binding = wireValue({
          operation: "sessions.list",
          organization: caller.organizationId,
          admin: hasAdminAuthority(caller),
          ...request,
          cursor: null,
        });
        const offset = request.cursor
          ? this.dependencies.cursors.decode(
              request.cursor,
              binding,
              pagePosition,
            ).offset
          : 0;
        return this.dependencies.readers.read(caller, async (client) => {
          const params = new Parameters();
          const conditions = await filterSql(client, request.filters, params);
          const sort = request.sort ?? "started_at";
          const messageFilter =
            [
              request.filters.role,
              request.filters.tool_name,
              request.filters.since,
              request.filters.until,
            ].some((value) => value !== undefined) ||
            request.filters.where?.some(
              (condition) =>
                searchConditionFields[condition.field] === "message",
            );
          const predicate = messageFilter
            ? `s.session_id IN (SELECT m.session_id FROM api_ro.messages m JOIN api_ro.sessions s ON s.session_id=m.session_id WHERE ${conditions})`
            : conditions;
          const rows = await client.query(
            `SELECT s.* FROM api_ro.sessions s WHERE ${predicate} ORDER BY s.${sort} ${request.order} NULLS LAST,s.session_id LIMIT ${params.add(request.limit + 1)} OFFSET ${params.add(offset)}`,
            params.values,
          );
          const selected = rows.rows.slice(0, request.limit);
          const headers = await sessionHeaders(client, selected);
          const items = selected.map((row, index) => ({
            ...headers[index],
            duration_seconds:
              row.duration_seconds === null
                ? null
                : Number(row.duration_seconds),
            last_activity_at: wireValue(row.last_activity_at),
          }));
          return sessionsOutputSchema.parse(
            boundedPage(
              items,
              rows.rows.length > request.limit,
              (_last, count) =>
                this.dependencies.cursors.encode(binding, {
                  offset: offset + count,
                }),
            ),
          );
        });
      },
      (result) => ({ row_count: result.items.length }),
    );
  }

  raw(context: ServiceContext, sessionId: string, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "sessions.raw",
        resourceType: "session",
        detail: { session_id: sessionId, input: input ?? null },
      },
      async (caller) => {
        sessionIdSchema.parse(sessionId);
        const request = paginationSchema.parse(input);
        const binding = {
          operation: "sessions.raw",
          organization: caller.organizationId,
          admin: hasAdminAuthority(caller),
          session_id: sessionId,
          limit: request.limit,
        };
        const after = request.cursor
          ? this.dependencies.cursors.decode(
              request.cursor,
              binding,
              rawPosition,
            )
          : null;
        const rows = await this.dependencies.readers.read(caller, (client) =>
          rawRecords(client, sessionId, after, request.limit),
        );
        const items = [];
        let cursor: string | null = null;
        for (const [index, row] of rows.slice(0, request.limit).entries()) {
          const serialized = JSON.stringify(row.payload);
          const offset = index === 0 ? (after?.offset ?? 0) : 0;
          const digest = createHash("sha256").update(serialized).digest("hex");
          if (
            offset > 0 &&
            (after?.pos !== row.pos.toString() ||
              after.sourceVersion !== row.sourceVersion ||
              after.id !== row.id ||
              after.digest !== digest)
          )
            throw new ServiceError(
              400,
              "INVALID_CURSOR",
              "This raw record changed. Start from its first page.",
            );
          const fragment =
            offset > 0 || Buffer.byteLength(serialized) > 65536
              ? utf8Slice(serialized, offset, 65536)
              : null;
          const item = {
            id: row.id,
            session_id: row.sessionId,
            organization_id: row.organizationId,
            pos: row.pos.toString(),
            key: row.key,
            source_version: row.sourceVersion,
            record_type: row.recordType,
            payload: fragment ? fragment.content : row.payload,
            payload_fragment: fragment
              ? { offset, next_offset: fragment.nextOffset }
              : null,
            ingest_batch_id: row.ingestBatchId,
            received_at: row.receivedAt.toISOString(),
          };
          const next = fragment?.nextOffset;
          const hasMore =
            (next !== undefined && next !== null) || index + 1 < rows.length;
          const nextCursor = hasMore
            ? this.dependencies.cursors.encode(binding, {
                pos: row.pos.toString(),
                sourceVersion: row.sourceVersion,
                id: row.id,
                offset: next ?? 0,
                digest: next === undefined || next === null ? null : digest,
              })
            : null;
          items.push(item);
          if (bytes({ items, cursor: nextCursor }) > 256 * 1024) {
            items.pop();
            if (!items.length)
              throw new ServiceError(
                413,
                "RAW_METADATA_TOO_LARGE",
                "The raw record metadata exceeds the response limit.",
              );
            break;
          }
          cursor = nextCursor;
          if (next !== undefined && next !== null) break;
        }
        if (after && after.offset > 0 && !rows.length)
          throw new ServiceError(
            400,
            "INVALID_CURSOR",
            "This raw record changed. Start from its first page.",
          );
        return rawOutputSchema.parse({ items, cursor });
      },
      (result) => ({ row_count: result.items.length }),
    );
  }

  tree(context: ServiceContext, sessionId: string, input: unknown = {}) {
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "sessions.tree",
        resourceType: "session",
        resourceIds: [sessionId],
        detail: input ?? null,
      },
      async (caller) => {
        sessionIdSchema.parse(sessionId);
        const request = treeInputSchema.parse(input);
        const binding = {
          operation: "tree",
          organization: caller.organizationId,
          admin: hasAdminAuthority(caller),
          session_id: sessionId,
          limit: request.limit,
        };
        const after = request.cursor
          ? this.dependencies.cursors.decode(
              request.cursor,
              binding,
              treePosition,
            )
          : null;
        const rows = await this.dependencies.readers.read(
          caller,
          async (client) => {
            await visibleSession(client, sessionId);
            return sessionTreePage(
              client.control,
              client,
              caller,
              sessionId,
              after,
              request.limit,
            );
          },
        );
        const nodes = rows.slice(0, request.limit).map((row) => {
          const node = wireRow(row);
          const truncated: string[] = [];
          for (const field of ["title", "agent_type"] as const) {
            const value = node[field];
            if (typeof value === "string") {
              node[field] = truncateUtf8(value, 256);
              if (value !== node[field]) truncated.push(field);
            }
          }
          node.truncated_fields = truncated;
          return node;
        });
        const page = boundedPage(nodes, rows.length > request.limit, (last) =>
          this.dependencies.cursors.encode(binding, {
            time: last.started_at ?? null,
            id: last.session_id ?? null,
          }),
        );
        return treeOutputSchema.parse({
          nodes: page.items,
          cursor: page.cursor,
        });
      },
      (result) => ({ row_count: result.nodes.length }),
    );
  }

  schema(context: ServiceContext) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "schema", resourceType: "schema" },
      (caller) =>
        this.dependencies.readers.read(caller, async (client) => {
          const columns = await client.query(
            "SELECT * FROM api_ro.schema_columns ORDER BY view_name,ordinal_position",
          );
          const functions = await client.query(
            "SELECT * FROM api_ro.schema_functions ORDER BY function_name",
          );
          return schemaOutputSchema.parse({
            columns: columns.rows.map(wireRow),
            functions: functions.rows.map(wireRow),
          });
        }),
    );
  }

  repos(context: ServiceContext, input: unknown) {
    return this.catalog(context, input, "repos", reposOutputSchema);
  }
  installations(context: ServiceContext, input: unknown) {
    return this.catalog(
      context,
      input,
      "installations",
      installationsOutputSchema,
    );
  }
  private catalog<
    T extends z.ZodType<{ items: unknown[]; cursor: string | null }>,
  >(
    context: ServiceContext,
    input: unknown,
    view: "repos" | "installations",
    outputSchema: T,
  ) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: `${view}.list`, resourceType: view, detail: input ?? null },
      async (caller) => {
        const configuration = {
          repos: {
            input: reposInputSchema,
            defaultSort: "repo_name",
            tie: "repo_name",
          },
          installations: {
            input: installationsInputSchema,
            defaultSort: "hostname",
            tie: "installation_id",
          },
        }[view];
        const request = configuration.input.parse(input);
        const binding = wireValue({
          operation: view,
          organization: caller.organizationId,
          admin: hasAdminAuthority(caller),
          ...request,
          cursor: null,
        });
        const offset = request.cursor
          ? this.dependencies.cursors.decode(
              request.cursor,
              binding,
              pagePosition,
            ).offset
          : 0;
        return this.dependencies.readers.read(caller, async (client) => {
          const params = new Parameters();
          const predicates = Object.entries(request.filters)
            .filter(([, value]) => value !== undefined)
            .map(([field, value]) =>
              typeof value === "boolean"
                ? `${field}=${params.add(value)}`
                : `positionCaseInsensitiveUTF8(${field},${params.add(value ?? "")})>0`,
            );
          const rows = await client.query(
            `SELECT * FROM api_ro.${view} WHERE ${predicates.join(" AND ") || "true"} ORDER BY ${request.sort ?? configuration.defaultSort} ${request.order} NULLS LAST,${configuration.tie} LIMIT ${params.add(request.limit + 1)} OFFSET ${params.add(offset)}`,
            params.values,
          );
          const items = rows.rows.slice(0, request.limit).map((row) => {
            const wire = wireRow(row);
            wire.session_count = Number(row.session_count);
            if (view === "repos") {
              delete wire.organization_id;
              wire.user_count = Number(row.user_count);
            }
            return compactMetadata(wire, [
              "hostname",
              "os_user",
              "platform",
              "arch",
              "repo_name",
              "repo_url",
            ]);
          });
          const result = boundedPage(
            items,
            rows.rows.length > request.limit,
            (_last, count) =>
              this.dependencies.cursors.encode(binding, {
                offset: offset + count,
              }),
          );
          return outputSchema.parse(result);
        });
      },
      (result) => ({ row_count: result.items.length }),
    );
  }
}
