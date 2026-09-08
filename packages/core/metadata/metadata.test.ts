import { describe, expect, it } from "vitest";
import {
  messageId,
  repositoryIdentity,
  repositoryPath,
  resolveLink,
  searchableMessage,
  utf8Slice,
} from "./index.js";
import { projectionIdentity } from "../redaction/tool-results.js";

describe("shared metadata", () => {
  // @req R-SRCH-01
  it("indexes whole text, bounded tool input, both ends of results, and no reasoning or metadata", () => {
    expect(
      searchableMessage({
        kind: "TEXT",
        content: "a".repeat(10_000),
        toolName: null,
        toolInput: null,
      }).searchText,
    ).toHaveLength(10_000);
    const input = searchableMessage({
      kind: "TOOL_USE",
      content: "",
      toolName: "Read",
      toolInput: { file_path: "a".repeat(3000) },
    });
    expect(input.searchText.startsWith("Read ")).toBe(true);
    expect(Buffer.byteLength(input.searchText)).toBe(1029);
    const result = searchableMessage({
      kind: "TOOL_RESULT",
      content: "start " + "x".repeat(10_000) + " FAIL compiler",
      toolName: "Bash",
      toolInput: null,
    });
    expect(result.searchText).toContain("start ");
    expect(result.searchText).toContain("FAIL compiler");
    expect(result.searchText.length).toBeLessThan(4200);
    for (const kind of ["THINKING", "META"] as const)
      expect(
        searchableMessage({
          kind,
          content: "reason",
          toolName: null,
          toolInput: null,
        }),
      ).toEqual({ searchable: false, searchText: "" });
  });

  // @req R-ING-06
  it("derives stable version-5 message identities from session, record, and block", () => {
    const session = "0192a3f0-1111-7000-8000-000000000001";
    const first = messageId(session, "record", 0);
    expect(messageId(session, "record", 0)).toBe(first);
    expect(first[14]).toBe("5");
    expect(messageId(session, "record", 1)).not.toBe(first);
    expect(messageId(session, "other", 0)).not.toBe(first);
  });

  it("paginates UTF-8 bytes without splitting code points and rejects invalid cursors", () => {
    expect(utf8Slice("a🙂éb", 1, 4)).toEqual({ content: "🙂", nextOffset: 5 });
    expect(utf8Slice("a🙂éb", 5, 4)).toEqual({
      content: "éb",
      nextOffset: null,
    });
    expect(() => utf8Slice("a🙂b", 2, 4)).toThrow("boundary");
    expect(() => utf8Slice("abc", 4, 4)).toThrow("past the end");
  });

  it("normalizes remotes without credentials and keeps repository identities distinct", () => {
    expect(repositoryIdentity("git@github.com:team/app.git")).toEqual({
      repoName: "github.com/team/app",
      repoUrl: "github.com/team/app",
    });
    expect(
      repositoryIdentity(
        "https://user:private@example.com/team/app.git?token=private",
      ).repoName,
    ).toBe("example.com/team/app");
    expect(repositoryIdentity("/local/path").repoName).toBeNull();
    expect(repositoryPath("../secret", "/repo", "/repo")).toBeNull();
    expect(repositoryPath("src/app.ts", "/repo", "/repo")).toBe("src/app.ts");
  });

  it("prefers explicit native links and records conflicting hints without inventing forks", () => {
    expect(
      resolveLink([{ parentNativeRef: "native", relation: "FORK" }], {
        harnessSessionId: "hint",
        relation: "SPAWNED",
      }),
    ).toEqual({
      link: { parentNativeRef: "native", relation: "FORK" },
      conflicts: [{ parentNativeRef: "hint", relation: "SPAWNED" }],
    });
    expect(resolveLink([], null).link).toBeNull();
    expect(
      resolveLink([{ parentNativeRef: "native", relation: "SUBAGENT" }], {
        harnessSessionId: projectionIdentity("native"),
        relation: "SUBAGENT",
      }).conflicts,
    ).toEqual([]);
  });
});
