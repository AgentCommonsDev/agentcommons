import {
  utf8Slice,
  truncateUtf8,
  contentSliceBytes,
  decimalIntegerSchema,
  defaultMessageKinds,
  getInputSchema,
  getOutputSchema,
  jsonByteLength,
  messageKindSchema,
  messageRowSchema,
  messageSchema,
  paginationSchema,
  rawOutputSchema,
  responseBytes,
  sessionsInputSchema,
  sessionsOutputSchema,
  sessionsTotalSchema,
  sha256Hex,
  treeOutputSchema,
  schemaOutputSchema,
  reposOutputSchema,
  installationsOutputSchema,
  installationsInputSchema,
  reposInputSchema,
  sessionReuseInputSchema,
  sessionReuseOutputSchema,
  reusePagePositionSchema,
  sessionIdSchema,
  type ContentCursor,
  type GetOutput,
  type Message,
  type MessageRow,
  type SessionHeader,
} from "@agentcommons/core";
import {
  formatGet,
  formatMessage,
  formatSessionHeader,
  formatSessionLine,
} from "@agentcommons/core/format";
import { hasAdminAuthority } from "@agentcommons/db";
import { z } from "zod";
import {
  Parameters,
  andSql,
  filterSql,
  rawRecords,
  sessionHeaderById,
  sessionHeaders,
  visibleSession,
  sessionTreePage,
  reuseEdgePage,
} from "../repositories/read-model.js";
import {
  messagePayloadBatches,
  messageText,
  readMessagePayloads,
} from "../repositories/message-payload.js";
import { ServiceError, type ServiceContext } from "./context.js";
import {
  boundedPage,
  compactMetadata,
  fitsToolBudget,
  offsetPage,
  pickSchema,
  wireRow,
  wireValue,
} from "./read-budget.js";
import { readOperation, type ReadDependencies } from "./read-operation.js";

const rawPosition = z.strictObject({
  pos: decimalIntegerSchema,
  sourceVersion: z.number().int().nonnegative(),
  id: z.uuid(),
  offset: z.number().int().nonnegative(),
  digest: z.string().nullable(),
});
const treePosition = z.strictObject({ time: z.iso.datetime(), id: z.uuid() });
const reusePosition = reusePagePositionSchema.extend({
  asOf: z.iso.datetime(),
});
type GetInput = z.infer<typeof getInputSchema>;
/** The columns of the CSV export, in the order the message schema declares them. */
const MESSAGE_ROW_COLUMNS: readonly string[] = Object.keys(
  messageRowSchema.shape,
);
/** Metadata rows one 32 KB page considers; a larger `page_bytes` budget scales this in proportion. */
const MESSAGE_ROWS_PER_READ_BUDGET = 100;
/** Message columns read before payloads; content and its cursor come from the payload pass. */
const MESSAGE_METADATA_COLUMNS = Object.keys(messageSchema.shape)
  .filter(
    (key) => !["content", "content_cursor", "truncated_fields"].includes(key),
  )
  .join(",");
/** The two catalog views differ only in this data: input schema, ordering and numeric or omitted columns. */
interface CatalogView {
  input: typeof reposInputSchema | typeof installationsInputSchema;
  defaultSort: string;
  tie: string;
  numeric: readonly string[];
  omit: readonly string[];
}
const CATALOG_VIEWS: Record<"repos" | "installations", CatalogView> = {
  repos: {
    input: reposInputSchema,
    defaultSort: "repo_name",
    tie: "repo_name",
    numeric: ["session_count", "user_count"],
    omit: ["organization_id"],
  },
  installations: {
    input: installationsInputSchema,
    defaultSort: "hostname",
    tie: "installation_id",
    numeric: ["session_count"],
    omit: [],
  },
};
const CATALOG_TEXT_FIELDS = [
  "hostname",
  "os_user",
  "platform",
  "arch",
  "repo_name",
  "repo_url",
];

/**
 * Running JSON and text sizes of one get page, mirroring how `formatGet` joins the header,
 * messages and `next` with blank lines, so each candidate message costs one serialization
 * instead of re-rendering the whole page.
 */
class GetPageBudget {
  private json: number;
  private text: number;
  private count = 0;
  constructor(
    header: SessionHeader | null,
    private readonly limit: number,
    continuation: boolean,
  ) {
    this.json =
      jsonByteLength({ header, messages: [], next: null }) -
      jsonByteLength(null);
    this.text = header
      ? Buffer.byteLength(
          continuation
            ? formatSessionLine(header)
            : formatSessionHeader(header),
        )
      : 0;
  }
  private cost(message: Message) {
    return {
      json: jsonByteLength(message) + (this.count ? 1 : 0),
      text: 2 + Buffer.byteLength(formatMessage(message)),
    };
  }
  fits(message: Message, next: ContentCursor | null): boolean {
    const added = this.cost(message);
    const tail =
      next === null
        ? { json: jsonByteLength(null), text: 0 }
        : {
            json: jsonByteLength(next),
            text: 2 + Buffer.byteLength(`next: ${JSON.stringify(next)}`),
          };
    return (
      this.json + added.json + tail.json <= this.limit &&
      this.text + added.text + tail.text <= this.limit
    );
  }
  add(message: Message): void {
    const added = this.cost(message);
    this.json += added.json;
    this.text += added.text;
    this.count++;
  }
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
          // The visibility answer and the edge page are independent; the first page's
          // snapshot clock comes back with the edges instead of from a query of its own.
          const [rows] = await Promise.all([
            reuseEdgePage(client, {
              scope: { sessionId: id, direction: request.direction },
              asOf: position?.asOf ?? null,
              sort: request.sort ?? "read_at",
              order: request.order,
              readerUserId: request.reader_user_id,
              after: position,
              limit: request.limit + 1,
            }),
            visibleSession(client, id),
          ]);
          const items = rows.slice(0, request.limit).map((row) => row.item);
          return sessionReuseOutputSchema.parse(
            boundedPage(items, rows.length > request.limit, (_last, count) => {
              const last = rows[count - 1];
              if (!last)
                throw new Error("The reuse page position is unavailable.");
              return this.dependencies.cursors.encode(binding, {
                asOf: position?.asOf ?? last.asOf,
                ...last.position,
              });
            }),
          );
        });
      },
      {
        describeResult: (result) => ({
          session_id: sessionId,
          peers: result.items.length,
        }),
      },
    );
  }

  get(context: ServiceContext, input: unknown) {
    let sessionId: string | null = null;
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "get", resourceType: "session", detail: input ?? null },
      async (caller) => {
        const request = getInputSchema.parse(input);
        sessionId = request.session_id;
        return this.dependencies.readers.read(caller, async (client) => {
          // Metadata rows scale with the page budget: 100 for the 32 KB agent page, 800 for
          // the 256 KB dashboard page; one more row tells whether the range continues.
          const rowLimit = Math.round(
            (MESSAGE_ROWS_PER_READ_BUDGET * request.page_bytes) /
              responseBytes.read,
          );
          // The header is the expensive part of a read: the `sessions` row with its
          // relatives, one scan that also answers visibility. A caller that already holds
          // it (`header: false`) is checked against the light session state instead and
          // gets messages only. Either answer runs beside the metadata read; row policies
          // fence the metadata of a hidden session on their own.
          const [header, rows] = await Promise.all([
            request.header
              ? sessionHeaderById(client, caller, request.session_id)
              : visibleSession(client, request.session_id).then(() => null),
            client.query(
              `SELECT ${MESSAGE_METADATA_COLUMNS},payload_bytes FROM api_ro.message_metadata WHERE session_id={id:UUID} AND seq >= {first:UInt32} AND ({last:Nullable(UInt32)} IS NULL OR seq <= {last:Nullable(UInt32)}) AND kind IN {kinds:Array(String)} ORDER BY seq LIMIT {rows:UInt32}`,
              {
                id: request.session_id,
                first: request.cursor?.seq ?? request.from ?? 0,
                last: request.to ?? null,
                // The conversation by default; META housekeeping only when asked for (§7.3).
                kinds: request.kinds ?? defaultMessageKinds[request.format],
                rows: rowLimit + 1,
              },
            ),
          ]);
          const output: GetOutput = { header, messages: [], next: null };
          if (header && !fitsToolBudget(output, formatGet))
            throw new ServiceError(
              413,
              "SESSION_HEADER_TOO_LARGE",
              "The session header exceeds the response limit. Use SQL to select the fields you need.",
            );
          const budget = new GetPageBudget(
            header,
            request.page_bytes,
            request.cursor !== null && request.cursor !== undefined,
          );
          // Fetch only a prefix that can contribute to this bounded page. One large
          // first message remains readable through the existing lossless byte cursor.
          // A row costs the slice the page will carry, not its whole payload, so a page
          // of bounded previews reads every row it can show in one payload query.
          const firstBatch = messagePayloadBatches(
            rows.rows.slice(0, rowLimit),
            request.page_bytes,
            (row) =>
              Math.min(
                Number(row.payload_bytes),
                contentSliceBytes(
                  request.page_bytes,
                  messageKindSchema.parse(row.kind),
                ),
              ),
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
            const full = messageText(message);
            if (offset > Buffer.byteLength(full))
              throw new ServiceError(
                400,
                "INVALID_CURSOR",
                "The content cursor is beyond the end of this message.",
              );
            const fields = compactMetadata(
              pickSchema(wireRow(message), messageSchema),
              ["tool_name", "tool_use_id", "model", "agent_id"],
            );
            let item: Message | null = null;
            // JSON escaping and the header affect the remaining byte budget. Reduce the
            // content slice until both representations fit, preserving character boundaries.
            const sliceBytes = contentSliceBytes(
              request.page_bytes,
              messageKindSchema.parse(message.kind),
            );
            const step = Math.max(256, sliceBytes / 16);
            for (
              let size = Math.min(sliceBytes, Buffer.byteLength(full) - offset);
              size >= 0;
              size = size === 0 ? -1 : Math.max(0, size - step)
            ) {
              let slice;
              try {
                slice = utf8Slice(full, offset, size);
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
              // A bounded message does not end the page: the page goes on with the
              // following message and this one's rest waits behind its content_cursor.
              // Only the range's last message continues through `next`.
              const following = rows.rows[index + 1]
                ? { seq: Number(rows.rows[index + 1]?.seq), offset: 0 }
                : null;
              const next = following ?? remainder;
              if (budget.fits(candidate, next)) {
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
            budget.add(item);
          }
          return getOutputSchema.parse(output);
        });
      },
      {
        describeResult: (result) => ({
          session_id: sessionId,
          header: result.header !== null,
          message_count: result.messages.length,
          next: result.next,
        }),
        describeResources: () => (sessionId === null ? [] : [sessionId]),
      },
    );
  }

  /**
   * The CSV form of `get`: every message of the range as one row each, in seq order. The
   * pages a JSON reader would walk are read to the end under the same audit, budgets and
   * redaction, and the content slices of a message that spans pages are rejoined into its
   * row. Every page is the largest REST page, whatever `page_bytes` the caller passed: a
   * file has no reader-side page budget, and each page is a fenced read with its own
   * audit row, so fewer pages mean a shorter export. The first page is read before the
   * rows stream, so a caller who cannot read the session gets that error and no file;
   * later pages arrive as the consumer pulls rows.
   */
  async export(
    context: ServiceContext,
    input: unknown,
  ): Promise<{ columns: readonly string[]; rows: AsyncIterable<MessageRow> }> {
    const request: GetInput = {
      ...getInputSchema.parse(input),
      page_bytes: responseBytes.page,
    };
    const first = (await this.get(context, request)).result;
    return {
      columns: MESSAGE_ROW_COLUMNS,
      rows: this.exportRows(context, request, first),
    };
  }
  private async *exportRows(
    context: ServiceContext,
    request: GetInput,
    first: GetOutput,
  ): AsyncGenerator<MessageRow> {
    let page = first;
    let row: MessageRow | null = null;
    let slices: string[] = [];
    for (;;) {
      for (const message of page.messages) {
        if (row && row.seq === message.seq) {
          slices.push(message.content);
          continue;
        }
        if (row) yield { ...row, content: slices.join("") };
        row = messageRowSchema.parse(
          pickSchema(wireRow(message), messageRowSchema),
        );
        slices = [message.content];
        // A bounded message the page moved past keeps its rest behind content_cursor;
        // the page's own `next` continues only the range's last one.
        if (
          message.content_cursor &&
          !(
            page.next?.seq === message.content_cursor.seq &&
            page.next.offset === message.content_cursor.offset
          )
        )
          for await (const slice of this.rest(
            context,
            request,
            message.content_cursor,
          ))
            slices.push(slice);
      }
      if (page.next === null) break;
      // The first page carried the header and the visibility answer; later pages read
      // messages only.
      page = (
        await this.get(context, {
          ...request,
          cursor: page.next,
          header: false,
        })
      ).result;
    }
    if (row) yield { ...row, content: slices.join("") };
  }
  /** The rest of one bounded message, slice by slice, under the same audit and visibility. */
  private async *rest(
    context: ServiceContext,
    request: GetInput,
    cursor: ContentCursor,
  ): AsyncGenerator<string> {
    let position: ContentCursor | null = cursor;
    while (position !== null) {
      const page: GetOutput = (
        await this.get(context, {
          ...request,
          from: cursor.seq,
          to: cursor.seq,
          cursor: position,
          header: false,
        })
      ).result;
      for (const slice of page.messages) yield slice.content;
      position = page.next;
    }
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
        let total: z.infer<typeof sessionsTotalSchema> | undefined;
        const page = await offsetPage(
          this.dependencies.cursors,
          binding,
          request.cursor,
          request.limit,
          (offset, take) =>
            this.dependencies.readers.read(caller, async (client) => {
              const params = new Parameters();
              const plan = await filterSql(client, request.filters, params);
              const sort = request.sort ?? "started_at";
              // Message predicates narrow the sessions through the lightest message
              // relation that serves them; session predicates stay on the page's own scan.
              // parent_session_id is the caller-visible parent, so a child of a hidden
              // session lists as a root.
              const predicate = andSql([
                ...plan.session,
                ...(plan.message.length
                  ? [
                      `s.session_id IN (SELECT m.session_id FROM api_ro.${plan.messageView} m WHERE ${andSql(plan.message)})`,
                    ]
                  : []),
                ...(request.roots_only ? ["s.parent_session_id IS NULL"] : []),
              ]);
              // The totals are window aggregates of the page's own scan: the same
              // predicate, fence and row policies, evaluated before the window is cut.
              const totalParameters = { ...params.values };
              const rows = await client.query(
                `SELECT s.*,count() OVER () AS total_sessions,sum(s.message_count) OVER () AS total_messages FROM api_ro.sessions s WHERE ${predicate} ORDER BY s.${sort} ${request.order} NULLS LAST,s.session_id LIMIT ${params.add(take)} OFFSET ${params.add(offset)}`,
                params.values,
              );
              const first = rows.rows[0];
              // A window past the last row carries no aggregate; only then is a count of
              // the predicate (with no window) needed to state the totals.
              const counts = first
                ? {
                    sessions: first.total_sessions,
                    messages: first.total_messages,
                  }
                : offset === 0
                  ? { sessions: 0, messages: 0 }
                  : (
                      await client.query(
                        `SELECT count() AS sessions,sum(s.message_count) AS messages FROM api_ro.sessions s WHERE ${predicate}`,
                        totalParameters,
                      )
                    ).rows[0];
              total = sessionsTotalSchema.parse({
                sessions: Number(counts?.sessions ?? 0),
                messages: Number(counts?.messages ?? 0),
              });
              const headers = await sessionHeaders(client, caller, rows.rows);
              return rows.rows.map((row, index) => ({
                ...headers[index],
                duration_seconds:
                  row.duration_seconds === null
                    ? null
                    : Number(row.duration_seconds),
                last_activity_at: wireValue(row.last_activity_at),
              }));
            }),
        );
        if (!total) throw new Error("The session totals are unavailable.");
        return sessionsOutputSchema.parse({ ...page, total });
      },
      {
        describeResult: (result) => ({
          row_count: result.items.length,
          total: result.total,
        }),
      },
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
        const rows = await this.dependencies.readers.read(
          caller,
          async (client) => {
            await visibleSession(client, sessionId);
            return rawRecords(client, sessionId, after, request.limit);
          },
        );
        const items = [];
        let cursor: string | null = null;
        for (const [index, row] of rows.slice(0, request.limit).entries()) {
          const serialized = JSON.stringify(row.payload);
          const offset = index === 0 ? (after?.offset ?? 0) : 0;
          const digest = sha256Hex(serialized);
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
          if (
            jsonByteLength({ items, cursor: nextCursor }) > responseBytes.page
          ) {
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
      {
        describeResult: (result) => ({ row_count: result.items.length }),
      },
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
        const request = paginationSchema.parse(input);
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
        const rows = await this.dependencies.readers.read(caller, (client) =>
          sessionTreePage(client, caller, sessionId, after, request.limit),
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
      {
        describeResult: (result) => ({ row_count: result.nodes.length }),
      },
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
    view: keyof typeof CATALOG_VIEWS,
    outputSchema: T,
  ) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: `${view}.list`, resourceType: view, detail: input ?? null },
      async (caller) => {
        const configuration = CATALOG_VIEWS[view];
        const request = configuration.input.parse(input);
        const binding = wireValue({
          operation: view,
          organization: caller.organizationId,
          admin: hasAdminAuthority(caller),
          ...request,
          cursor: null,
        });
        const page = await offsetPage(
          this.dependencies.cursors,
          binding,
          request.cursor,
          request.limit,
          (offset, take) =>
            this.dependencies.readers.read(caller, async (client) => {
              const params = new Parameters();
              const predicates = Object.entries(request.filters)
                .filter(([, value]) => value !== undefined)
                .map(([field, value]) =>
                  typeof value === "boolean"
                    ? `${field}=${params.add(value)}`
                    : `positionCaseInsensitiveUTF8(${field},${params.add(value ?? "")})>0`,
                );
              const rows = await client.query(
                `SELECT * FROM api_ro.${view} WHERE ${predicates.join(" AND ") || "true"} ORDER BY ${request.sort ?? configuration.defaultSort} ${request.order} NULLS LAST,${configuration.tie} LIMIT ${params.add(take)} OFFSET ${params.add(offset)}`,
                params.values,
              );
              const omitted = new Set(configuration.omit);
              return rows.rows.map((row) => {
                const wire = Object.fromEntries(
                  Object.entries(wireRow(row)).filter(
                    ([key]) => !omitted.has(key),
                  ),
                );
                for (const column of configuration.numeric)
                  wire[column] = Number(row[column]);
                return compactMetadata(wire, CATALOG_TEXT_FIELDS);
              });
            }),
        );
        return outputSchema.parse(page);
      },
      {
        describeResult: (result) => ({ row_count: result.items.length }),
      },
    );
  }
}
