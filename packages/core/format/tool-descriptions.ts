import { getToolInputSchema } from "../schemas/get.js";
import { searchToolInputSchema } from "../schemas/search.js";
import { sqlInputSchema } from "../schemas/sql.js";

/**
 * The read tools' catalog text (§8.2, ADR 0057, ADR 0070). Descriptions are action-first
 * and each ends with one worked example; the examples are data here so a unit test parses
 * them with the very schemas the calls are validated against, and the byte budget of
 * ADR 0053 is measured on the same strings the server ships. The governing sentence is
 * prepended by the catalog; `serverInstructions` is what `initialize` returns.
 */
export const governingSentence =
  "Use this to check prior work before changing code, and whenever the user asks about earlier sessions; run long investigations in a subagent that returns only findings with session ids.";
/**
 * Server `instructions` returned by `initialize`. Claude Code places them in its system
 * prompt, so this is where an agent learns to look before it edits.
 */
export const serverInstructions =
  "AgentCommons indexes this organization's past coding-agent sessions (search, get, sql). Before changing code, search for the test, file path or error you were given: an earlier session often holds the root cause, the library the team chose or the exact value; read a hit with get and cite its session_id. Also use it whenever the user asks about prior work. Keep long investigations in a subagent that returns only findings and session ids.";

export const toolExamples = {
  search: {
    query: "payments retry",
    filters: { file_prefix: "src/payments", file_operation: "edit" },
  },
  get: { session_id: "01a08fd7-9907-72a3-9135-80162670d93a", from: 0, to: 40 },
  sql: {
    sql: "SELECT session_id,title,started_at FROM sessions WHERE repo_name = 'github.com/acme/orders-api' ORDER BY started_at DESC LIMIT 20",
  },
} as const;
/** The schemas the examples must satisfy: the advertised search shape, the get and sql inputs. */
export const toolExampleSchemas = {
  search: searchToolInputSchema,
  get: getToolInputSchema,
  sql: sqlInputSchema,
} as const;
const example = (name: keyof typeof toolExamples) =>
  JSON.stringify(toolExamples[name]);

export const toolDescriptions: Readonly<
  Record<"search" | "get" | "sql", string>
> = {
  search: `Find the earlier sessions about a test, file, error, library or value: the first call for "has anyone…", "why does…" and "how did we…" questions and before any change. Put 2 to 4 specific words from your task in query (a test name, file path, identifier, error text or component); every word must appear (English inflections share a stem), so a whole sentence finds nothing while its key words do. Results are message excerpts grouped by session with each session_id; open the best one with get. Filters take one value or a list (any of), all must hold: repo_name is host/org/repo as git names the remote or the bare repository name; file_prefix with file_operation selects sessions that touched a file. Example, "why does the payments client retry the way it does?": ${example("search")}.`,
  get: `Open one session by session_id, usually the best search hit: a header (who ran it, harness, model, repository, branch, start, end, status, message, tool call, token, file, commit and reuse counts, tools_used, root_session_id, parent and child sessions) and its messages in seq order with role, kind, tool_name, tool_use_id and content. Each child ref carries parent_tool_use_id, the tool_use_id of the TOOL_USE message here that spawned it (null when unrecorded), so a subagent run reads in place under its call. Bound a range with from/to; when next is not null, pass it as cursor. Example, the first 40 messages: ${example("get")}.`,
  sql: `Answer questions search cannot, with one read-only ClickHouse SELECT over api_ro: who worked on a repository, which sessions touched a file, counts over time. Views: sessions (session metadata); messages (normalized messages); session_files (observed files: path, ops); session_observed_commits (commit observations); session_tools (tool counts); users (visible contributors); installations (visible devices); repos (visible repository counts); schema_columns (column descriptions); schema_functions (function descriptions). search_messages(q='words') returns uncapped session_id,seq,rank. Discover columns with SELECT * FROM schema_columns WHERE view_name = 'sessions' and every table function this organization can use with SELECT * FROM schema_functions. Limits: 500 rows, 5 seconds. Example, the newest sessions of one repository: ${example("sql")}.`,
};
