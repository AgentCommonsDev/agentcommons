import { describe, expect, it } from "vitest";
import { formatGet, formatSearch, formatSql } from "./index.js";
import {
  messageSchema,
  type GetOutput,
  type SessionHeader,
} from "../schemas/get.js";
import type { SearchOutput } from "../schemas/search.js";
import type { SqlOutput } from "../schemas/sql.js";

const sessionId = "0192a3f0-7c1e-7d1a-9b0e-3f2a1c9d4e55";
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
          truncated_fields: [],
        },
      ],
    },
  ],
  cursor: "next-search-page",
  truncated_response: true,
};
describe("shared text and structured formatters", () => {
  it("formats search blocks with exact session/sequence identities, hit markers, and continuation", () => {
    const formatted = formatSearch(search);
    expect(formatted.structuredContent).toEqual(search);
    expect(formatted.text).toContain(`session_id: ${sessionId}`);
    expect(formatted.text).toContain(
      "seq 2 TOOL_RESULT TOOL_RESULT tool_name=Bash tool_use_id=call-1 [hit] [truncated]",
    );
    expect(formatted.text).toContain('cursor: "next-search-page"');
    expect(formatted.text).not.toMatch(/duration_ms|rank|score/);
    expect(() =>
      formatSearch({ ...search, rank: 0.8 } as SearchOutput),
    ).toThrow();
  });
  it("counts unique sessions after window merging and prints an empty result honestly", () => {
    expect(
      formatSearch({
        ...search,
        blocks: [...search.blocks, ...search.blocks],
      }).text.startsWith("1 session\n"),
    ).toBe(true);
    expect(
      formatSearch({ blocks: [], cursor: null, truncated_response: false })
        .text,
    ).toBe("0 sessions");
  });
  // @req R-GET-03
  it("includes every header fact, nullable usage, thinking, and message continuation", () => {
    const formatted = formatGet(get);
    expect(formatted.structuredContent).toEqual(get);
    for (const key of Object.keys(header))
      expect(formatted.text).toContain(`${key}:`);
    expect(formatted.text).toContain("input_tokens: 9007199254740993");
    expect(formatted.text).toContain("reuse_count: 2");
    expect(formatted.text).toContain("output_tokens: null");
    expect(formatted.text).toContain("seq 2 ASSISTANT THINKING");
    expect(formatted.text).toContain('content_cursor: {"seq":2,"offset":4096}');
    expect(formatted.text).toContain('next: {"seq":2,"offset":4096}');
  });
  it("validates the message content byte bound", () => {
    const message = get.messages[0];
    expect(
      messageSchema.safeParse({ ...message, content: "界".repeat(1365) })
        .success,
    ).toBe(true);
    expect(
      messageSchema.safeParse({ ...message, content: "界".repeat(1366) })
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
    expect(formatted.text).toContain("2 rows (capped)");
    expect(formatted.text).toContain("truncated_cells: [[0,1]]");
  });
});
