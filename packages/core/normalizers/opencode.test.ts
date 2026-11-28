import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { opencode } from "./index.js";
import type { NormalizedMessage, SourceRecord } from "./types.js";

const fixtures = new URL(
  "../../../fixtures/transcripts/opencode/",
  import.meta.url,
);
const documentSchema = z.looseObject({
  messages: z.array(z.looseObject({})),
});

/** A captured session document as the json-document reader hands it over. */
function capture(name: string, version = 0) {
  const document = documentSchema.parse(
    JSON.parse(
      readFileSync(new URL(`${name}.json`, fixtures), "utf8"),
    ) as unknown,
  );
  const { messages, ...metadata } = document;
  const records: SourceRecord[] = messages.map((payload, index) => ({
    id: `raw-${String(index)}-${String(version)}`,
    pos: BigInt(index),
    sourceVersion: version,
    key: null,
    payload,
    receivedAt: new Date("2026-11-27T23:10:00Z"),
  }));
  return {
    records,
    context: {
      transcriptMetadata: z
        .record(z.string(), z.json())
        .parse({ ...metadata, sourceRecordCount: messages.length }),
    },
  };
}
function snapshot(messages: NormalizedMessage[]): unknown {
  return messages.map((item) => ({
    ...item,
    timestamp: item.timestamp?.toISOString() ?? null,
    inputTokens: item.inputTokens?.toString() ?? null,
    outputTokens: item.outputTokens?.toString() ?? null,
  }));
}
const versions = ["1.19.6", "2.4.1"] as const;

describe("opencode normalization", () => {
  // @req R-HRN-10
  it.each(versions)(
    "projects a captured %s session: prompt, thinking, tool calls with results, a denied call, usage and session facts",
    (version) => {
      const { records, context } = capture(`${version}-parent`);
      const { messages, delta } = opencode.normalize(records, context);
      expect(snapshot(messages)).toMatchSnapshot();
      expect(messages[0]).toMatchObject({ role: "USER", kind: "TEXT" });
      expect(messages[0]?.content).toContain("probe.txt");
      expect(messages.some((item) => item.kind === "THINKING")).toBe(true);
      const uses = messages.filter((item) => item.kind === "TOOL_USE");
      const results = messages.filter((item) => item.kind === "TOOL_RESULT");
      expect(uses.map((item) => item.toolName)).toContain("write");
      // Every finished call is paired with its result by the native call id.
      for (const result of results)
        expect(uses.map((item) => item.toolUseId)).toContain(result.toolUseId);
      expect(
        uses.find((item) => item.toolName === "write")?.files?.[0]?.ops,
      ).toEqual(["write"]);
      expect(
        results.some((item) =>
          item.content.includes("Capture: a denied command."),
        ),
      ).toBe(true);
      expect(messages.find((item) => item.role === "ASSISTANT")?.model).toBe(
        "deepseek/deepseek-v4.1-flash-1017",
      );
      expect(
        messages.reduce((sum, item) => sum + (item.outputTokens ?? 0n), 0n),
      ).toBeGreaterThan(0n);
      expect(delta).toMatchObject({
        harnessSessionId: context.transcriptMetadata.sessionId,
        harnessVersion: version,
        cwd: `/tmp/agentcommons-live-capture/opencode-${version}/project`,
        title: "agentcommons-capture",
      });
      expect(delta.startedAt).toBeInstanceOf(Date);
    },
  );

  // @req R-HRN-10
  it.each(versions)(
    "names the %s child session the subagent call started, and the child's own facts",
    (version) => {
      const parent = capture(`${version}-parent`);
      const child = capture(`${version}-child`);
      const call = opencode
        .normalize(parent.records, parent.context)
        .messages.find(
          (item) =>
            item.kind === "TOOL_USE" &&
            (item.toolName === "task" || item.toolName === "subagent"),
        );
      expect(call?.toolUseId).toBeTruthy();
      expect(opencode.spawns(parent.records)).toEqual([
        {
          toolUseId: call?.toolUseId,
          childNativeRef: child.context.transcriptMetadata.sessionId,
        },
      ]);
      // The child names its parent only in session facts, which travel as the parent hint.
      expect(opencode.links(child.records)).toEqual([]);
      const { messages, delta } = opencode.normalize(
        child.records,
        child.context,
      );
      expect(delta.agentType).toBe("general");
      expect(messages.some((item) => item.toolName === "read")).toBe(true);
    },
  );

  // @req R-HRN-10
  it("keeps the newest version of a message that changed in place", () => {
    const final = capture("2.4.1-parent", 1).records;
    const first = final[1];
    if (!first) throw new Error("The capture has no assistant message.");
    const older: SourceRecord = {
      ...first,
      id: "raw-1-0",
      sourceVersion: 0,
      payload: { ...first.payload, content: [] },
    };
    const messages = opencode.toMessages([older, ...final]);
    expect(messages.some((item) => item.rawRecordId === "raw-1-0")).toBe(false);
    expect(messages.some((item) => item.rawRecordId === "raw-1-1")).toBe(true);
  });

  // @req R-HRN-10
  it("reads each record's shape, so one document may hold either generation", () => {
    const one = capture("1.19.6-parent").records;
    const two = capture("2.4.1-parent").records;
    const mixed = [...one, ...two].map((record, index) => ({
      ...record,
      id: `raw-${String(index)}`,
      pos: BigInt(index),
    }));
    const messages = opencode.toMessages(mixed);
    expect(
      messages.filter((item) => item.role === "USER" && item.kind === "TEXT"),
    ).toHaveLength(
      opencode
        .toMessages(one)
        .filter((item) => item.role === "USER" && item.kind === "TEXT").length +
        opencode
          .toMessages(two)
          .filter((item) => item.role === "USER" && item.kind === "TEXT")
          .length,
    );
    expect(
      opencode.toMessages([
        {
          ...one[0],
          id: "unknown",
          pos: 0n,
          sourceVersion: 0,
          key: null,
          receivedAt: new Date(),
          payload: { unexpected: true },
        },
      ]),
    ).toEqual([]);
  });

  // @req R-HRN-10
  it("locates every tool call for identity mapping and masks a sensitive result without losing its input", () => {
    for (const version of versions) {
      const { records } = capture(`${version}-parent`);
      const uses = opencode
        .toMessages(records)
        .filter((item) => item.kind === "TOOL_USE");
      const identities = records.flatMap((record) =>
        opencode.toolIdentities(record).map((identity) => identity.id),
      );
      expect(identities.sort()).toEqual(
        uses.map((item) => item.toolUseId).sort(),
      );
      const write = records.find((record) =>
        opencode
          .toolResults(record)
          .some((result) =>
            uses.some(
              (use) =>
                use.toolName === "write" && use.toolUseId === result.toolUseId,
            ),
          ),
      );
      if (!write) throw new Error("The capture has no finished write.");
      const location = opencode
        .toolResults(write)
        .flatMap((result) => result.locations)[0];
      expect(location?.replacement).toMatchObject({
        status: "completed",
        input: expect.objectContaining({}) as unknown,
      });
      expect(JSON.stringify(location?.replacement)).toContain(
        "sensitive file output redacted",
      );
    }
  });

  // @req R-HRN-10
  it("keeps the tool calls a code-mode execute call made, with their inputs", () => {
    const record: SourceRecord = {
      id: "raw-code-mode",
      pos: 0n,
      sourceVersion: 0,
      key: null,
      receivedAt: new Date("2026-11-27T23:10:00Z"),
      payload: {
        id: "msg_code_mode",
        type: "assistant",
        model: { id: "anthropic/claude-sonnet-5-5" },
        content: [
          {
            type: "tool",
            id: "call_execute",
            name: "execute",
            state: {
              status: "completed",
              input: {
                code: 'return await tools.agentcommons.search({query: "x"});',
              },
              content: [{ type: "text", text: '{"blocks":[]}' }],
              metadata: {
                toolCalls: [
                  {
                    tool: "agentcommons.search",
                    status: "completed",
                    input: { query: "x" },
                  },
                ],
              },
            },
          },
        ],
      },
    };
    const [use, result] = opencode.toMessages([record]);
    expect(use).toMatchObject({
      kind: "TOOL_USE",
      toolName: "execute",
      toolInput: {
        code: 'return await tools.agentcommons.search({query: "x"});',
        toolCalls: [
          {
            tool: "agentcommons.search",
            status: "completed",
            input: { query: "x" },
          },
        ],
      },
    });
    expect(result).toMatchObject({
      kind: "TOOL_RESULT",
      toolUseId: "call_execute",
      content: '{"blocks":[]}',
    });
  });
});
