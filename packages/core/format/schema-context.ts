import type { z } from "zod";
import type { schemaOutputSchema } from "../schemas/rest.js";
import { sqlLimits } from "../schemas/sql.js";
import {
  traceEmbeddingViews,
  traceSqlFunctions,
  traceVectorFunctions,
  traceViewCatalog,
  traceViews,
  type TraceViewName,
} from "../sql.js";
import { dashboardParameterTypes } from "../dashboards/variables.js";
import {
  dashboardScopeSql,
  standardDashboardVariables,
} from "../dashboards/templates.js";

type Schema = z.infer<typeof schemaOutputSchema>;

/** Worked queries an assistant can adapt; each parses under the standard dashboard parameters. */
export const schemaContextExamples: readonly {
  title: string;
  answers: string;
  sql: string;
}[] = [
  {
    title: "Newest sessions",
    answers:
      "What the team worked on most recently, who ran each session, and in which repository and branch.",
    sql: "SELECT session_id, title, user_email, repo_name, branch, harness, started_at\nFROM sessions\nORDER BY started_at DESC\nLIMIT 50",
  },
  {
    title: "Search message content",
    answers:
      "Which sessions discussed database migrations, with the best-matching excerpt from each message.",
    sql: "SELECT s.session_id, s.title, m.seq, m.role, left(m.content, 200) AS excerpt\nFROM search_messages(q='database migration') AS h\nJOIN messages AS m ON m.session_id = h.session_id AND m.seq = h.seq\nJOIN sessions AS s ON s.session_id = h.session_id\nORDER BY h.rank DESC\nLIMIT 50",
  },
  {
    title: "Tool usage per repository",
    answers:
      "Which tools agents call in each repository over the last 30 days, ranked by the number of sessions that used them.",
    sql: "SELECT s.repo_name, t.tool_name, count() AS sessions\nFROM session_tools AS t\nJOIN sessions AS s ON s.session_id = t.session_id\nWHERE s.started_at >= now() - toIntervalDay(30)\nGROUP BY s.repo_name, t.tool_name\nORDER BY sessions DESC\nLIMIT 50",
  },
];

const catalogNames = new Set<string>([...traceViews, ...traceEmbeddingViews]);
const isCatalogView = (name: string): name is TraceViewName =>
  catalogNames.has(name);
const canonicalOrder = new Map<string, number>(
  [...traceViews, ...traceEmbeddingViews].map((name, index) => [name, index]),
);
const oneLine = (value: string) => value.replaceAll(/\s*\r?\n\s*/g, " ").trim();

/**
 * One self-contained Markdown reference an LLM can use to write SQL for the caller: who the
 * reader is and what the data is, the rules the query service enforces, every authorized
 * view with its purpose and every column with type and meaning, the table functions, how
 * views relate, the common patterns, three worked examples and the function allowlist.
 * Deterministic for a given schema, so the same organization always copies the same text.
 */
export function formatSchemaContext(schema: Schema): string {
  const views = new Map<string, Schema["columns"]>();
  for (const column of schema.columns) {
    const group = views.get(column.view_name) ?? [];
    group.push(column);
    views.set(column.view_name, group);
  }
  const orderedViews = [...views.entries()].sort(([a], [b]) => {
    const rankA = canonicalOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rankB = canonicalOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
    return rankA === rankB ? a.localeCompare(b) : rankA - rankB;
  });
  const hasSearch = schema.functions.some(
    (fn) => fn.function_name === "search_messages",
  );
  const hasSimilar = schema.functions.some(
    (fn) => fn.function_name === "similar_sessions",
  );
  // Vector views and functions reach the schema only for embeddings-enabled callers.
  const hasVectors =
    hasSimilar || traceEmbeddingViews.some((name) => views.has(name));
  const parameters = Object.entries(
    dashboardParameterTypes(standardDashboardVariables),
  ).map(([name, type]) => `\`{${name}:${type}}\``);
  const { rows, seconds } = sqlLimits;
  const responseKb = sqlLimits.responseBytes / 1024;
  const lines: string[] = [
    "# AgentCommons schema reference",
    "",
    "You are helping someone write SQL for AgentCommons, a searchable index of the coding-agent sessions their organization captured from Claude Code, Codex, Gemini CLI and pi. This is the authoritative schema reference for the read-only ClickHouse views their account can query (the `api_ro` database). Use it to construct queries for them: take view and column names only from the listing below, follow the rules, and adapt the patterns and examples to their question.",
    "",
    "## What the data is",
    "",
    "- A **session** is one run of a coding agent on one machine: who ran it, which harness and model, the repository and branch, when it started and ended, and counts of messages, tool calls, tokens and files. One row per session in `sessions`.",
    "- A **message** is one ordered block inside a session (`seq` ascending): a user prompt, assistant text or thinking, a tool call with its input, a tool result, or system metadata. One row per block in `messages`.",
    "- Sessions can have children (subagents, forks, spawned sessions) linked through `parent_session_id`. Other views derive files touched, tools used, observed commits, repositories, installations and reuse of prior sessions; the `metrics_*` views are analytics over the same data, most of them for admins.",
    "",
    "## Rules",
    "",
    "- ClickHouse SQL, exactly one SELECT statement per run. WITH, subqueries, JOIN, UNION, window functions and GROUP BY are allowed. No DDL, INSERT, `SETTINGS`, `FORMAT` or `INTO OUTFILE`.",
    "- Query only the `api_ro` views listed under Views (bare names resolve there) and the table functions listed under Table functions.",
    "- Use only the functions listed under Allowed functions; anything else is rejected.",
    `- Results stop at ${String(rows)} rows (the response says when it was capped), queries stop after ${String(seconds)} s, and the response is limited to ${String(responseKb)} KB with long cells truncated. End every query with ORDER BY and a LIMIT that fits the question.`,
    "- Every view is already scoped to the caller's organization and visibility. Never filter on `organization_id`.",
    "- `{name:Type}` query parameters are allowed only inside dashboard tiles (see Dashboard parameters). Ad-hoc queries on the SQL page use literal values.",
    "- Timestamps are `DateTime64(6, 'UTC')`. Bucket with `toStartOfDay()` or `toStartOfWeek()` and bound with `now() - toIntervalDay(n)`.",
    "- Filter `messages` by `role` and `kind` rather than pattern-matching content, and keep excerpts short with `left(content, 200)`.",
    "- Alias every aggregate (`count() AS sessions`) and group by the other selected columns.",
    "",
    "## Dashboard parameters",
    "",
    `Dashboard tiles may use query parameters written \`{name:Type}\`. The standard dashboard variables resolve to ${parameters.join(", ")}. Scope a tile to the selected time range with \`${dashboardScopeSql.time}\` and to the selected repositories, allowing all when none is picked, with \`${dashboardScopeSql.repo}\`.`,
    "",
    "## Views",
    "",
    "Each view lists its columns as `name Type: meaning`.",
    "",
  ];
  for (const [name, columns] of orderedViews) {
    lines.push(`### ${name}`, "");
    if (isCatalogView(name)) lines.push(traceViewCatalog[name].purpose, "");
    for (const column of [...columns].sort(
      (a, b) => a.ordinal_position - b.ordinal_position,
    )) {
      const description = column.description ? oneLine(column.description) : "";
      lines.push(
        `- ${column.column_name} ${oneLine(column.data_type)}${description ? `: ${description}` : ""}`,
      );
    }
    lines.push("");
  }
  lines.push("## Table functions", "");
  if (schema.functions.length === 0)
    lines.push("None are available to this caller.", "");
  for (const fn of schema.functions)
    lines.push(
      `- \`${fn.function_name}(${fn.arguments})\` returns \`${fn.result_type}\`.${fn.description ? ` ${oneLine(fn.description)}` : ""}`,
    );
  if (schema.functions.length > 0)
    lines.push(
      "",
      `Call table functions with named literal parameters only, for example \`${schema.functions[0]?.function_name ?? "search_messages"}(...)\`.${hasSearch ? " `search_messages(q='words')` returns one row per matching message with `session_id`, `seq` and `rank`; join `messages` on both `session_id` and `seq` for the content and `sessions` on `session_id` for the header, then order by `rank DESC`." : ""}`,
      "",
    );
  lines.push(
    "## Relationships",
    "",
    "- Per-session views join `sessions` on `session_id`: `messages`, `session_files`, `session_tools`, `session_observed_commits`, `session_reuse`, and every `metrics_*` view that has a `session_id` column.",
    "- `messages` already carries `session_title`, `repo_name`, `branch` and `user_email`, so message queries often need no join.",
    ...(hasSearch
      ? [
          "- `search_messages(q='words')` rows join `messages` on both `session_id` and `seq`, and `sessions` on `session_id`.",
        ]
      : []),
    "- `sessions.parent_session_id` points at another `sessions.session_id`; `parent_relation` says whether the child is a SUBAGENT, FORK or SPAWNED session.",
    "- `sessions.user_id` = `users.id`; `sessions.installation_id` = `installations.installation_id`; `sessions.repo_name` = `repos.repo_name`.",
    "- `reuse_edges.source_session_id` and `reuse_edges.target_session_id` are both `sessions.session_id`; `member_impact.user_id` = `users.id`.",
    ...(hasVectors
      ? [
          "- `session_embeddings.session_id` joins `sessions`; `message_chunks.message_id` joins `messages.message_id`. `similar_sessions(source='session UUID', max_rows=5)` rows join `sessions` on `session_id`.",
        ]
      : []),
    "",
    "## Useful patterns",
    "",
    "- Recent sessions: select from `sessions`, filter with `started_at >= now() - toIntervalDay(7)`, `repo_name = 'owner/repo'`, `user_email = 'person@example.com'` or `harness = 'CLAUDE_CODE'`, and `ORDER BY started_at DESC`.",
    hasSearch
      ? "- Search messages by words: `FROM search_messages(q='words') AS h JOIN messages AS m ON m.session_id = h.session_id AND m.seq = h.seq`, ordered by `h.rank DESC`. For an exact substring use `positionCaseInsensitive(content, 'phrase') > 0` on `messages`."
      : "- Search messages by words: filter `messages` with `hasTokenCaseInsensitive(content, 'word')` or `positionCaseInsensitive(content, 'phrase') > 0`.",
    "- Tool usage per repository: join `session_tools` to `sessions` and `GROUP BY repo_name, tool_name`; `tool_call_count` on `sessions` gives totals per session.",
    "- Reuse of prior work: `session_reuse` counts readers per session, `reuse_edges` says which session read which, `metrics_reuse_weekly` gives the weekly rate and `member_impact` ranks members.",
    "- Activity over time: `GROUP BY toStartOfDay(started_at)` or `toStartOfWeek(started_at)` on `sessions`, per person with `user_email`, per repository with `repo_name`.",
    ...(hasSimilar
      ? [
          "- Similar sessions: `FROM similar_sessions(source='<session_id>', max_rows=5) AS n JOIN sessions AS s ON s.session_id = n.session_id ORDER BY n.distance ASC`; the source session is excluded.",
        ]
      : []),
    "",
    "## Example queries",
    "",
  );
  for (const example of schemaContextExamples)
    lines.push(
      `### ${example.title}`,
      "",
      `Answers: ${example.answers}`,
      "",
      "```sql",
      example.sql,
      "```",
      "",
    );
  lines.push(
    "## Allowed functions",
    "",
    "Only these scalar, aggregate and window function names pass the guard (case-insensitive). Table, dictionary, file, URL and system functions are rejected:",
    "",
    traceSqlFunctions.join(", "),
    "",
    ...(hasVectors
      ? [
          `With embeddings enabled, the vector functions ${traceVectorFunctions.map((name) => `\`${name}\``).join(" and ")} are also allowed on \`embedding\` columns.`,
          "",
        ]
      : []),
  );
  return lines.join("\n");
}
