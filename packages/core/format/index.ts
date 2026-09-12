export {
  repositoryLinks,
  messageBranches,
  spawnPlacements,
} from "./session-navigation.js";
export type { SpawnedRun } from "./session-navigation.js";
export { searchNextStep } from "./search-next.js";
export type { SearchNextInput } from "./search-next.js";
import type { SearchOutput } from "../schemas/search.js";
import type { GetOutput, Message, SessionHeader } from "../schemas/get.js";
import type { SqlOutput } from "../schemas/sql.js";
import type { JsonValue } from "../schemas/common.js";

/**
 * Text and structured renderings of one already-validated result. Validation stays at
 * the boundary that produced the value (the service's output schema, the MCP adapter),
 * so byte-budget loops can format a candidate page without re-parsing it.
 */
export interface Formatted<T> {
  text: string;
  structuredContent: T;
}
export function messageContent(
  content: string,
  kind: string,
  toolInput: JsonValue | undefined,
): string {
  return kind === "TOOL_USE" && toolInput !== null && toolInput !== undefined
    ? `${content}\n${JSON.stringify(toolInput)}`
    : content;
}
function scalar(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
function inline(value: JsonValue): string {
  return scalar(value)
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t");
}
/** "12 hits in 4 sessions": every match the query has, so a reader knows how much lies beyond this page. */
function formatSearchTotal(total: SearchOutput["total"]): string {
  const plural = (count: number, noun: string) =>
    `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
  return `${plural(total.hits, "hit")} in ${plural(total.sessions, "session")}`;
}
export function formatSearch(result: SearchOutput): Formatted<SearchOutput> {
  const blocks = result.blocks.map((block) => {
    const messages = block.messages.map((message) => {
      const metadata = [
        `seq ${String(message.seq)}`,
        message.role,
        message.kind,
        ...(message.tool_name
          ? [`tool_name=${inline(message.tool_name)}`]
          : []),
        ...(message.tool_use_id
          ? [`tool_use_id=${inline(message.tool_use_id)}`]
          : []),
        ...(message.hit ? ["[hit]"] : []),
        ...(message.truncated
          ? [
              message.content_range
                ? `[truncated ${String(message.content_range.start)}-${String(message.content_range.end)} of ${String(message.content_range.total)}]`
                : "[truncated]",
            ]
          : []),
        ...(message.truncated_fields.length
          ? [`truncated_fields=${JSON.stringify(message.truncated_fields)}`]
          : []),
      ];
      // An excerpt marks its cut ends inline so a mid-JSON fragment reads as one.
      const range = message.content_range;
      const content = range
        ? `${range.start > 0 ? "…" : ""}${message.content}${range.end < range.total ? "…" : ""}`
        : message.content;
      return `${metadata.join(" ")}\n${content}`;
    });
    return [
      `session_id: ${block.session_id} | ${inline(block.title ?? "Untitled session")}`,
      `repo_name: ${inline(block.repo_name)} | branch: ${inline(block.branch)} | user_email: ${inline(block.user_email)}`,
      `harness: ${block.harness} | model: ${inline(block.model)} | started_at: ${block.started_at}`,
      // A hit inside a run names its root so a reader opens the whole tree with get.
      ...(block.parent_relation
        ? [
            `root_session_id: ${block.root_session_id} | parent_relation: ${block.parent_relation} | agent_type: ${inline(block.agent_type)} | parent_tool_use_id: ${inline(block.parent_tool_use_id)}`,
          ]
        : []),
      ...(block.truncated_fields.length
        ? [`truncated_fields: ${JSON.stringify(block.truncated_fields)}`]
        : []),
      ...messages,
    ].join("\n");
  });
  const text = [
    formatSearchTotal(result.total),
    // A bounded page after a time limit says what it covered and how to reach the rest.
    ...(result.partial
      ? [
          `Partial result: the full search exceeded the read time limit, so this page covers the ${String(result.partial.sessions_searched)} most recently active sessions that match the filters. Narrow with filters (repo_name, since, until, user_email) to search the rest.`,
        ]
      : []),
    // A page with no hit says what to try next (ADR 0078); the JSON carries the same field.
    ...(result.next === null ? [] : [`Next: ${result.next}`]),
    ...blocks,
    ...(result.cursor === null
      ? []
      : [`cursor: ${JSON.stringify(result.cursor)}`]),
    ...(result.truncated_response
      ? ["Response truncated. Continue with the cursor."]
      : []),
  ].join("\n\n");
  return { text, structuredContent: result };
}
/** Header fields that mean nothing to a reader of the text form; the JSON keeps them. */
const HEADER_TEXT_OMITTED = new Set(["organization_id", "installation_id"]);
export function formatSessionHeader(header: SessionHeader): string {
  const facts = Object.entries(header)
    .filter(([key]) => !HEADER_TEXT_OMITTED.has(key))
    .map(([key, value]) => `${key}: ${inline(value)}`);
  const lines: string[] = [];
  for (let offset = 0; offset < facts.length; offset += 3)
    lines.push(facts.slice(offset, offset + 3).join(" | "));
  if (header.child_count > 0) {
    // Child sessions are part of this session; name them so a reader knows to follow up with get.
    // `spawned_by` is the tool_use_id of the TOOL_USE message here that started the child.
    const runs = header.children.map(
      (child) =>
        `${child.session_id} ${child.parent_relation ?? "CHILD"}${child.agent_type ? ` agent_type=${inline(child.agent_type)}` : ""}${child.parent_tool_use_id ? ` spawned_by=${child.parent_tool_use_id}` : ""}`,
    );
    lines.push(
      `subagent_runs: ${String(header.child_count)} child sessions (subagents, forks or spawned runs) belong to this session${header.children_truncated ? "; the list below is truncated, use the tree" : ""} | ids: ${runs.join("; ") || "none listed"}`,
    );
  }
  return lines.join("\n");
}
/** The one-line header a continuation page carries: the reader already has the full one. */
export function formatSessionLine(header: SessionHeader): string {
  return `session ${header.session_id} | title: ${inline(header.title)} | ${header.harness} | ${String(header.message_count)} messages | continued`;
}
/**
 * One message as an agent reads it: the identifying line, the content, then the message id
 * and only the details that carry information (token counts when recorded, a cursor when
 * the content is bounded, shortened fields when any). Record and batch ids stay in the JSON.
 */
export function formatMessage(message: Message): string {
  const metadata = [
    `seq ${String(message.seq)}`,
    message.role,
    message.kind,
    `timestamp=${inline(message.timestamp)}`,
    `model=${inline(message.model)}`,
    ...(message.tool_name ? [`tool_name=${inline(message.tool_name)}`] : []),
    ...(message.tool_use_id
      ? [`tool_use_id=${inline(message.tool_use_id)}`]
      : []),
  ];
  const details = [
    `message_id: ${message.message_id}`,
    ...(message.input_tokens === null && message.output_tokens === null
      ? []
      : [
          `input_tokens: ${inline(message.input_tokens)} | output_tokens: ${inline(message.output_tokens)}`,
        ]),
    ...(message.content_cursor === null
      ? []
      : [`content_cursor: ${JSON.stringify(message.content_cursor)}`]),
    ...(message.truncated_fields.length
      ? [`truncated_fields: ${JSON.stringify(message.truncated_fields)}`]
      : []),
  ];
  return `${metadata.join(" ")}\n${message.content}\n${details.join("\n")}`;
}
/**
 * The text of one `get` page. The first page of a read carries the full header; a
 * continuation page (the caller passed a cursor) carries one line, since the reader holds
 * the header from the first page.
 */
export function formatGet(
  result: GetOutput,
  options: { continuation?: boolean } = {},
): Formatted<GetOutput> {
  const text = [
    ...(result.header === null
      ? []
      : [
          options.continuation
            ? formatSessionLine(result.header)
            : formatSessionHeader(result.header),
        ]),
    ...result.messages.map(formatMessage),
    ...(result.next === null ? [] : [`next: ${JSON.stringify(result.next)}`]),
  ].join("\n\n");
  return { text, structuredContent: result };
}
export function formatSql(result: SqlOutput): Formatted<SqlOutput> {
  const cell = (item: JsonValue) => inline(item).replaceAll("|", "\\|");
  const text = [
    `${String(result.row_count)} ${result.row_count === 1 ? "row" : "rows"}${result.capped ? " (capped). Add LIMIT/OFFSET to page." : ""}`,
    result.columns
      .map((column) => `${cell(column.name)} (${cell(column.type)})`)
      .join(" | "),
    ...result.rows.map((row) => row.map(cell).join(" | ")),
    ...(result.truncated_cells.length === 0
      ? []
      : [`truncated_cells: ${JSON.stringify(result.truncated_cells)}`]),
  ].join("\n");
  return { text, structuredContent: result };
}
export { formatCsv } from "./csv.js";
export {
  formatSchemaContext,
  schemaContextExamples,
} from "./schema-context.js";
/** Pretty JSON of one validated result; schema outputs with optional keys are not `JsonValue`-typed, so any value serializes. */
export function formatJson<T>(value: T): Formatted<T> {
  return { text: JSON.stringify(value, null, 2), structuredContent: value };
}
export {
  ageInWords,
  formatDashboard,
  formatDashboardList,
  formatDashboardRender,
  type DashboardListOutput,
} from "./dashboards.js";
export {
  governingSentence,
  serverInstructions,
  toolDescriptions,
  toolExamples,
  toolExampleSchemas,
} from "./tool-descriptions.js";
