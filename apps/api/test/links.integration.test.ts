import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  NORMALIZERS,
  type Harness,
  type IngestEnvelope,
  type SourceRecord,
} from "@agentcommons/core";
import type { IngestService } from "../src/services/ingest.js";
import { SessionService } from "../src/services/session.js";
import { CursorCodec } from "../src/services/cursor.js";
import { requireCaller } from "../src/services/context.js";
import { provisionOrganization, releaser } from "./support.js";
import { lineRecords, testEnvelope } from "./envelopes.js";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { traceServices } from "./trace-services.js";
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let first: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let ingest: Pick<IngestService, "execute">;
let native: ReturnType<typeof traceServices>;
const installationId = uuidv7();
function fixture(path: string) {
  return readFileSync(
    new URL(`../../../fixtures/transcripts/${path}`, import.meta.url),
    "utf8",
  )
    .trimEnd()
    .split("\n");
}
function source(lines: readonly string[]): SourceRecord[] {
  return lines.map((line, pos) => ({
    id: uuidv7(),
    pos: BigInt(pos),
    sourceVersion: 0,
    key: null,
    payload: z.looseObject({}).parse(JSON.parse(line)),
    receivedAt: new Date(),
  }));
}
function request(
  harness: Harness,
  nativeId: string,
  lines: readonly string[] = [],
): IngestEnvelope {
  return testEnvelope({
    harness,
    harnessSessionId: nativeId,
    batchId: uuidv7(),
    installationId,
    sourcePos: lines.length,
    records: lineRecords(lines),
    cursor: String(lines.length),
    context: { installation: { hostname: "links-host", osUser: "user" } },
  });
}
const { defer, release } = releaser();
beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  first = await provisionOrganization(db, "link-first");
  other = await provisionOrganization(db, "link-other");
  native = traceServices(db);
  defer(() => native.close());
  ingest = { execute: native.publish };
});
afterAll(release);

describe("persisted explicit harness relationships", () => {
  it("creates the hinted Claude child at start and confirms the same edge from its live child transcript at stop @req R-LNK-01", async () => {
    const lines = fixture("claude-code/subagent.jsonl");
    const records = source(lines);
    const nativeId = z
      .string()
      .parse(NORMALIZERS.CLAUDE_CODE.sessionDelta(records).harnessSessionId);
    const parentRef = z
      .string()
      .parse(NORMALIZERS.CLAUDE_CODE.links(records)[0]?.parentNativeRef);
    const parent = await ingest.execute(
      first.context,
      request("CLAUDE_CODE", parentRef),
    );
    const start = request("CLAUDE_CODE", nativeId);
    start.behavior = "start";
    start.start = { resume: false };
    start.nativeEvent = "SubagentStart";
    start.context.parentHint = {
      harnessSessionId: parentRef,
      relation: "SUBAGENT",
      agentType: "Explore",
    };
    const created = await ingest.execute(first.context, start);
    const initial = await db.prisma.traceSessionControl.findFirstOrThrow({
      where: { id: created.result.sessionId },
    });
    expect(initial).toMatchObject({
      parentSessionId: parent.result.sessionId,
      parentRelation: "SUBAGENT",
      parentNativeRef: parentRef,
    });
    expect(
      await native.header(initial.organizationId, initial.id),
    ).toMatchObject({ agent_type: "Explore", message_count: 0 });
    const stop = {
      ...request("CLAUDE_CODE", nativeId, lines),
      behavior: "end" as const,
      nativeEvent: "SubagentStop",
      end: {
        reason: "subagent_stop",
        head: null,
        observedCommits: [],
        observedDiffStat: null,
        dirtyFileCount: null,
      },
    };
    const confirmed = await ingest.execute(first.context, stop);
    expect(confirmed.result.sessionId).toBe(created.result.sessionId);
    expect(
      await db.prisma.traceSessionControl.count({
        where: {
          organizationId: initial.organizationId,
          harnessSessionId: nativeId,
        },
      }),
    ).toBe(1);
    expect(
      await db.prisma.traceSessionControl.findFirstOrThrow({
        where: { id: initial.id },
      }),
    ).toMatchObject({
      parentSessionId: parent.result.sessionId,
      parentRelation: "SUBAGENT",
      status: "ENDED",
    });
    expect(
      (await native.messages(initial.organizationId, initial.id)).length,
    ).toBeGreaterThan(0);
    const replay = await ingest.execute(first.context, stop);
    expect(replay.result).toEqual({
      ...confirmed.result,
      publication: "published",
    });
  });
  it("links the live Codex thread_spawn parent in its own organization even when the parent arrives later @req R-LNK-02", async () => {
    const lines = fixture("codex/subagent.jsonl");
    const records = source(lines);
    const nativeId = z
      .string()
      .parse(NORMALIZERS.CODEX.sessionDelta(records).harnessSessionId);
    const payload = z
      .object({
        payload: z.object({
          source: z.object({
            subagent: z.object({
              thread_spawn: z.object({ parent_thread_id: z.string() }),
            }),
          }),
        }),
      })
      .parse(records[0]?.payload);
    const parentRef =
      payload.payload.source.subagent.thread_spawn.parent_thread_id;
    // The captured record contains both fields; the explicit thread_spawn path wins.
    const header = z
      .looseObject({ payload: z.looseObject({}) })
      .parse(records[0]?.payload);
    lines[0] = JSON.stringify({
      ...header,
      payload: {
        ...header.payload,
        parent_thread_id: "conflicting-legacy-fallback",
      },
    });
    const foreign = await ingest.execute(
      other.context,
      request("CODEX", parentRef),
    );
    const child = await ingest.execute(
      first.context,
      request("CODEX", nativeId, lines),
    );
    expect(
      await db.prisma.traceSessionControl.findFirstOrThrow({
        where: { id: child.result.sessionId },
      }),
    ).toMatchObject({
      parentSessionId: null,
      parentNativeRef: parentRef,
      parentRelation: "SUBAGENT",
    });
    const parent = await ingest.execute(
      first.context,
      request("CODEX", parentRef),
    );
    const linked = await db.prisma.traceSessionControl.findFirstOrThrow({
      where: { id: child.result.sessionId },
    });
    expect(linked.parentSessionId).toBe(parent.result.sessionId);
    expect(linked.parentSessionId).not.toBe(foreign.result.sessionId);
    const reader = new SessionService({
      ...db,
      readers: db.traceReaders,
      cursors: new CursorCodec("link-cursor-secret"),
    });
    const tree = await reader.tree(first.context, parent.result.sessionId, {});
    expect(tree.result.nodes.map((node) => node.session_id)).toContain(
      child.result.sessionId,
    );
  });
  it("attaches the Claude child to the parent's Agent call once the parent's result names it, in either arrival order @req R-LNK-07", async () => {
    const parentLines = fixture("claude-code/parent.jsonl");
    const childLines = fixture("claude-code/subagent.jsonl");
    const childRecords = source(childLines);
    const childNativeId = z
      .string()
      .parse(
        NORMALIZERS.CLAUDE_CODE.sessionDelta(childRecords).harnessSessionId,
      );
    const spawn = NORMALIZERS.CLAUDE_CODE.spawns(source(parentLines))[0];
    if (!spawn) throw new Error("The parent fixture lost its Agent result.");
    expect(spawn.childNativeRef).toBe(childNativeId);
    const parentRef = z
      .string()
      .parse(NORMALIZERS.CLAUDE_CODE.links(childRecords)[0]?.parentNativeRef);
    // Child first: the shim registers the child at SubagentStart, before the parent's
    // transcript holds the Agent result.
    const parent = await ingest.execute(
      first.context,
      request("CLAUDE_CODE", parentRef),
    );
    const child = request("CLAUDE_CODE", childNativeId, childLines);
    child.context.parentHint = {
      harnessSessionId: parentRef,
      relation: "SUBAGENT",
      agentType: "Explore",
    };
    const created = await ingest.execute(first.context, child);
    expect(
      await db.prisma.traceSessionControl.findFirstOrThrow({
        where: { id: created.result.sessionId },
      }),
    ).toMatchObject({
      parentSessionId: parent.result.sessionId,
      parentToolUseId: null,
    });
    const evidence = await ingest.execute(
      first.context,
      request("CLAUDE_CODE", parentRef, parentLines),
    );
    expect(evidence.result.sessionId).toBe(parent.result.sessionId);
    const linked = await db.prisma.traceSessionControl.findFirstOrThrow({
      where: { id: created.result.sessionId },
    });
    // The stored value is the projected identity the parent's TOOL_USE message carries.
    const call = (
      await native.messages(
        requireCaller(first.context).organizationId,
        parent.result.sessionId,
      )
    ).find((item) => item.kind === "TOOL_USE" && item.tool_name === "Agent");
    expect(call?.tool_use_id).toMatch(/^redacted-[a-f0-9]{64}$/);
    expect(linked.parentToolUseId).toBe(call?.tool_use_id);
    const reader = new SessionService({
      ...db,
      readers: db.traceReaders,
      cursors: new CursorCodec("link-cursor-secret"),
    });
    const header = await reader.get(first.context, {
      session_id: parent.result.sessionId,
    });
    expect(header.result.header?.children).toEqual([
      expect.objectContaining({
        session_id: created.result.sessionId,
        parent_tool_use_id: call?.tool_use_id,
      }),
    ]);
    const childHeader = await reader.get(first.context, {
      session_id: created.result.sessionId,
    });
    expect(childHeader.result.header?.parent_tool_use_id).toBe(
      call?.tool_use_id,
    );
    const tree = await reader.tree(first.context, parent.result.sessionId, {});
    expect(
      tree.result.nodes.find(
        (node) => node.session_id === created.result.sessionId,
      )?.parent_tool_use_id,
    ).toBe(call?.tool_use_id);
    expect(
      tree.result.nodes.find(
        (node) => node.session_id === parent.result.sessionId,
      )?.parent_tool_use_id,
    ).toBeNull();
    // Parent first: the spawn claim waits for a child that has not been uploaded yet.
    const laterParentRef = uuidv7();
    const laterParentLines = parentLines.map((line) =>
      line.replaceAll(parentRef, laterParentRef),
    );
    const laterParent = await ingest.execute(
      first.context,
      request("CLAUDE_CODE", laterParentRef, laterParentLines),
    );
    const laterChildId = childNativeId.replace(parentRef, laterParentRef);
    const laterChild = await ingest.execute(
      first.context,
      request(
        "CLAUDE_CODE",
        laterChildId,
        childLines.map((line) => line.replaceAll(parentRef, laterParentRef)),
      ),
    );
    expect(
      await db.prisma.traceSessionControl.findFirstOrThrow({
        where: { id: laterChild.result.sessionId },
      }),
    ).toMatchObject({
      parentSessionId: laterParent.result.sessionId,
      parentToolUseId: call?.tool_use_id,
    });
    // A claim never attaches a child that belongs to another parent.
    const foreignParent = await ingest.execute(
      first.context,
      request("CLAUDE_CODE", uuidv7(), laterParentLines),
    );
    expect(JSON.stringify(foreignParent.audit.detail)).toContain(
      "other_parent",
    );
    expect(
      (
        await db.prisma.traceSessionControl.findFirstOrThrow({
          where: { id: laterChild.result.sessionId },
        })
      ).parentSessionId,
    ).toBe(laterParent.result.sessionId);
  });
  it("attaches the Codex child thread to the spawn_agent call named by the parent's SubAgentActivity item @req R-LNK-07 @req R-LNK-02", async () => {
    const parentLines = fixture("codex/parent-with-subagent.jsonl");
    const childLines = fixture("codex/subagent.jsonl");
    const childNativeId = z
      .string()
      .parse(
        NORMALIZERS.CODEX.sessionDelta(source(childLines)).harnessSessionId,
      );
    const spawn = NORMALIZERS.CODEX.spawns(source(parentLines))[0];
    if (!spawn)
      throw new Error("The parent fixture lost its SubAgentActivity item.");
    expect(spawn.childNativeRef).toBe(childNativeId);
    const parentRef = z
      .string()
      .parse(
        NORMALIZERS.CODEX.sessionDelta(source(parentLines)).harnessSessionId,
      );
    // Parent first, as Codex writes the started item at spawn time.
    const parent = await ingest.execute(
      first.context,
      request("CODEX", parentRef, parentLines),
    );
    const child = await ingest.execute(
      first.context,
      request("CODEX", childNativeId, childLines),
    );
    const organizationId = requireCaller(first.context).organizationId;
    const call = (
      await native.messages(organizationId, parent.result.sessionId)
    ).find(
      (item) => item.kind === "TOOL_USE" && item.tool_name === "spawn_agent",
    );
    expect(call?.tool_use_id).toMatch(/^redacted-[a-f0-9]{64}$/);
    expect(
      await db.prisma.traceSessionControl.findFirstOrThrow({
        where: { id: child.result.sessionId },
      }),
    ).toMatchObject({
      parentSessionId: parent.result.sessionId,
      parentRelation: "SUBAGENT",
      parentToolUseId: call?.tool_use_id,
    });
    for (const harness of ["GEMINI_CLI", "PI"] as const)
      expect(
        NORMALIZERS[harness].spawns(source(fixture("pi/fork.jsonl"))),
      ).toEqual([]);
  });
  it("uses the live pi fork header over a conflicting spawned hint and audits later conflicts without silently relinking @req R-LNK-03", async () => {
    const lines = fixture("pi/fork.jsonl");
    const records = source(lines);
    const nativeId = z
      .string()
      .parse(NORMALIZERS.PI.sessionDelta(records).harnessSessionId);
    const parentRef = z
      .string()
      .parse(NORMALIZERS.PI.links(records)[0]?.parentNativeRef);
    const parent = await ingest.execute(
      first.context,
      request("PI", parentRef),
    );
    const hinted = await ingest.execute(first.context, request("PI", uuidv7()));
    const hintRef = (
      await db.prisma.traceSessionControl.findFirstOrThrow({
        where: { id: hinted.result.sessionId },
      })
    ).harnessSessionId;
    const body = request("PI", nativeId, lines);
    body.context.parentHint = {
      harnessSessionId: hintRef,
      relation: "SPAWNED",
    };
    const child = await ingest.execute(first.context, body);
    expect(
      await db.prisma.traceSessionControl.findFirstOrThrow({
        where: { id: child.result.sessionId },
      }),
    ).toMatchObject({
      parentSessionId: parent.result.sessionId,
      parentRelation: "FORK",
    });
    expect(JSON.stringify(child.audit.detail)).toContain(hintRef);
    expect(JSON.stringify(child.audit.detail)).toContain("SPAWNED");
    const later = await ingest.execute(first.context, {
      ...body,
      batchId: uuidv7(),
      records: [],
      context: {
        ...body.context,
        parentHint: { harnessSessionId: uuidv7(), relation: "SPAWNED" },
      },
    });
    expect(JSON.stringify(later.audit.detail)).toContain("parent_conflicts");
    expect(
      await db.prisma.traceSessionControl.findFirstOrThrow({
        where: { id: child.result.sessionId },
      }),
    ).toMatchObject({
      parentSessionId: parent.result.sessionId,
      parentRelation: "FORK",
    });
    for (const harness of [
      "CLAUDE_CODE",
      "CODEX",
      "GEMINI_CLI",
      "PI",
    ] as const) {
      const parentId = uuidv7();
      const spawnedParent = await ingest.execute(
        first.context,
        request(harness, parentId),
      );
      const independent = await ingest.execute(
        first.context,
        request(harness, uuidv7(), [
          JSON.stringify({
            type: "unknown-native-record",
            parentSession: parentId,
            forked_from: parentId,
            text: "A reference in ordinary metadata is not a native fork.",
          }),
        ]),
      );
      expect(
        await db.prisma.traceSessionControl.findFirstOrThrow({
          where: { id: independent.result.sessionId },
        }),
      ).toMatchObject({ parentSessionId: null, parentRelation: null });
      const spawned = request(harness, uuidv7());
      spawned.context.parentHint = {
        harnessSessionId: parentId,
        relation: "SPAWNED",
      };
      const linked = await ingest.execute(first.context, spawned);
      expect(
        await db.prisma.traceSessionControl.findFirstOrThrow({
          where: { id: linked.result.sessionId },
        }),
      ).toMatchObject({
        parentSessionId: spawnedParent.result.sessionId,
        parentRelation: "SPAWNED",
      });
    }
  });
});
