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
import { IngestService } from "../src/services/ingest.js";
import { SessionService } from "../src/services/session.js";
import { CursorCodec } from "../src/services/cursor.js";
import { startDatabase, provisionOrganization } from "./support.js";
let db: Awaited<ReturnType<typeof startDatabase>>;
let first: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let ingest: IngestService;
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
  return {
    envelopeVersion: 2,
    harness,
    harnessSessionId: nativeId,
    behavior: "sync",
    start: null,
    nativeEvent: "Stop",
    batchId: uuidv7(),
    installationId,
    sentAt: new Date().toISOString(),
    context: {
      cwd: "/repo",
      installation: {
        hostname: "links-host",
        osUser: "user",
        platform: "linux",
        arch: "x64",
      },
      git: null,
      parentHint: null,
    },
    sourcePos: lines.length,
    records: lines.map((line, pos) => ({
      pos,
      sourceVersion: 0,
      key: String(pos),
      line,
    })),
    cursor: String(lines.length),
    end: null,
  };
}
beforeAll(async () => {
  db = await startDatabase();
  first = await provisionOrganization(db, "link-first");
  other = await provisionOrganization(db, "link-other");
  ingest = new IngestService(db);
});
afterAll(async () => {
  await db.close();
});

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
    const initial = await db.prisma.agentSession.findUniqueOrThrow({
      where: { id: created.result.sessionId },
    });
    expect(initial).toMatchObject({
      parentSessionId: parent.result.sessionId,
      parentRelation: "SUBAGENT",
      parentNativeRef: parentRef,
      agentType: "Explore",
      messageCount: 0,
    });
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
      await db.prisma.agentSession.count({
        where: {
          organizationId: initial.organizationId,
          harnessSessionId: nativeId,
        },
      }),
    ).toBe(1);
    expect(
      await db.prisma.agentSession.findUniqueOrThrow({
        where: { id: initial.id },
      }),
    ).toMatchObject({
      parentSessionId: parent.result.sessionId,
      parentRelation: "SUBAGENT",
      status: "ENDED",
    });
    expect(
      await db.prisma.message.count({ where: { sessionId: initial.id } }),
    ).toBeGreaterThan(0);
    const replay = await ingest.execute(first.context, stop);
    expect(replay.result).toEqual(confirmed.result);
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
      await db.prisma.agentSession.findUniqueOrThrow({
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
    const linked = await db.prisma.agentSession.findUniqueOrThrow({
      where: { id: child.result.sessionId },
    });
    expect(linked.parentSessionId).toBe(parent.result.sessionId);
    expect(linked.parentSessionId).not.toBe(foreign.result.sessionId);
    const reader = new SessionService({
      ...db,
      cursors: new CursorCodec("link-cursor-secret"),
    });
    const tree = await reader.tree(first.context, parent.result.sessionId, {});
    expect(tree.result.nodes.map((node) => node.session_id)).toContain(
      child.result.sessionId,
    );
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
      await db.prisma.agentSession.findUniqueOrThrow({
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
      await db.prisma.agentSession.findUniqueOrThrow({
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
      await db.prisma.agentSession.findUniqueOrThrow({
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
        await db.prisma.agentSession.findUniqueOrThrow({
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
        await db.prisma.agentSession.findUniqueOrThrow({
          where: { id: linked.result.sessionId },
        }),
      ).toMatchObject({
        parentSessionId: spawnedParent.result.sessionId,
        parentRelation: "SPAWNED",
      });
    }
  });
});
