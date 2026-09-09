import type { traceEmbeddingViews, traceViews } from "./sql.js";

export type TraceViewName =
  (typeof traceViews)[number] | (typeof traceEmbeddingViews)[number];

export interface TraceViewDescription {
  /** One line on what a row of the view is and when to use it. */
  purpose: string;
  /** Short meaning of every column, keyed by the `api_ro` column name. */
  columns: Readonly<Record<string, string>>;
}

const scoped = "Owning organization (already scoped)";
const sessionKey = "Session; joins sessions.session_id";
const repoOfSession = "Repository of the session";
const startedAt = "When the session started (UTC)";

/**
 * Human meaning of every `api_ro` view and column, as data. `schema_columns` serves the
 * column text (after any native column comment) and the assistant briefing prints the
 * purposes, so agents, the dashboard explorer and copied references read one source.
 * Keep entries short and free of trailing periods; the integration test fails when a
 * native column has no entry or an entry names a column that no longer exists.
 */
export const traceViewCatalog: Readonly<
  Record<TraceViewName, TraceViewDescription>
> = {
  sessions: {
    purpose:
      "One row per captured coding-agent session: who ran it, where, when, and message, tool, token and file counts",
    columns: {
      session_id: "Primary key; every other view joins on it",
      organization_id: scoped,
      harness: "Agent product: CLAUDE_CODE, CODEX, GEMINI_CLI or PI",
      harness_session_id: "Session id assigned by the harness",
      harness_version: "Harness version, if reported",
      entrypoint: "How the harness was launched, if reported",
      user_id: "Member who ran the session; joins users.id",
      ingest_api_key_id: "API key that uploaded the session",
      installation_id:
        "Machine install that captured it; joins installations.installation_id",
      cwd: "Working directory of the agent",
      repo_root: "Git repository root containing cwd, if any",
      cwd_relative: "cwd relative to repo_root",
      repo_url: "Remote URL of the repository",
      repo_name: "Repository name such as owner/repo; joins repos.repo_name",
      branch: "Git branch at session start",
      start_commit: "HEAD SHA at session start",
      end_commit: "HEAD SHA at session end",
      observed_commits:
        "JSON array of commits made during the session; see session_observed_commits",
      observed_diff_stat: "JSON diff statistics observed during the session",
      dirty_file_count: "Uncommitted changed files observed",
      model: "Primary model used",
      models_used: "Every model seen in the session",
      started_at: startedAt,
      ended_at: "When the session ended; NULL while active",
      last_activity_at: "Last captured activity",
      status: "ACTIVE, ENDED or INACTIVE",
      end_reason: "Why the session ended, as the harness reported it",
      title: "Short title derived from the session",
      first_prompt: "First user prompt",
      parent_session_id:
        "Parent session of a subagent, fork or spawned session",
      parent_relation: "SUBAGENT, FORK or SPAWNED",
      parent_native_ref: "Harness reference to the parent (admins only)",
      parent_tool_use_id:
        "Parent tool_use_id of the call that spawned this child; NULL when unrecorded",
      agent_type: "Subagent type when the session is a subagent",
      message_count: "Rows in messages for this session",
      tool_call_count: "Tool calls made",
      input_tokens: "Input tokens consumed",
      output_tokens: "Output tokens produced",
      tools_used: "Distinct tool names called; see session_tools",
      visibility: "PUBLIC or PRIVATE",
      purged_at: "When content was purged; NULL otherwise",
      user_email: "Email of the member who ran it",
      user_name: "Display name of that member",
      installation_hostname: "Hostname of the capturing machine",
      parent_title: "Title of the parent session",
      child_count: "Direct child sessions",
      file_count: "Files read, edited, written or deleted; see session_files",
      duration_seconds: "Seconds from start to end or last activity",
      observed_commit_count: "Commits observed during the session",
      reuse_count: "Later sessions that read this one; see session_reuse",
    },
  },
  messages: {
    purpose:
      "One row per ordered block inside a session: prompts, assistant text and thinking, tool calls with input, tool results and metadata",
    columns: {
      message_id: "Primary key of the block",
      organization_id: scoped,
      session_id: sessionKey,
      raw_record_id: "Raw harness record the block came from",
      ingest_batch_id: "Upload batch that delivered it",
      seq: "Position of the block within the session, ascending",
      block_index:
        "Position within the source record when one record yields several blocks",
      role: "USER, ASSISTANT, TOOL_RESULT or SYSTEM",
      kind: "TEXT, THINKING, TOOL_USE, TOOL_RESULT or META",
      content:
        "Redacted text of the block; tool results and metadata are stored as text",
      tool_name: "Tool called or answered, for TOOL_USE and TOOL_RESULT",
      tool_use_id: "Harness id pairing a tool call with its result",
      tool_input: "JSON input of a TOOL_USE block",
      model: "Model that produced the block",
      timestamp: "When the harness recorded the block",
      received_at: "When the server received it",
      input_tokens: "Input tokens reported for the block",
      output_tokens: "Output tokens reported for the block",
      agent_id: "Subagent id when a subagent produced the block",
      native_id: "Harness record id",
      parent_native_id:
        "Harness id of the parent record in tree-shaped transcripts",
      searchable: "Whether search_messages indexes the block",
      search_text: "Stemmed lowercase text that search_messages matches",
      session_title: "Title of the session",
      repo_name: repoOfSession,
      branch: "Branch of the session",
      user_email: "Email of the member who ran the session",
    },
  },
  session_files: {
    purpose:
      "One row per file a session read, edited, wrote or deleted; the file_prefix and file_operation filters select from it",
    columns: {
      organization_id: scoped,
      session_id: sessionKey,
      file_id: "Stable id of the file within the session",
      path: "File path as the agent used it",
      ops: "Operations on the file: read, edit, write or delete",
    },
  },
  session_observed_commits: {
    purpose: "One row per commit observed while a session ran",
    columns: {
      organization_id: scoped,
      session_id: sessionKey,
      ordinal: "Position in the session's commit list",
      sha: "Commit SHA",
      subject: "Commit subject line",
      author: "Commit author",
      timestamp: "Commit time as git reported it (text)",
    },
  },
  session_tools: {
    purpose: "One row per session and distinct tool name it called",
    columns: {
      organization_id: scoped,
      session_id: sessionKey,
      tool_name: "Tool name as the harness reports it, such as Read or Bash",
    },
  },
  users: {
    purpose: "Members who ran at least one visible session",
    columns: {
      id: "Member id; matches sessions.user_id",
      email: "Email address",
      name: "Display name",
    },
  },
  installations: {
    purpose:
      "One row per machine install of the hook that captured visible sessions",
    columns: {
      organization_id: scoped,
      installation_id: "Install id; matches sessions.installation_id",
      hostname: "Machine hostname",
      os_user: "Operating-system user",
      platform: "Operating system, such as darwin or linux",
      arch: "CPU architecture",
      hook_sha256: "SHA-256 of the installed hook script",
      tools_enabled: "Whether the AgentCommons MCP tools are installed there",
      first_seen_at: "Earliest session start",
      last_seen_at: "Latest session activity",
      session_count: "Visible sessions captured",
    },
  },
  repos: {
    purpose: "One row per repository with session and contributor counts",
    columns: {
      organization_id: scoped,
      repo_name: "Repository name; matches sessions.repo_name",
      repo_url: "Remote URL",
      session_count: "Sessions in the repository",
      user_count: "Distinct members who ran them",
      first_seen_at: "Earliest session start",
      last_activity_at: "Latest session activity",
    },
  },
  schema_columns: {
    purpose:
      "This catalog: every visible view column with type, position and description",
    columns: {
      view_name: "View the column belongs to",
      column_name: "Column name",
      data_type: "ClickHouse type",
      ordinal_position: "1-based column position",
      description: "Short meaning of the column",
    },
  },
  schema_functions: {
    purpose:
      "Table functions the caller may use, with parameters and result columns",
    columns: {
      function_name: "Function name",
      arguments: "Named parameters and types, such as q=String",
      result_type: "Result columns and types",
      description: "How to use the function",
    },
  },
  reuse_edges: {
    purpose:
      "One row per time a running session read another session through the API (reuse of prior work)",
    columns: {
      source_session_id: "Session that did the reading",
      target_session_id: "Session that was read",
      read_at: "When the read happened",
      reader_user_id: "Member who ran the reading session",
      reader_email: "Email of that member",
      reader_harness: "Harness of the reading session",
      audit_id: "Audit event of the read",
    },
  },
  session_reuse: {
    purpose: "Per session, how often later sessions read it",
    columns: {
      session_id: "Session that was read",
      reuse_count: "Distinct sessions that read it",
      unique_readers: "Distinct members who read it",
      cross_user_reuse_count: "Reads by other members' sessions",
      last_reused_at: "Most recent read",
    },
  },
  member_impact: {
    purpose:
      "Per member, how much others reused their sessions and how much they reused others'",
    columns: {
      user_id: "Member; matches users.id",
      sessions_reused_by_others: "Their sessions that other sessions read",
      distinct_readers: "Distinct members who read their sessions",
      reuses_made: "Reads their sessions made of other sessions",
    },
  },
  metrics_active_windows: {
    purpose:
      "Time windows during which a session was active on its machine; attributes API reads to sessions",
    columns: {
      session_id: sessionKey,
      installation_id: "Machine the session ran on",
      active_from: "Window start",
      active_to: "Window end, at most 6 hours after the start",
    },
  },
  metrics_reads: {
    purpose:
      "Successful search, get and sql reads from the audit log with the sessions they touched; admins see every action, members their gets",
    columns: {
      id: "Audit event id",
      ts: "When the read happened",
      user_id: "Member who read",
      user_email: "Email of that member",
      installation_id: "Machine the reading key was attributed to",
      transport: "rest, mcp or web",
      auth_method: "key or cookie",
      action: "search, get or sql",
      target_session_id: "Session a get fetched",
      target_user_id: "Owner of that session",
      repo_name: "Repository of the fetched session",
      result_session_ids: "Sessions a search returned",
      top_session_id: "First session returned",
      top_user_id: "Owner of the first result",
      hits: "Number of search hits",
    },
  },
  metrics_reuse_sessions: {
    purpose:
      "Per visible session, whether it read prior sessions; admins also see whether it used the API at all",
    columns: {
      session_id: sessionKey,
      organization_id: scoped,
      started_at: startedAt,
      repo_name: repoOfSession,
      user_id: "Member who ran it",
      installation_id: "Machine it ran on",
      reused: "1 when the session read at least one prior session",
      cross_user_reused: "1 when it read another member's session",
      memory_assisted:
        "1 when it made any search, get or sql call (admins only)",
    },
  },
  metrics_search_sessions: {
    purpose:
      "Per session, how often it searched AgentCommons versus other search tools",
    columns: {
      session_id: sessionKey,
      started_at: startedAt,
      repo_name: repoOfSession,
      harness: "Harness of the session",
      user_id: "Member who ran it",
      agentcommons_search_calls: "Calls to the AgentCommons search tool",
      repeat_agentcommons_search_calls:
        "AgentCommons searches after the first one",
      subsequent_other_search_calls:
        "Grep, glob or web searches after the first AgentCommons search",
    },
  },
  metrics_reuse_weekly: {
    purpose: "Weekly sessions and the share that read prior sessions",
    columns: {
      week: "Monday of the week (UTC)",
      sessions: "Sessions started that week",
      reuse_sessions: "Sessions that read a prior session",
      cross_user_reuse_sessions: "Sessions that read another member's session",
      reuse_rate: "reuse_sessions divided by sessions",
      cross_user_reuse_rate: "cross_user_reuse_sessions divided by sessions",
    },
  },
  metrics_health: {
    purpose: "Per session capture health flags (admins only)",
    columns: {
      session_id: sessionKey,
      started_at: startedAt,
      last_activity_at: "Last captured activity",
      repo_name: repoOfSession,
      harness: "Harness of the session",
      user_id: "Member who ran it",
      installation_id: "Machine it ran on",
      authorization_blocked:
        "Whether uploads from the session were rejected for authorization",
    },
  },
  metrics_capture: {
    purpose:
      "Capture latency per raw record: harness timestamp versus server arrival (admins only)",
    columns: {
      raw_record_id: "Raw harness record",
      session_id: sessionKey,
      started_at: startedAt,
      repo_name: repoOfSession,
      timestamp: "When the harness recorded the message",
      received_at: "When the server received it",
      latency_seconds: "received_at minus timestamp",
    },
  },
  metrics_activity: {
    purpose: "One row per accepted upload receipt (admins only)",
    columns: {
      session_id: sessionKey,
      installation_id: "Machine that uploaded",
      received_at: "When the upload arrived",
      repo_name: repoOfSession,
    },
  },
  metrics_redaction: {
    purpose: "Redaction matches per policy and upload (admins only)",
    columns: {
      policy_id: "Redaction policy that matched",
      count: "Matches in the upload",
      created_at: "When the upload arrived",
      repo_name: repoOfSession,
    },
  },
  metrics_members: {
    purpose: "Current member count of the organization (admins only)",
    columns: {
      member_count: "Members in the organization",
    },
  },
  metrics_usage: {
    purpose:
      "Per read, whether it crossed members and led to opening a result (admins only)",
    columns: {
      id: "Audit event id",
      ts: "When the read happened",
      user_id: "Member who read",
      installation_id: "Machine the reading key was attributed to",
      transport: "rest, mcp or web",
      auth_method: "key or cookie",
      action: "search, get or sql",
      repo_name: "Repository of the reading session or of the top result",
      hits: "Number of search hits",
      cross_user_hit: "1 when the top result belongs to another member",
      followed_through: "1 when a result was opened within 10 minutes",
    },
  },
  metrics_mcp_calls: {
    purpose: "MCP tool calls by tool name (admins only)",
    columns: {
      id: "Audit event id",
      ts: "When the call happened",
      action:
        "Tool name: search, get, sql, set_visibility, purge, audit or status",
      repo_name: "Repository of the calling session",
    },
  },
  metrics_dashboard: {
    purpose: "Browser dashboard actions from the audit log (admins only)",
    columns: {
      id: "Audit event id",
      ts: "When the action happened",
      user_id: "Member who acted",
      action: "Audit action name",
      repo_name: "Repository of the session involved",
    },
  },
  metrics_outcomes: {
    purpose:
      "Per session outcome signals: commits, near duplicates and rerun loops (admins only)",
    columns: {
      session_id: sessionKey,
      started_at: startedAt,
      repo_name: repoOfSession,
      tools_enabled: "Whether the capturing machine has the MCP tools",
      tool_call_count: "Tool calls made",
      tokens: "input_tokens plus output_tokens",
      duration_seconds: "Seconds from start to end or last activity",
      observed_commit: "1 when the ended session produced a commit",
      near_duplicate:
        "1 when another member started a similar session in the same repository within 30 days",
      rerun_loop: "1 when the same test or build command failed at least twice",
    },
  },
  metrics_own_zero_results: {
    purpose: "The caller's own searches that returned no hits",
    columns: {
      search_id: "Audit event id",
      searched_at: "When the search ran",
      query: "Search text",
    },
  },
  message_chunks: {
    purpose: "Embedded text chunks of messages (embeddings enabled only)",
    columns: {
      organization_id: scoped,
      session_id: sessionKey,
      chunk_id: "Primary key of the chunk",
      message_id: "Message the chunk came from; joins messages.message_id",
      ordinal: "Chunk position within the message",
      content: "Chunk text",
      content_hash: "Hash of the chunk text",
      token_count: "Tokens in the chunk",
      model: "Embedding model",
      embedding: "Vector; compare with cosineDistance",
    },
  },
  session_embeddings: {
    purpose: "One embedding vector per session (embeddings enabled only)",
    columns: {
      organization_id: scoped,
      session_id: sessionKey,
      model: "Embedding model",
      token_count: "Tokens embedded",
      updated_at: "When the vector was last computed",
      embedding: "Vector; compare with cosineDistance or use similar_sessions",
    },
  },
};

/** `view.column` keys with their descriptions, in catalog order, for SQL lookups and tests. */
export function traceColumnDescriptions(): readonly {
  view: TraceViewName;
  column: string;
  description: string;
}[] {
  return (
    Object.entries(traceViewCatalog) as [TraceViewName, TraceViewDescription][]
  ).flatMap(([view, entry]) =>
    Object.entries(entry.columns).map(([column, description]) => ({
      view,
      column,
      description,
    })),
  );
}
