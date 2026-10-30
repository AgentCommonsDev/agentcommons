import type { EmbeddingService } from "../embeddings/service.js";
import { formatSearch, searchNextStep } from "@agentcommons/core/format";
import {
  createSearchInputSchema,
  searchOutputSchema,
  searchBlockSchema,
  searchTotalSchema,
  type SearchOutput,
  type SearchBlock,
} from "@agentcommons/core";
import { hasAdminAuthority } from "@agentcommons/db";
import {
  protocolArray,
  protocolLiterals,
  protocolObject,
} from "@agentcommons/core/redaction";
import {
  searchConditionFields,
  searchConditionSchema,
  searchFilterKeys,
  searchInputSchema,
} from "@agentcommons/core/schemas";
import { z } from "zod";
import {
  andSql,
  filterSql,
  payloadSql,
  Parameters,
  sessionLinks,
} from "../repositories/read-model.js";
import {
  messagePayloadBatches,
  messageText,
  readMessagePayloads,
} from "../repositories/message-payload.js";
import { traceReadFailure } from "../repositories/read-failure.js";
import { ServiceError, type ServiceContext } from "./context.js";
import {
  compactMetadata,
  fitsToolBudget,
  pickSchema,
  wireRow,
  wireValue,
} from "./read-budget.js";
import { readOperation, type ReadDependencies } from "./read-operation.js";

/** Search protocol syntax (filter keys, condition fields and operators) is not free text. */
const conditionStructure = protocolObject(
  [
    ...new Set(
      searchConditionSchema.options.flatMap((option) =>
        Object.keys(option.shape),
      ),
    ),
  ],
  {
    field: protocolLiterals(...Object.keys(searchConditionFields)),
    op: protocolLiterals(
      ...searchConditionSchema.options.flatMap((option) => [
        ...option.shape.op.values,
      ]),
    ),
  },
);
/** Passed as the search audit `structure`; tests that write search rows directly reuse it. */
export const searchAuditStructure = protocolObject(["input", "result"], {
  input: protocolObject(Object.keys(searchInputSchema.shape), {
    filters: protocolObject(searchFilterKeys, {
      where: protocolArray(conditionStructure),
    }),
  }),
  result: protocolObject(["hits", "truncated_response"], {
    total: protocolObject(["sessions", "hits"]),
    partial: protocolObject(["sessions_searched"]),
  }),
});
/**
 * Sessions the one bounded attempt after a time or memory limit searches (§7.5): the most
 * recently active ones matching the filters. With time-ordered session ids they are the
 * newest primary-key ranges, so the bound prunes the corpus scan instead of only the page.
 */
const PARTIAL_SEARCH_SESSIONS = 50;
/**
 * How much a teammate-authored session's rank is scaled before the page limit so cross-user
 * reuse surfaces (ADR 0090): a modest multiplier that lifts an equally- or slightly-less
 * relevant teammate session into the page without displacing a clearly better own-session
 * hit or regressing the golden top-3 hit rate. Author is per session, so the factor is
 * constant within a session and the best hit per session is unchanged; the boosted value
 * feeds `rank` throughout, keeping the per-session order, the page order and the keyset
 * cursor consistent.
 */
const TEAMMATE_RANK_BOOST = 1.15;
/** A hit of a query, ordered by `(rank desc, session_id, seq)`. */
const rankedPositionSchema = z.strictObject({
  strategy: z.enum(["lexical", "rrf"]),
  rank: z.number(),
  session_id: z.uuid(),
  seq: z.number().int(),
});
/** The anchor of a search without a query, ordered by `(time desc, session_id)`. */
const browsePositionSchema = z.strictObject({
  strategy: z.literal("browse"),
  time: z.string(),
  session_id: z.uuid(),
  seq: z.number().int(),
});
const positionSchema = z.union([rankedPositionSchema, browsePositionSchema]);
type Position = z.infer<typeof positionSchema>;
const searchHeaderSchema = searchBlockSchema.omit({ messages: true });
type SearchHeader = z.infer<typeof searchHeaderSchema>;
const searchMessageSchema = searchBlockSchema.shape.messages.element;
type Excerpt = ReturnType<typeof excerpt>;
/** One hit with its surrounding context rows, as message ordinals within the session. */
interface Window {
  hit: Pick<Position, "session_id" | "seq">;
  first: number;
  last: number;
  rows: Record<string, unknown>[];
}
/** The excerpt's place inside the full content in UTF-8 bytes, the unit `get` cursors use. */
type ContentRange = { start: number; end: number; total: number };
function excerpt(
  value: string,
  query: string,
): { content: string; truncated: boolean; content_range: ContentRange | null } {
  const points = Array.from(value);
  if (points.length <= 300)
    return { content: value, truncated: false, content_range: null };
  const lower = value.toLocaleLowerCase("en-US");
  const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const matches = terms
    .filter((term) => term.toLowerCase() !== "or")
    .map((term) => lower.indexOf(term.toLocaleLowerCase("en-US")))
    .filter((index) => index >= 0);
  const character = matches.length
    ? Array.from(value.slice(0, Math.min(...matches))).length
    : 0;
  const start = Math.max(0, Math.min(points.length - 300, character - 100));
  const content = points.slice(start, start + 300).join("");
  const startBytes = Buffer.byteLength(points.slice(0, start).join(""));
  return {
    content,
    truncated: true,
    content_range: {
      start: startBytes,
      end: startBytes + Buffer.byteLength(content),
      total: Buffer.byteLength(value),
    },
  };
}
/** Windows of one session whose ordinal ranges touch or overlap merge into one group, in hit order. */
function groupWindows(windows: readonly Window[]): Window[][] {
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
  return groups;
}
/** One block per group: the session header plus its distinct context rows in seq order. */
function blockFor(
  group: readonly Window[],
  header: SearchHeader,
  excerpts: ReadonlyMap<unknown, Excerpt>,
): SearchBlock {
  const matched = new Set(group.map((item) => item.hit.seq));
  const rows = new Map(
    group.flatMap((item) => item.rows).map((row) => [Number(row.seq), row]),
  );
  return {
    ...header,
    messages: [...rows.entries()]
      .sort(([a], [b]) => a - b)
      .map(([seq, row]) =>
        searchMessageSchema.parse(
          compactMetadata(
            {
              seq,
              role: row.role,
              kind: row.kind,
              tool_name: row.tool_name,
              tool_use_id: row.tool_use_id,
              ...excerpts.get(row.message_id),
              hit: matched.has(seq),
            },
            ["tool_name", "tool_use_id"],
          ),
        ),
      ),
  };
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
      {
        action: "search",
        resourceType: "session",
        detail: input ?? null,
        structure: searchAuditStructure,
      },
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
        const attempt = (scope: number | null, relaxed: boolean) =>
          this.dependencies.readers.read(caller, async (client) => {
            const params = new Parameters();
            const plan = await filterSql(client, request.filters, params);
            const context = scope === null ? request.context : 0;
            // A bounded attempt resolves its session set with one light session_details
            // scan; the same array then bounds both message scans by primary key.
            const scoped =
              scope === null
                ? null
                : (
                    await client.query<{ session_id: string }>(
                      `SELECT s.session_id AS session_id FROM api_ro.session_details s WHERE ${andSql(plan.session)} ORDER BY s.last_activity_at DESC,s.session_id DESC LIMIT ${params.add(scope, "UInt32")}`,
                      params.values,
                    )
                  ).rows.map((row) => row.session_id);
            const scopeParam = scoped
              ? params.add(scoped, "Array(UUID)")
              : null;
            const sessionScope = scopeParam
              ? `m.session_id IN ${scopeParam}`
              : plan.session.length
                ? `m.session_id IN (SELECT s.session_id FROM api_ro.session_details s WHERE ${andSql(plan.session)})`
                : null;
            const query = params.add(request.query);
            const lexical = request.query.trim().length > 0;
            const order = lexical
              ? "rank DESC, session_id, seq"
              : "time DESC, session_id, seq DESC";
            // Candidates come from the search corpus alone (ADR 0098), which carries every
            // message field a filter tests: the text index's matches of a query, or every
            // live message for a search without one. A search therefore reads in proportion
            // to what it matches, never to the organization's whole corpus. The relaxation
            // fallback swaps in the session-level matcher (ADR 0081); the service runs it
            // only after the strict matcher returns nothing.
            const matcher = `api_ro.${relaxed ? "search_messages_session" : "search_messages"}(q=${query})`;
            // A payload condition (`content`, `tool_input`) joins the same message in the
            // payload-carrying view. `payloadBound` names the sessions that read may cover:
            // the bounded attempt's own set, or the sessions the text matched; a relation
            // without a text predicate has no such bound.
            const filtered = (
              relation: string,
              extra: readonly string[],
              payloadBound?: string,
            ) =>
              `${relation} m WHERE ${andSql([
                ...plan.message,
                ...(sessionScope ? [sessionScope] : []),
                ...payloadSql(plan, payloadBound),
                ...extra,
              ])}`;
            const matches = `SELECT m.message_id AS message_id,m.session_id AS session_id,m.seq AS seq,m.rank AS rank FROM ${filtered(matcher, [], scopeParam ?? `(SELECT session_id FROM ${matcher})`)}`;
            const candidates = !lexical
              ? // A message whose time the corpus reconcile has not copied yet has no place
                // in a time order, so a browse leaves it out until then (ADR 0098).
                `SELECT m.session_id AS session_id,m.seq AS seq,assumeNotNull(m.message_time) AS time FROM ${filtered("api_ro.search_corpus", ["m.kind!='THINKING'", "m.message_time IS NOT NULL"], scopeParam ?? undefined)}`
              : vector
                ? `WITH lexical_matches AS (${matches}), eligible AS MATERIALIZED (
                SELECT m.message_id AS message_id,m.session_id AS session_id,m.seq AS seq FROM ${filtered("api_ro.search_corpus", ["m.searchable"], scopeParam ?? undefined)}
              ), lexical AS (
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
              ) SELECT e.session_id AS session_id,e.seq AS seq,f.rank AS rank FROM fused f JOIN eligible e USING(message_id)`
                : matches;
            const totalParameters = { ...params.values };
            const continuation =
              after === null
                ? "true"
                : after.strategy === "browse"
                  ? `(time < ${params.add(after.time, "DateTime64(6, 'UTC')")} OR (time = ${params.add(after.time, "DateTime64(6, 'UTC')")} AND session_id > ${params.add(after.session_id, "UUID")}))`
                  : `(rank < ${params.add(after.rank, "Float64")} OR (rank = ${params.add(after.rank, "Float64")} AND (session_id,seq) > (${params.add(after.session_id, "UUID")},${params.add(after.seq, "UInt32")})))`;
            // One row per session: its best candidates in the page order (three per query,
            // one per browse) and its share of the totals, so ranking holds memory per
            // session however many messages match (ADR 0098). The totals count every
            // candidate before the per-session cap, the cursor and the limit cut the page.
            const best = lexical
              ? "groupArraySorted(3)((-rank,seq))"
              : "groupArraySorted(1)((-toUnixTimestamp64Micro(time),-toInt64(seq),seq,time))";
            // Cross-user reuse boost (ADR 0090): a session the caller did not write has its
            // rank scaled by TEAMMATE_RANK_BOOST before the page limit, so one member's prior
            // work reaches another. The author comes from one scan of the session→author map
            // (`session_authors`) bounded to the candidate sessions. The factor is constant
            // within a session, so it leaves each session's best candidates unchanged and is
            // applied after that cut; the boosted value is the rank the page order and the
            // keyset cursor use. Only the rank-ordered query boosts.
            const page = lexical
              ? `SELECT session_id,tupleElement(b,2) AS seq,-tupleElement(b,1)*if(author!=${params.add(caller.userId)} AND author!='',${String(TEAMMATE_RANK_BOOST)},1.0) AS rank,total_hits,total_sessions
                FROM (SELECT p.*,a.user_id AS author FROM per_session p LEFT JOIN (
                  SELECT session_id,any(user_id) AS user_id FROM api_ro.session_authors WHERE session_id IN (SELECT session_id FROM per_session) GROUP BY session_id
                ) a ON a.session_id=p.session_id) ARRAY JOIN best AS b`
              : `SELECT session_id,tupleElement(b,3) AS seq,tupleElement(b,4) AS time,total_hits,total_sessions
                FROM per_session ARRAY JOIN best AS b`;
            const result = await client.query(
              `WITH candidates AS (${candidates}), per_session AS MATERIALIZED (
                SELECT session_id,${best} AS best,sum(count()) OVER () AS total_hits,count() OVER () AS total_sessions
                FROM candidates GROUP BY session_id
              ) SELECT * FROM (${page}) WHERE ${continuation}
              ORDER BY ${order} LIMIT ${params.add(request.limit + 1, "UInt32")}`,
              params.values,
            );
            const hits: Position[] = result.rows.map((row) => {
              const wire = wireRow(row);
              return lexical
                ? rankedPositionSchema.parse({
                    ...pickSchema(wire, rankedPositionSchema),
                    strategy: vector ? "rrf" : "lexical",
                  })
                : browsePositionSchema.parse({
                    ...pickSchema(wire, browsePositionSchema),
                    strategy: "browse",
                  });
            });
            // A continuation past the last hit carries no aggregate; only then is a count
            // of the candidates (with no window) needed to state the totals.
            const first = result.rows[0];
            const counts = first
              ? { sessions: first.total_sessions, hits: first.total_hits }
              : after
                ? (
                    await client.query(
                      `WITH candidates AS (${candidates}) SELECT uniqExact(session_id) AS sessions,count() AS hits FROM candidates`,
                      totalParameters,
                    )
                  ).rows[0]
                : { sessions: 0, hits: 0 };
            const total = searchTotalSchema.parse({
              sessions: Number(counts?.sessions ?? 0),
              hits: Number(counts?.hits ?? 0),
            });
            // A page with no hit carries its next step where the model reads it (ADR
            // 0078); a bounded page keeps its own note instead.
            const next = scoped ? null : searchNextStep(request, total.hits);
            const output: SearchOutput = {
              blocks: [],
              cursor: null,
              truncated_response: false,
              total,
              partial: scoped ? { sessions_searched: scoped.length } : null,
              next,
            };
            const windows: Window[] = [];
            const headers = new Map<string, SearchHeader>();
            const pageHits = hits.slice(0, request.limit);
            const ids = [...new Set(pageHits.map((hit) => hit.session_id))];
            // Fetch all context and headers in two ClickHouse queries and the tree roots
            // from control, together, for the whole page. Materialize the ordered metadata
            // once: anchors and neighbors share its stored payload sizes and ordinals,
            // avoiding duplicate scans, aggregation and ordinal calculation.
            const [neighbours, values, links] = await Promise.all([
              ids.length
                ? client.query(
                    `WITH ordered AS MATERIALIZED (
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
                      context,
                    },
                  )
                : Promise.resolve({ rows: [] }),
              ids.length
                ? client.query(
                    "SELECT session_id,parent_relation,agent_type,parent_tool_use_id,title,harness,model,repo_name,branch,user_email,user_id,started_at FROM api_ro.session_details WHERE session_id IN {ids:Array(UUID)}",
                    { ids },
                  )
                : Promise.resolve({ rows: [] }),
              sessionLinks(client.control, caller, ids),
            ]);
            for (const row of values.rows) {
              // `user_id` is selected only to derive `by_teammate`; it is not a header field,
              // so it is dropped before the strict header parse. A session another member of
              // the organization authored is a teammate result (guard: false when the author
              // is the caller or the author id is empty).
              const { user_id, ...header } = wireRow(row);
              headers.set(
                String(row.session_id),
                searchHeaderSchema.parse(
                  compactMetadata(
                    {
                      ...header,
                      root_session_id:
                        links.get(String(row.session_id))?.root_session_id ??
                        String(row.session_id),
                      by_teammate:
                        typeof user_id === "string" &&
                        user_id !== "" &&
                        user_id !== caller.userId,
                    },
                    ["title", "model", "repo_name", "branch", "agent_type"],
                  ),
                ),
              );
            }
            const contextByAnchor = new Map<
              string,
              Record<string, unknown>[]
            >();
            for (const row of neighbours.rows) {
              const anchor = `${String(row.session_id)}:${String(Number(row.anchor_seq))}`;
              const rows = contextByAnchor.get(anchor) ?? [];
              rows.push(row);
              contextByAnchor.set(anchor, rows);
            }
            const payloadBatches = messagePayloadBatches(
              neighbours.rows,
              2 * 1024 * 1024,
            );
            const excerpts = new Map<unknown, Excerpt>();
            async function ensureExcerpts(
              rows: readonly Record<string, unknown>[],
            ) {
              while (rows.some((row) => !excerpts.has(row.message_id))) {
                const batch = payloadBatches.next();
                if (batch.done)
                  throw new Error(
                    "The published search context is unavailable.",
                  );
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
                      messageText({ ...payload, kind: row?.kind }),
                      request.query,
                    ),
                  );
                }
              }
            }
            let consumed: Position | null = null;
            for (const hit of pageHits) {
              const rows =
                contextByAnchor.get(`${hit.session_id}:${String(hit.seq)}`) ??
                [];
              const ordinal = Number(rows[0]?.anchor_ordinal);
              if (!rows.length || !headers.has(hit.session_id)) continue;
              await ensureExcerpts(rows);
              windows.push({
                hit,
                first: Math.max(1, ordinal - context),
                last: ordinal + context,
                rows,
              });
              const blocks = groupWindows(windows).flatMap((group) => {
                const header = group[0] && headers.get(group[0].hit.session_id);
                return header ? [blockFor(group, header, excerpts)] : [];
              });
              const candidate: SearchOutput = {
                blocks,
                cursor: this.dependencies.cursors.encode(binding, hit),
                truncated_response: false,
                total,
                partial: output.partial,
                next,
              };
              if (!fitsToolBudget(candidate, formatSearch)) {
                windows.pop();
                output.truncated_response = true;
                break;
              }
              output.blocks = blocks;
              consumed = hit;
            }
            const more =
              output.truncated_response || hits.length > request.limit;
            // A bounded page has no continuation: its set is not the query's, and the
            // note tells the agent to narrow the filters instead.
            output.cursor =
              more && consumed && !scoped
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
        // Relaxation only applies to a first page of a multi-word lexical query (ADR 0081):
        // a cursor continuation stays on the strategy that opened the page, and for a single
        // token the strict and session-level matchers return the same sessions, so relaxing
        // it would only add a second scan and never recover a hit.
        const relaxable =
          !after && (request.query.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0) >= 2;
        try {
          const strict = await attempt(null, false);
          if (!relaxable || strict.total.hits > 0) return strict;
          // The strict matcher required every query token in one message and found nothing;
          // retry once with the session-level matcher so words spread across a session match.
          return await attempt(null, true);
        } catch (error) {
          // One bounded attempt after a time or memory limit (§7.5). The scan cost does not
          // depend on context or limit, so the same shape is not retried; a first page over
          // the most recently active matching sessions is returned as a partial result instead.
          const code = traceReadFailure(error)?.code;
          if (
            after ||
            (code !== "READ_TIME_LIMIT" && code !== "READ_MEMORY_LIMIT")
          )
            throw error;
          return attempt(PARTIAL_SEARCH_SESSIONS, false);
        }
      },
      {
        describeResult: (result) => ({
          hits: result.blocks
            .flatMap((block) => block.messages)
            .filter((message) => message.hit).length,
          truncated_response: result.truncated_response,
          total: result.total,
          partial: result.partial,
        }),
        describeResources: (result) => [
          ...new Set(result.blocks.map((block) => block.session_id)),
        ],
      },
    );
  }
}
