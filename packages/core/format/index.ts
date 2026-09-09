export {
  repositoryLinks,
  messageBranches,
  spawnPlacements,
} from "./session-navigation.js";
export type { SpawnedRun } from "./session-navigation.js";
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
export function formatSearch(result: SearchOutput): Formatted<SearchOutput> {
  const count = new Set(result.blocks.map((block) => block.session_id)).size;
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
        ...(message.truncated ? ["[truncated]"] : []),
        ...(message.truncated_fields.length
          ? [`truncated_fields=${JSON.stringify(message.truncated_fields)}`]
          : []),
      ];
      return `${metadata.join(" ")}\n${message.content}`;
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
    `${String(count)} ${count === 1 ? "session" : "sessions"}`,
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
export function formatSessionHeader(header: SessionHeader): string {
  const facts = Object.entries(header).map(
    ([key, value]) => `${key}: ${inline(value)}`,
  );
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
    `message_id: ${message.message_id} | raw_record_id: ${inline(message.raw_record_id)} | ingest_batch_id: ${inline(message.ingest_batch_id)}`,
    `input_tokens: ${inline(message.input_tokens)} | output_tokens: ${inline(message.output_tokens)}`,
    ...(message.content_cursor === null
      ? []
      : [`content_cursor: ${JSON.stringify(message.content_cursor)}`]),
    ...(message.truncated_fields.length
      ? [`truncated_fields: ${JSON.stringify(message.truncated_fields)}`]
      : []),
  ];
  return `${metadata.join(" ")}\n${message.content}\n${details.join("\n")}`;
}
export function formatGet(result: GetOutput): Formatted<GetOutput> {
  const text = [
    formatSessionHeader(result.header),
    ...result.messages.map(formatMessage),
    ...(result.next === null ? [] : [`next: ${JSON.stringify(result.next)}`]),
  ].join("\n\n");
  return { text, structuredContent: result };
}
export function formatSql(result: SqlOutput): Formatted<SqlOutput> {
  const cell = (item: JsonValue) => inline(item).replaceAll("|", "\\|");
  const text = [
    `${String(result.row_count)} ${result.row_count === 1 ? "row" : "rows"}${result.capped ? " (capped)" : ""}`,
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
