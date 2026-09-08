import { describe, expect, it } from "vitest";
import { messageSchema, type Message } from "../schemas/get.js";
import { messageBranches, repositoryLinks } from "./session-navigation.js";

const id = "0192a3f0-7c1e-7d1a-9b0e-3f2a1c9d4e55";
function message(
  seq: number,
  kind: Message["kind"],
  toolId: string | null = null,
) {
  return messageSchema.parse({
    message_id: id.slice(0, -2) + String(seq).padStart(2, "0"),
    session_id: id,
    raw_record_id: null,
    ingest_batch_id: null,
    seq,
    kind,
    role: "ASSISTANT",
    content: `content ${String(seq)}`,
    content_cursor: null,
    tool_name: null,
    tool_use_id: toolId,
    model: null,
    timestamp: null,
    received_at: "2026-09-08T00:00:00Z",
    input_tokens: null,
    output_tokens: null,
    agent_id: null,
  });
}

describe("recorded session navigation", () => {
  // @req R-DASH-19
  it("nests recorded results under exactly one earlier call and preserves other source order", () => {
    const input = [
      message(1, "TEXT"),
      message(2, "TOOL_USE", "call"),
      message(3, "TEXT"),
      message(4, "TOOL_RESULT", "call"),
      message(5, "TOOL_RESULT", "orphan"),
    ];
    const branches = messageBranches(input);
    expect(branches.map((row) => row.message.seq)).toEqual([1, 2, 3, 5]);
    expect(branches[1]?.results).toEqual([input[3]]);
    expect(
      branches
        .flatMap((row) => [row.message, ...row.results])
        .sort((a, b) => a.seq - b.seq),
    ).toEqual(input);
  });
  // @req R-DASH-19
  it("does not guess across duplicate IDs, missing calls or response-page boundaries", () => {
    const input = [
      message(1, "TOOL_RESULT", "future"),
      message(2, "TOOL_USE", "duplicate"),
      message(3, "TOOL_USE", "duplicate"),
      message(4, "TOOL_RESULT", "duplicate"),
      message(5, "TOOL_USE", "future"),
    ];
    expect(
      messageBranches(input).every((row) => row.results.length === 0),
    ).toBe(true);
    expect(
      messageBranches([message(9, "TOOL_RESULT", "other-page")]),
    ).toHaveLength(1);
  });
  // @req R-DASH-20
  it.each([
    [
      "github.com/team/repo.git",
      "https://github.com/team/repo/tree/fix%2Fsearch",
      "https://github.com/team/repo/commit/abc123",
    ],
    [
      "https://gitlab.com/group/subgroup/repo",
      "https://gitlab.com/group/subgroup/repo/-/tree/fix%2Fsearch",
      "https://gitlab.com/group/subgroup/repo/-/commit/abc123",
    ],
    [
      "http://bitbucket.org/team/repo/",
      "https://bitbucket.org/team/repo/src/fix%2Fsearch",
      "https://bitbucket.org/team/repo/commits/abc123",
    ],
  ])(
    "links recorded refs on %s with encoded branch names",
    (source, branch, commit) => {
      const links = repositoryLinks(source);
      expect(links?.branch("fix/search")).toBe(branch);
      expect(links?.commit("abc123")).toBe(commit);
    },
  );
  // @req R-DASH-20
  it("keeps unsupported hosts copyable without guessing ref routes; rejects unsafe origins", () => {
    const links = repositoryLinks("https://git.example.org/group/repo");
    expect(links?.repository).toBe("https://git.example.org/group/repo");
    expect(links?.branch("main")).toBeNull();
    for (const input of [
      null,
      "",
      "javascript:alert(1)",
      "https://user:secret@github.com/x/y",
      "https://github.com/x/y?token=secret",
      "https://github.com/x/y#token",
      "https://github.com/x/%2fsecret",
      "https://github.com/x/\\secret",
      "https://github.com/x/\ny",
    ])
      expect(repositoryLinks(input)).toBeNull();
  });
});
