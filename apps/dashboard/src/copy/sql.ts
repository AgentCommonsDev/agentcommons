/** Strings for the SQL page: explorer, editor, status line, results and assistant context. */
export const sqlCopy = {
  title: "SQL",
  description:
    "Query this organization's sessions with ClickHouse SQL over read-only views. One SELECT per run, 500 rows, 5 seconds.",
  explorer: {
    title: "Schema",
    open: "Schema",
    search: "Search views and columns",
    searchPlaceholder: "Find a view or column",
    views: "Views",
    functions: "Functions",
    columns: "columns",
    noMatches: "Nothing matches",
    noMatchesHint: "Try another word. Names and descriptions are searched.",
    expand: "Show columns",
    collapse: "Hide columns",
    insert: "Insert into the editor",
    returns: "Returns",
    copyContext: "Copy for your assistant",
    copyContextHint:
      "Schema, rules and examples an AI assistant can use to write queries for you.",
    unavailable:
      "The schema could not be loaded, so completion and the explorer are empty.",
  },
  editor: {
    label: "SQL query",
    run: "Run",
    running: "Running…",
    shortcutMac: "⌘ ↵",
    shortcutOther: "Ctrl ↵",
    examples: "Examples",
    history: "History",
    historyEmpty: "Queries you run appear here.",
    clearHistory: "Clear history",
    copyQuery: "Copy query",
    help: "Suggestions appear as you type. Escape closes them, Tab leaves the editor.",
  },
  status: {
    ready: "Ready",
    running: "Running…",
    syntaxError: "Syntax error",
    unavailable: "Not available",
    queryError: "Query failed",
    atLine: "at line",
    column: "column",
    checking: "Checking…",
    ranIn: "Ran in",
  },
  results: {
    title: "Results",
    label: "Query results",
    rows: "rows",
    row: "row",
    ms: "ms",
    capped:
      "The result stopped at the 500-row limit. Add a WHERE clause or a smaller LIMIT to see everything.",
    truncated:
      "Long cells were cut by the server. Select fewer columns or shorter fields to see full values.",
    copyText: "Copy as text",
    csv: "Download CSV",
    csvName: "query-results.csv",
    empty: "Results appear here",
    emptyHint:
      "Write a SELECT over the views on the left, or start from an example. Cmd or Ctrl+Enter runs the query.",
    emptyHintMobile:
      "Write a SELECT over the views in the schema panel, or start from an example.",
    openSession: "Open session",
    null: "NULL",
  },
  examples: [
    {
      label: "Recent sessions",
      description: "The newest sessions with who ran them and where.",
      sql: "SELECT session_id, title, user_email, repo_name, branch, harness, started_at\nFROM sessions\nORDER BY started_at DESC\nLIMIT 50",
    },
    {
      label: "Search messages",
      description:
        "Full-text search over message content, joined back to sessions.",
      sql: "SELECT s.session_id, s.title, m.seq, m.role, left(m.content, 200) AS excerpt\nFROM search_messages(q='migration') AS h\nJOIN messages AS m ON m.session_id = h.session_id AND m.seq = h.seq\nJOIN sessions AS s ON s.session_id = h.session_id\nORDER BY h.rank DESC\nLIMIT 50",
    },
    {
      label: "Tool usage",
      description: "Which tools agents call most, and in how many sessions.",
      sql: "SELECT tool_name, count() AS sessions\nFROM session_tools\nGROUP BY tool_name\nORDER BY sessions DESC\nLIMIT 25",
    },
    {
      label: "Activity by repository",
      description: "Sessions and people per repository over the last 30 days.",
      sql: "SELECT repo_name, count() AS sessions, uniq(user_email) AS people, sum(message_count) AS messages\nFROM sessions\nWHERE started_at >= now() - toIntervalDay(30)\nGROUP BY repo_name\nORDER BY sessions DESC\nLIMIT 25",
    },
    {
      label: "Sessions per day",
      description:
        "Daily captured sessions and average duration, last two weeks.",
      sql: "SELECT toStartOfDay(started_at) AS day, count() AS sessions, round(avg(duration_seconds)) AS avg_seconds\nFROM sessions\nWHERE started_at >= now() - toIntervalDay(14)\nGROUP BY day\nORDER BY day",
    },
  ],
} as const;
