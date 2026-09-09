import type { EmbeddingService } from "../embeddings/service.js";
import { formatSearch, messageContent } from "@agentcommons/core/format";
import {
  createSearchInputSchema,
  searchOutputSchema,
  searchBlockSchema,
  type SearchOutput,
  type SearchBlock,
} from "@agentcommons/core";
import { hasAdminAuthority } from "@agentcommons/db";
import { z } from "zod";
import {
  filterSql,
  Parameters,
  rootSessionIds,
  traceJson,
} from "../repositories/read-model.js";
import {
  messagePayloadBatches,
  readMessagePayloads,
} from "../repositories/message-payload.js";
import { ServiceError, type ServiceContext } from "./context.js";
import { bytes, compactMetadata, wireRow, wireValue } from "./read-budget.js";
import { readOperation, type ReadDependencies } from "./read-operation.js";

const positionSchema = z.strictObject({
  strategy: z.enum(["lexical", "rrf"]).default("lexical"),
  rank: z.number(),
  session_id: z.uuid(),
  seq: z.number().int(),
  time: z.string(),
});
type Position = z.infer<typeof positionSchema>;
interface Hit extends Position {
  ordinal: number;
}
interface Window {
  hit: Hit;
  first: number;
  last: number;
  rows: Record<string, unknown>[];
}
function excerpt(
  value: string,
  query: string,
  headline: string,
): { content: string; truncated: boolean } {
  const points = Array.from(value);
  if (points.length <= 300) return { content: value, truncated: false };
  const lower = value.toLocaleLowerCase("en-US");
  const match = /ACSTARTMARK([\s\S]*?)ACENDMARK/u.exec(headline)?.[1];
  const terms = match ? [match] : (query.match(/[\p{L}\p{N}_]+/gu) ?? []);
  const matches = terms
    .filter((term) => term.toLowerCase() !== "or")
    .map((term) => lower.indexOf(term.toLocaleLowerCase("en-US")))
    .filter((index) => index >= 0);
  const character = matches.length
    ? Array.from(value.slice(0, Math.min(...matches))).length
    : 0;
  const start = Math.max(0, Math.min(points.length - 300, character - 100));
  return {
    content: points.slice(start, start + 300).join(""),
    truncated: true,
  };
}
function fits(output: SearchOutput): boolean {
  return (
    bytes(output) <= 32768 &&
    Buffer.byteLength(formatSearch(output).text) <= 32768
  );
}
export class SearchService {
  private readonly inputSchema: ReturnType<typeof createSearchInputSchema>;
  constructor(
    private readonly dependencies: ReadDependencies,
    defaults = { context: 1, limit: 5 },
    private readonly embeddings?: Pick<EmbeddingService, "query">,
  ) {
    this.inputSchema = createSearchInputSchema(defaults);
  }
  execute(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "search", resourceType: "session", detail: input ?? null },
      async (caller) => {
        const request = this.inputSchema.parse(input);
        const binding = wireValue({
          organization: caller.organizationId,
          admin: hasAdminAuthority(caller),
          query: request.query,
          filters: request.filters,
          context: request.context,
          limit: request.limit,
        });
        const after = request.cursor
          ? this.dependencies.cursors.decode(
              request.cursor,
              binding,
              positionSchema,
            )
          : null;
        const vector =
          request.query.trim() &&
          this.embeddings &&
          after?.strategy !== "lexical"
            ? await this.embeddings.query(context, request.query)
            : null;
        if (after?.strategy === "rrf" && !vector)
          throw new ServiceError(
            503,
            "SEARCH_RANKING_UNAVAILABLE",
            "The ranking provider is unavailable. Retry this page later.",
          );
        return this.dependencies.readers.read(caller, async (client) => {
          const params = new Parameters();
          const conditions = await filterSql(client, request.filters, params);
          const query = params.add(request.query);
          const lexical = request.query.trim().length > 0;
          const order = lexical
            ? "rank DESC, session_id, seq"
            : "time DESC, session_id, seq DESC";
          const continuation = after
            ? lexical
              ? `(rank < ${params.add(after.rank, "Float64")} OR (rank = ${params.add(after.rank, "Float64")} AND (session_id,seq) > (${params.add(after.session_id, "UUID")},${params.add(after.seq, "UInt32")})))`
              : `(time < ${params.add(after.time, "DateTime64(6, 'UTC')")} OR (time = ${params.add(after.time, "DateTime64(6, 'UTC')")} AND session_id > ${params.add(after.session_id, "UUID")}))`
            : "true";
          const eligible = `SELECT m.message_id AS message_id,m.session_id AS session_id,m.seq AS seq,coalesce(m.timestamp,m.received_at) AS time
            FROM api_ro.messages m LEFT ANY JOIN api_ro.session_details s USING(session_id)
            WHERE ${conditions} AND ${lexical ? "m.searchable" : "m.kind!='THINKING'"}`;
          const lexicalMatches = `SELECT e.*,l.rank FROM eligible e
            JOIN api_ro.search_messages(q=${query}) l USING(session_id,seq)`;
          const candidates = vector
            ? `WITH eligible AS (${eligible}), lexical_matches AS (${lexicalMatches}), lexical AS (
                SELECT message_id,row_number() OVER(ORDER BY rank DESC,session_id,seq) AS position FROM lexical_matches
              ), vector_candidates AS (
                SELECT c.message_id AS message_id,e.session_id AS session_id,min(cosineDistance(c.embedding,${params.add(vector, "Array(Float32)")})) AS distance
                FROM api_ro.message_chunks c JOIN eligible e ON e.message_id=c.message_id GROUP BY c.message_id,e.session_id
              ), vector_sessions AS (
                SELECT *,row_number() OVER(PARTITION BY session_id ORDER BY distance,message_id) AS per_session FROM vector_candidates
              ), semantic AS (
                SELECT message_id,row_number() OVER(ORDER BY distance,message_id) AS position FROM vector_sessions WHERE per_session<=3 ORDER BY position LIMIT 500
              ), fused AS (
                SELECT message_id,sum(score) AS rank FROM (
                  SELECT message_id,1.0/(60+position) AS score FROM lexical
                  UNION ALL SELECT message_id,1.0/(60+position) AS score FROM semantic
                ) GROUP BY message_id
              ) SELECT e.message_id AS message_id,e.session_id AS session_id,e.seq AS seq,e.time AS time,f.rank AS rank FROM fused f JOIN eligible e USING(message_id)`
            : `WITH eligible AS (${eligible}) ${lexical ? lexicalMatches : "SELECT *,toFloat64(0) AS rank FROM eligible"}`;
          const result = await client.query(
            `WITH candidates AS (${candidates}), ranked AS (
              SELECT *,row_number() OVER(PARTITION BY session_id ORDER BY ${lexical ? "rank DESC,seq" : "time DESC,seq DESC"}) AS per_session FROM candidates
            ) SELECT session_id,seq,rank,time FROM ranked WHERE per_session<=${lexical ? "3" : "1"} AND ${continuation}
              ORDER BY ${order} LIMIT ${params.add(request.limit + 1, "UInt32")}`,
            params.values,
          );
          const hits = result.rows.map((row) =>
            positionSchema.parse({
              ...wireRow(row),
              strategy: vector ? "rrf" : "lexical",
            }),
          );
          const output: SearchOutput = {
            blocks: [],
            cursor: null,
            truncated_response: false,
          };
          const windows: Window[] = [];
          const headers = new Map<string, Omit<SearchBlock, "messages">>();
          const pageHits = hits.slice(0, request.limit);
          const ids = [...new Set(pageHits.map((hit) => hit.session_id))];
          // Fetch all context, headers and tree roots in three queries for the whole page.
          const [neighbours, values, roots] = await Promise.all([
            ids.length
              ? client.query(
                  `WITH ordered AS (
              SELECT message_id,session_id,seq,role,kind,tool_name,tool_use_id,payload_bytes,
                row_number() OVER(PARTITION BY session_id ORDER BY seq) AS ordinal
              FROM api_ro.message_metadata WHERE session_id IN {ids:Array(UUID)} AND kind!='THINKING'
            ), anchors AS (SELECT session_id,seq,ordinal FROM ordered WHERE has(arrayZip({anchor_ids:Array(UUID)},{anchor_seqs:Array(UInt32)}),(session_id,seq)))
            SELECT o.message_id AS message_id,o.session_id AS session_id,o.seq AS seq,o.role AS role,o.kind AS kind,o.tool_name AS tool_name,
              o.tool_use_id AS tool_use_id,o.payload_bytes AS payload_bytes,o.ordinal AS ordinal,
              a.seq AS anchor_seq,a.ordinal AS anchor_ordinal
            FROM ordered o JOIN anchors a ON o.session_id=a.session_id
            WHERE o.ordinal+{context:UInt32}>=a.ordinal AND o.ordinal<=a.ordinal+{context:UInt32}
            ORDER BY o.session_id,a.seq,o.ordinal`,
                  {
                    ids,
                    anchor_ids: pageHits.map((hit) => hit.session_id),
                    anchor_seqs: pageHits.map((hit) => hit.seq),
                    context: request.context,
                  },
                )
              : Promise.resolve({ rows: [] }),
            ids.length
              ? client.query(
                  "SELECT session_id,parent_relation,agent_type,parent_tool_use_id,title,harness,model,repo_name,branch,user_email,started_at FROM api_ro.session_details WHERE session_id IN {ids:Array(UUID)}",
                  { ids },
                )
              : Promise.resolve({ rows: [] }),
            rootSessionIds(client, ids),
          ]);
          for (const row of values.rows)
            headers.set(
              String(row.session_id),
              searchBlockSchema.omit({ messages: true }).parse(
                compactMetadata(
                  {
                    ...wireRow(row),
                    root_session_id:
                      roots.get(String(row.session_id)) ??
                      String(row.session_id),
                  },
                  ["title", "model", "repo_name", "branch", "agent_type"],
                ),
              ),
            );
          const payloadBatches = messagePayloadBatches(
            neighbours.rows,
            2 * 1024 * 1024,
          );
          const excerpts = new Map<unknown, ReturnType<typeof excerpt>>();
          async function ensureExcerpts(
            rows: readonly Record<string, unknown>[],
          ) {
            while (rows.some((row) => !excerpts.has(row.message_id))) {
              const batch = payloadBatches.next();
              if (batch.done)
                throw new Error("The published search context is unavailable.");
              const metadata = new Map(
                batch.value.map((row) => [row.message_id, row]),
              );
              for (const payload of await readMessagePayloads(
                client,
                batch.value,
              )) {
                const row = metadata.get(payload.message_id);
                excerpts.set(
                  payload.message_id,
                  excerpt(
                    messageContent(
                      String(payload.content),
                      String(row?.kind),
                      traceJson(payload.tool_input),
                    ),
                    request.query,
                    "",
                  ),
                );
              }
            }
          }
          let consumed: Position | null = null;
          for (const hit of pageHits) {
            const rows = neighbours.rows.filter(
              (row) =>
                row.session_id === hit.session_id &&
                Number(row.anchor_seq) === hit.seq,
            );
            const ordinal = Number(rows[0]?.anchor_ordinal);
            if (!rows.length || !headers.has(hit.session_id)) continue;
            await ensureExcerpts(rows);
            const window: Window = {
              hit: { ...hit, ordinal },
              first: Math.max(1, ordinal - request.context),
              last: ordinal + request.context,
              rows,
            };
            windows.push(window);
            const blocks: SearchBlock[] = [];
            const groups: Window[][] = [];
            for (const next of windows) {
              const overlapping = groups.filter((group) =>
                group.some(
                  (member) =>
                    member.hit.session_id === next.hit.session_id &&
                    member.first <= next.last + 1 &&
                    next.first <= member.last + 1,
                ),
              );
              if (!overlapping.length) groups.push([next]);
              else {
                const first = overlapping[0];
                if (first) first.push(next, ...overlapping.slice(1).flat());
                for (const other of overlapping.slice(1))
                  groups.splice(groups.indexOf(other), 1);
              }
            }
            for (const group of groups) {
              const first = group[0];
              if (!first) continue;
              const header = headers.get(first.hit.session_id);
              if (!header) continue;
              const matched = new Set(group.map((item) => item.hit.seq));
              const rows = new Map(
                group
                  .flatMap((item) => item.rows)
                  .map((row) => [Number(row.seq), row]),
              );
              blocks.push({
                ...header,
                messages: [...rows.entries()]
                  .sort(([a], [b]) => a - b)
                  .map(([seq, row]) => ({
                    seq,
                    role: row.role,
                    kind: row.kind,
                    tool_name: row.tool_name,
                    tool_use_id: row.tool_use_id,
                    ...excerpts.get(row.message_id),
                    hit: matched.has(seq),
                  }))
                  .map((message) =>
                    searchBlockSchema.shape.messages.element.parse(
                      compactMetadata(message, ["tool_name", "tool_use_id"]),
                    ),
                  ),
              });
            }
            const candidate: SearchOutput = {
              blocks,
              cursor: this.dependencies.cursors.encode(binding, hit),
              truncated_response: false,
            };
            if (!fits(candidate)) {
              windows.pop();
              output.truncated_response = true;
              break;
            }
            output.blocks = blocks;
            consumed = hit;
          }
          const more = output.truncated_response || hits.length > request.limit;
          output.cursor =
            more && consumed
              ? this.dependencies.cursors.encode(binding, consumed)
              : null;
          if (more && !consumed && hits.length)
            throw new ServiceError(
              413,
              "SEARCH_BLOCK_TOO_LARGE",
              "The session metadata exceeds the response limit. Use SQL to select the fields you need.",
            );
          return searchOutputSchema.parse(output);
        });
      },
      (result) => ({
        hits: result.blocks
          .flatMap((block) => block.messages)
          .filter((message) => message.hit).length,
        truncated_response: result.truncated_response,
      }),
      "read",
      (result) => [...new Set(result.blocks.map((block) => block.session_id))],
    );
  }
}
