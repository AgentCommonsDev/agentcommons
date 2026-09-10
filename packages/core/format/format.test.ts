import { describe, expect, it } from "vitest";
import { formatGet, formatMessage, formatSearch, formatSql } from "./index.js";
import {
  messageSchema,
  type GetOutput,
  type Message,
  type SessionHeader,
} from "../schemas/get.js";
import { searchOutputSchema, type SearchOutput } from "../schemas/search.js";
import type { SqlOutput } from "../schemas/sql.js";

const sessionId = "0192a3f0-7c1e-7d1a-9b0e-3f2a1c9d4e55";
const nestedSessionId = "0192a3f0-7c1e-7d1a-9b0e-3f2a1c9d4e77";
const timestamp = "2026-08-01T00:00:00Z";
const header: SessionHeader = {
  session_id: sessionId,
  organization_id: "org-a",
  title: "Investigate retry failure",
  harness: "CODEX",
  harness_version: "0.150.0",
  entrypoint: "cli",
  model: "gpt-5",
  models_used: ["gpt-5"],
  user_email: "person@example.com",
  visibility: "PUBLIC",
  purged_at: null,
  installation_hostname: "workstation",
  installation_id: sessionId,
  repo_name: "host/org/repo",
  repo_url: "host/org/repo",
  branch: "main",
  cwd_relative: "apps/api",
  start_commit: "abc",
  end_commit: "def",
  started_at: timestamp,
  ended_at: null,
  status: "ACTIVE",
  end_reason: null,
  message_count: 2,
  tool_call_count: 1,
  input_tokens: "9007199254740993",
  output_tokens: null,
  tools_used: ["Bash"],
  file_count: 1,
  observed_commit_count: 2,
  reuse_count: 2,
  agent_type: null,
  parent_session_id: null,
  parent_relation: null,
  parent_tool_use_id: null,
  parent: null,
  children: [],
  child_count: 0,
  children_truncated: false,
  truncated_fields: [],
  root_session_id: sessionId,
};
const get: GetOutput = {
  header,
  messages: [
    {
      message_id: sessionId,
      session_id: sessionId,
      raw_record_id: sessionId,
      ingest_batch_id: null,
      seq: 2,
      role: "ASSISTANT",
      kind: "THINKING",
      content: "Check the final retry.",
      content_cursor: { seq: 2, offset: 4096 },
      tool_name: null,
      tool_use_id: null,
      model: "gpt-5",
      timestamp: null,
      received_at: timestamp,
      input_tokens: null,
      output_tokens: null,
      agent_id: null,
      truncated_fields: [],
    },
  ],
  next: { seq: 2, offset: 4096 },
};
const search: SearchOutput = {
  blocks: [
    {
      session_id: sessionId,
      root_session_id: sessionId,
      parent_relation: null,
      agent_type: null,
      parent_tool_use_id: null,
      title: header.title,
      harness: "CODEX",
      model: "gpt-5",
      repo_name: header.repo_name,
      branch: "main",
      user_email: header.user_email,
      started_at: timestamp,
      truncated_fields: [],
      messages: [
        {
          seq: 2,
          role: "TOOL_RESULT",
          kind: "TOOL_RESULT",
          tool_name: "Bash",
          tool_use_id: "call-1",
          content: "FAILED retry.test.ts",
          hit: true,
          truncated: true,
          content_range: { start: 4096, end: 4396, total: 13745 },
          truncated_fields: [],
        },
      ],
    },
  ],
  cursor: "next-search-page",
  truncated_response: true,
  total: { sessions: 4, hits: 12 },
};
describe("shared text and structured formatters", () => {
  it("formats search blocks with exact session/sequence identities, hit markers, and continuation", () => {
    const formatted = formatSearch(search);
    expect(formatted.structuredContent).toEqual(search);
    expect(formatted.text).toContain(`session_id: ${sessionId}`);
    // @req R-SRCH-15: an excerpt names its byte range and marks both cut ends inline.
    expect(formatted.text).toContain(
      "seq 2 TOOL_RESULT TOOL_RESULT tool_name=Bash tool_use_id=call-1 [hit] [truncated 4096-4396 of 13745]\n…FAILED retry.test.ts…",
    );
    const block0 = search.blocks[0];
    const message0 = block0?.messages[0];
    if (!block0 || !message0) throw new Error("fixture message");
    const variants = (patch: Partial<typeof message0>) =>
      formatSearch({
        ...search,
        blocks: [{ ...block0, messages: [{ ...message0, ...patch }] }],
      }).text;
    // The head of a message: no leading ellipsis; the tail: no trailing one.
    expect(
      variants({ content_range: { start: 0, end: 300, total: 900 } }),
    ).toContain("[hit] [truncated 0-300 of 900]\nFAILED retry.test.ts…");
    expect(
      variants({ content_range: { start: 600, end: 900, total: 900 } }),
    ).toContain("[truncated 600-900 of 900]\n…FAILED retry.test.ts\n");
    // A complete message carries neither the flag nor a marker.
    expect(variants({ truncated: false, content_range: null })).toContain(
      "[hit]\nFAILED retry.test.ts\n",
    );
    expect(formatted.text).toContain('cursor: "next-search-page"');
    expect(formatted.text).not.toMatch(
      /duration_ms|rank|score|root_session_id/,
    );
    const block = search.blocks[0];
    if (!block) throw new Error("fixture block");
    const nested = formatSearch({
      ...search,
      blocks: [
        {
          ...block,
          session_id: nestedSessionId,
          root_session_id: sessionId,
          parent_relation: "SUBAGENT",
          agent_type: "Explore",
          parent_tool_use_id: "call-1",
        },
      ],
    });
    expect(nested.text).toContain(
      `root_session_id: ${sessionId} | parent_relation: SUBAGENT | agent_type: Explore | parent_tool_use_id: call-1`,
    );
    // Formatters render an already-validated value; the output schema the adapters
    // parse with is what keeps internal ranks out of the contract.
    expect(searchOutputSchema.safeParse({ ...search, rank: 0.8 }).success).toBe(
      false,
    );
  });
  // @req R-DASH-37
  it("opens with the query's whole hit and session totals and prints an empty result honestly", () => {
    // The first line reports every match, not the sessions on this page.
    expect(
      formatSearch({
        ...search,
        blocks: [...search.blocks, ...search.blocks],
      }).text.startsWith("12 hits in 4 sessions\n"),
    ).toBe(true);
    expect(
      formatSearch({ ...search, total: { sessions: 1, hits: 1 } }).text,
    ).toMatch(/^1 hit in 1 session\n/);
    expect(
      formatSearch({
        blocks: [],
        cursor: null,
        truncated_response: false,
        total: { sessions: 0, hits: 0 },
      }).text,
    ).toBe("0 hits in 0 sessions");
  });
  // @req R-GET-03 @req R-GET-06
  it("includes every header fact an agent uses, nullable usage, thinking, and message continuation", () => {
    const formatted = formatGet(get);
    expect(formatted.structuredContent).toEqual(get);
    for (const key of Object.keys(header))
      if (key === "organization_id" || key === "installation_id")
        expect(formatted.text).not.toContain(`${key}:`);
      else expect(formatted.text).toContain(`${key}:`);
    expect(formatted.text).toContain("input_tokens: 9007199254740993");
    expect(formatted.text).toContain("reuse_count: 2");
    expect(formatted.text).toContain("output_tokens: null");
    expect(formatted.text).toContain("seq 2 ASSISTANT THINKING");
    expect(formatted.text).toContain('content_cursor: {"seq":2,"offset":4096}');
    expect(formatted.text).toContain('next: {"seq":2,"offset":4096}');
    // Record and batch ids stay in the JSON; a message without recorded usage has no
    // token line; a continuation page carries one header line, not the full header.
    expect(formatted.text).not.toContain("raw_record_id");
    expect(formatted.text).not.toContain("ingest_batch_id");
    expect(formatted.text).toContain(
      `message_id: ${get.messages[0]?.message_id ?? ""}`,
    );
    const quiet = formatMessage({
      ...(get.messages[0] as Message),
      input_tokens: null,
      output_tokens: null,
    });
    expect(quiet).not.toContain("input_tokens");
    const continued = formatGet(get, { continuation: true }).text;
    expect(continued.startsWith(`session ${header.session_id} | title:`)).toBe(
      true,
    );
    expect(continued).toContain("| continued");
    expect(continued).not.toContain("repo_url:");
    expect(continued).toContain("seq 2 ASSISTANT THINKING");
  });
  // @req R-GET-03
  it("names child sessions so agents can follow subagent runs", () => {
    const childId = "0192a3f0-7c1e-7d1a-9b0e-3f2a1c9d4e66";
    const withChildren: SessionHeader = {
      ...header,
      child_count: 3,
      children_truncated: true,
      children: [
        {
          session_id: childId,
          title: "Explore the retry path",
          parent_relation: "SUBAGENT",
          parent_tool_use_id: "redacted-" + "a".repeat(64),
          agent_type: "Explore",
        },
        {
          session_id: sessionId,
          title: null,
          parent_relation: "FORK",
          parent_tool_use_id: null,
          agent_type: null,
        },
      ],
    };
    const text = formatGet({ ...get, header: withChildren }).text;
    expect(text).toContain("subagent_runs: 3 child sessions");
    expect(text).toContain(
      `${childId} SUBAGENT agent_type=Explore spawned_by=redacted-${"a".repeat(64)}`,
    );
    expect(text).toContain(`${sessionId} FORK`);
    expect(text).not.toContain(`${sessionId} FORK spawned_by`);
    expect(text).toContain("truncated");
    expect(formatGet(get).text).not.toContain("subagent_runs");
  });
  it("validates the message content byte bound", () => {
    // One slice is at most a quarter of the largest page (256 KB): 64 KB (R-GET-02).
    const message = get.messages[0];
    expect(
      messageSchema.safeParse({ ...message, content: "界".repeat(21845) })
        .success,
    ).toBe(true);
    expect(
      messageSchema.safeParse({ ...message, content: "界".repeat(21846) })
        .success,
    ).toBe(false);
  });
  it("keeps SQL types, large integer strings, nulls, and truncation metadata", () => {
    const result: SqlOutput = {
      columns: [
        { name: "tokens", type: "int8" },
        { name: "content", type: "text" },
      ],
      rows: [
        ["9007199254740993", "line1\nline2|cell"],
        [null, ""],
      ],
      row_count: 2,
      capped: true,
      truncated_cells: [[0, 1]],
      duration_ms: 21,
    };
    const formatted = formatSql(result);
    expect(formatted.structuredContent).toEqual(result);
    expect(formatted.text).toContain("tokens (int8) | content (text)");
    expect(formatted.text).toContain("9007199254740993 | line1\\nline2\\|cell");
    expect(formatted.text).toContain(
      "2 rows (capped). Add LIMIT/OFFSET to page.",
    );
    expect(formatted.text).toContain("truncated_cells: [[0,1]]");
  });
});
