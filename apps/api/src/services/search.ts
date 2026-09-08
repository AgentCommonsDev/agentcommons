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
import { filterSql, Parameters } from "../repositories/read-model.js";
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
          const score = lexical
            ? "ts_rank_cd(m.search_tsv, search.query, 33)"
            : "0::real";
          const order = lexical
            ? "rank DESC, session_id, seq"
            : "time DESC, session_id, seq DESC";
          const sessionOrder = lexical
            ? `${score} DESC,m.seq`
            : "coalesce(m.timestamp,m.received_at) DESC,m.seq DESC";
          const rankType = vector ? "double precision" : "real";
          const continuation = after
            ? lexical
              ? `(rank < ${params.add(after.rank)}::${rankType} OR (rank = ${params.add(after.rank)}::${rankType} AND (session_id,seq) > (${params.add(after.session_id)}::uuid,${params.add(after.seq)}::int)))`
              : `(time < ${params.add(after.time)}::timestamptz OR (time = ${params.add(after.time)}::timestamptz AND session_id > ${params.add(after.session_id)}::uuid))`
            : "true";
          const hybrid = vector
            ? `WITH eligible AS (
            SELECT m.message_id AS id,m.session_id,m.seq,m.timestamp,m.received_at,m.search_tsv FROM api_ro.messages m JOIN api_ro.sessions s USING(session_id) WHERE ${conditions} AND m.searchable
          ), lexical AS (
            SELECT id, row_number() OVER(ORDER BY ts_rank_cd(search_tsv,search.query,33) DESC,session_id,seq) position
            FROM eligible CROSS JOIN LATERAL (SELECT websearch_to_tsquery('english',${query}) || websearch_to_tsquery('simple',${query}) query) search
            WHERE search_tsv @@ search.query
          ), vector_candidates AS (
            SELECT c.message_id,e.session_id,min(api_vector.cosine(c.embedding,api_vector.input(${params.add(`[${vector.join(",")}]`)}))) distance
            FROM api_vector.message_chunks c JOIN eligible e ON e.id=c.message_id GROUP BY c.message_id,e.session_id
          ), vector_sessions AS (
            SELECT *,row_number() OVER(PARTITION BY session_id ORDER BY distance,message_id) per_session FROM vector_candidates
          ), semantic AS (
            SELECT message_id id,row_number() OVER(ORDER BY distance,message_id) position FROM vector_sessions WHERE per_session<=3 ORDER BY position LIMIT 500
          ), fused AS (
            SELECT coalesce(l.id,v.id) id,coalesce(1.0/(60+l.position),0)+coalesce(1.0/(60+v.position),0) score FROM lexical l FULL JOIN semantic v USING(id)
          ), ranked AS (
            SELECT e.session_id,e.seq,f.score::double precision rank,coalesce(e.timestamp,e.received_at) time,
              row_number() OVER(PARTITION BY e.session_id ORDER BY f.score DESC,e.seq) per_session
            FROM fused f JOIN eligible e ON e.id=f.id
          ) SELECT session_id,seq,rank,to_char(time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') time
            FROM ranked WHERE per_session<=3 AND ${continuation} ORDER BY ${order} LIMIT ${params.add(request.limit + 1)}`
            : null;
          const result = await client.query<Record<string, unknown>>(
            hybrid ??
              `WITH ranked AS (
          SELECT m.session_id,m.seq,${score} rank,coalesce(m.timestamp,m.received_at) time,
          row_number() OVER (PARTITION BY m.session_id ORDER BY ${sessionOrder}) per_session
          FROM api_ro.messages m JOIN api_ro.sessions s USING(session_id)
          CROSS JOIN LATERAL (SELECT websearch_to_tsquery('english',${query}) || websearch_to_tsquery('simple',${query}) query) search
          WHERE ${conditions} AND ${lexical ? "m.searchable AND m.search_tsv @@ search.query" : "m.kind <> 'THINKING'"}
        ) SELECT session_id,seq,rank,to_char(time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') time FROM ranked WHERE per_session<=${lexical ? "3" : "1"} AND ${continuation} ORDER BY ${order} LIMIT ${params.add(request.limit + 1)}`,
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
          let consumed: Position | null = null;
          for (const hit of hits.slice(0, request.limit)) {
            const neighbours = await client.query<Record<string, unknown>>(
              `WITH ordered AS (
            SELECT seq,role,kind,tool_name,tool_use_id,content,tool_input,search_text,row_number() OVER (ORDER BY seq)::int ordinal
            FROM api_ro.messages WHERE session_id=$1::uuid AND kind <> 'THINKING'
          ), anchor AS (SELECT ordinal FROM ordered WHERE seq=$2)
          SELECT o.*,ts_headline('english',o.search_text,websearch_to_tsquery('english',$4) || websearch_to_tsquery('simple',$4),'MaxFragments=1,MinWords=1,MaxWords=5,StartSel=ACSTARTMARK,StopSel=ACENDMARK') headline FROM ordered o,anchor a WHERE o.ordinal BETWEEN a.ordinal-$3 AND a.ordinal+$3 ORDER BY o.ordinal`,
              [hit.session_id, hit.seq, request.context, request.query],
            );
            const ordinal = Number(
              neighbours.rows.find((row) => row.seq === hit.seq)?.ordinal,
            );
            const window: Window = {
              hit: { ...hit, ordinal },
              first: Math.max(1, ordinal - request.context),
              last: ordinal + request.context,
              rows: neighbours.rows,
            };
            if (!headers.has(hit.session_id)) {
              const header = await client.query<Record<string, unknown>>(
                "SELECT session_id,title,harness,model,repo_name,branch,user_email,started_at FROM api_ro.sessions WHERE session_id=$1::uuid",
                [hit.session_id],
              );
              const row = header.rows[0];
              if (!row) continue;
              headers.set(
                hit.session_id,
                searchBlockSchema
                  .omit({ messages: true })
                  .parse(
                    compactMetadata(wireRow(row), [
                      "title",
                      "model",
                      "repo_name",
                      "branch",
                    ]),
                  ),
              );
            }
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
                    ...excerpt(
                      messageContent(
                        String(row.content),
                        String(row.kind),
                        row.tool_input === undefined
                          ? undefined
                          : wireValue(row.tool_input),
                      ),
                      request.query,
                      String(row.headline),
                    ),
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
