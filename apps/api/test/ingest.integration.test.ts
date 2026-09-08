import { readFile } from "node:fs/promises";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { IngestService } from "../src/services/ingest.js";
import { CursorCodec } from "../src/services/cursor.js";
import { PolicyService } from "../src/services/policies.js";
import { SessionService } from "../src/services/session.js";
import { projectSession, sourceRecord } from "../src/services/projection.js";
import {
  startDatabase,
  provisionOrganization,
  provisionMember,
} from "./support.js";
import {
  projectionIdentity,
  type IngestEnvelope,
  type Harness,
} from "@agentcommons/core";

let database: Awaited<ReturnType<typeof startDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let ingest: IngestService;
let policy: PolicyService;
function envelope(
  harness: Harness = "CLAUDE_CODE",
  native = uuidv7(),
): IngestEnvelope {
  return {
    envelopeVersion: 2,
    harness,
    harnessSessionId: native,
    behavior: "sync",
    start: null,
    nativeEvent: "Stop",
    batchId: uuidv7(),
    installationId: uuidv7(),
    sentAt: new Date().toISOString(),
    context: {
      cwd: "/repo",
      installation: {
        hostname: "developer",
        osUser: "test",
        platform: "linux",
        arch: "x64",
      },
      git: {
        root: "/repo",
        remoteUrl: "git@github.com:rek7/agentcommons.git",
        branch: "main",
        head: "commit-a",
      },
      parentHint: null,
    },
    records: [],
    sourcePos: 0,
    cursor: "0:0",
    end: null,
  };
}
function message(pos: number, text: string, role = "user") {
  return {
    pos,
    sourceVersion: 0,
    key: `record-${String(pos)}`,
    line: JSON.stringify({
      type: role,
      uuid: `record-${String(pos)}`,
      timestamp: "2026-09-07T00:00:00Z",
      message: { content: [{ type: "text", text }], model: "captured-model" },
    }),
  };
}
function next(value: IngestEnvelope, records = value.records): IngestEnvelope {
  return {
    ...value,
    batchId: uuidv7(),
    records,
    sourcePos: Math.max(
      value.sourcePos,
      ...records.map((record) => record.pos),
    ),
    sentAt: new Date(Date.parse(value.sentAt) + 1000).toISOString(),
  };
}

beforeAll(async () => {
  database = await startDatabase();
  organization = await provisionOrganization(database, "ingest-primary");
  other = await provisionOrganization(database, "ingest-other");
  ingest = new IngestService({
    prisma: database.prisma,
    audit: database.audit,
    policies: database.policies,
  });
  policy = new PolicyService({
    prisma: database.prisma,
    audit: database.audit,
    cache: database.policies,
    cursors: new CursorCodec("integration-cursor-secret"),
  });
}, 120_000);
afterAll(async () => {
  await database.close();
});

describe("transactional ingest", () => {
  // @req R-ING-03 @req R-ING-04
  it("matches core and PostgreSQL native identity on Unicode, long, empty and reserved-prefix boundaries", async () => {
    const canonical = projectionIdentity("native");
    const values = [
      "",
      "native",
      "λ😀漢字",
      "x".repeat(20_000),
      canonical,
      `${canonical}\n`,
      ` ${canonical}`,
      canonical.toUpperCase(),
      "redacted-short",
      "redacted-" + "z".repeat(64),
    ];
    const rows = await database.prisma.$queryRaw<{ identity: string }[]>`
      SELECT public.native_identity(value) AS identity FROM unnest(${values}::text[]) WITH ORDINALITY AS input(value, ordinal) ORDER BY ordinal`;
    expect(rows.map((row) => row.identity)).toEqual(
      values.map(projectionIdentity),
    );
  });

  // @req R-ING-01 @req R-ING-11 @req R-RED-02 @req R-AUD-01
  it("stores NUL and unpaired UTF-16 source text safely without losing the valid batch", async () => {
    const request = envelope();
    request.records = [
      message(0, "Before\u0000after\ud800tail\udfff emoji😀"),
      message(100, "Still present"),
    ];
    request.sourcePos = 100;
    const accepted = await ingest.execute(organization.context, request);
    expect(accepted.result).toMatchObject({ accepted: 2, duplicates: 0 });
    const messages = await database.prisma.message.findMany({
      where: { sessionId: accepted.result.sessionId },
      orderBy: { seq: "asc" },
    });
    expect(messages.map((row) => row.content)).toEqual([
      "Before\\u0000after�tail� emoji😀",
      "Still present",
    ]);
    expect(
      (await ingest.execute(organization.context, request)).result,
    ).toEqual(accepted.result);
    const metadata = envelope();
    metadata.harnessSessionId = "native\u0000\ud800";
    metadata.context.cwd = "/repo/\u0000\ud800";
    metadata.context.installation.hostname = "host\u0000\udfff";
    metadata.records = [
      {
        pos: 0,
        sourceVersion: 0,
        key: "key\u0000\ud800",
        line: JSON.stringify({
          type: "user",
          message: { content: "Safe message" },
          "\u0000": "value",
          "\\u0000": "other",
        }),
      },
    ];
    const stored = await ingest.execute(organization.context, metadata);
    expect(
      (await ingest.execute(organization.context, next(metadata))).result,
    ).toMatchObject({
      sessionId: stored.result.sessionId,
      accepted: 0,
      duplicates: 1,
    });
    const row = await database.prisma.agentSession.findUniqueOrThrow({
      where: { id: stored.result.sessionId },
    });
    expect(row.harnessSessionId).toMatch(/^redacted-[a-f0-9]{64}$/);
    expect(row.cwd).toBe("/repo/\\u0000�");
    const record = await database.prisma.rawRecord.findFirstOrThrow({
      where: { sessionId: row.id },
    });
    expect(record.payload).toMatchObject({
      "\\u0000": "value",
      "\\u0000#1": "other",
    });
    expect(record.key).toMatch(/^redacted-[a-f0-9]{64}$/);
    const audited = await database.audit.write(organization.context, {
      action: "storage.review",
      detail: { value: "audit\u0000\ud800" },
    });
    expect(audited.detail).toEqual({ value: "audit\\u0000�" });
  });

  // @req R-ING-04 @req R-ING-05 @req R-CAP-11
  it("retains distinct native keys at reset offsets, dedupes by the selected identity, and pages every raw tie", async () => {
    const request = envelope();
    const firstRecord = {
      ...message(0, "Before truncation"),
      key: "native-before",
    };
    request.records = [firstRecord];
    const initial = await ingest.execute(organization.context, request);
    const replacement = {
      ...message(0, "After truncation"),
      key: "native-after",
    };
    const reset = await ingest.execute(
      organization.context,
      next(request, [replacement]),
    );
    expect(reset.result).toMatchObject({ accepted: 1, duplicates: 0 });
    const keyless = { ...message(0, "Keyless source"), key: null };
    expect(
      (await ingest.execute(organization.context, next(request, [keyless])))
        .result,
    ).toMatchObject({ accepted: 1, duplicates: 0 });
    expect(
      (
        await ingest.execute(
          organization.context,
          next(request, [replacement, keyless, { ...firstRecord, pos: 500 }]),
        )
      ).result,
    ).toMatchObject({ accepted: 0, duplicates: 3 });
    const rows = await database.prisma.message.findMany({
      where: { sessionId: initial.result.sessionId },
      orderBy: { seq: "asc" },
    });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.content))).toEqual(
      new Set(["Before truncation", "After truncation", "Keyless source"]),
    );
    const reversed = {
      ...envelope(),
      records: [keyless, replacement, firstRecord],
    };
    const reverseResult = await ingest.execute(organization.context, reversed);
    expect(
      (
        await database.prisma.message.findMany({
          where: { sessionId: reverseResult.result.sessionId },
          orderBy: { seq: "asc" },
        })
      ).map((row) => row.content),
    ).toEqual(rows.map((row) => row.content));
    const sessions = new SessionService({
      ...database,
      cursors: new CursorCodec("reset-cursor-secret"),
    });
    const rawIds = [];
    let cursor: string | undefined;
    do {
      const page = await sessions.raw(
        organization.context,
        initial.result.sessionId,
        { limit: 1, ...(cursor ? { cursor } : {}) },
      );
      rawIds.push(...page.result.items.map((row) => row.id));
      cursor = page.result.cursor ?? undefined;
    } while (cursor);
    expect(rawIds).toHaveLength(3);
    expect(new Set(rawIds).size).toBe(3);
    await ingest.execute(organization.context, next(request, []));
    await database.prisma.$transaction(async (tx) => {
      const session = await tx.agentSession.findUniqueOrThrow({
        where: { id: initial.result.sessionId },
      });
      const stored = await tx.rawRecord.findMany({
        where: { sessionId: session.id },
        orderBy: { id: "desc" },
      });
      await projectSession(tx, session, stored.map(sourceRecord), {
        rescan: true,
      });
    });
    expect(
      await database.prisma.message.findMany({
        where: { sessionId: initial.result.sessionId },
        orderBy: { seq: "asc" },
      }),
    ).toEqual(rows);
    const fragmentedId = rawIds[0];
    if (!fragmentedId) throw new Error("Expected a raw record.");
    const largePayload = { text: "α".repeat(40_000) };
    await database.prisma.rawRecord.update({
      where: { id: fragmentedId },
      data: { payload: largePayload },
    });
    const fragmentIds: string[] = [];
    let fragments = "";
    do {
      const page = await sessions.raw(
        organization.context,
        initial.result.sessionId,
        {
          limit: 1,
          ...(cursor ? { cursor } : {}),
        },
      );
      for (const row of page.result.items) {
        fragmentIds.push(row.id);
        if (row.id === fragmentedId) {
          if (typeof row.payload !== "string")
            throw new Error("Expected a raw JSON fragment.");
          fragments += row.payload;
        }
      }
      cursor = page.result.cursor ?? undefined;
    } while (cursor);
    expect(fragmentIds.filter((id) => id === fragmentedId)).toHaveLength(2);
    expect(new Set(fragmentIds)).toEqual(new Set(rawIds));
    expect(JSON.parse(fragments)).toEqual(largePayload);
  });

  // @req R-ING-01 @req R-ING-02 @req R-ING-04 @req R-ING-06 @req R-ING-08 @req R-AUD-01 @req R-ARCH-04
  it("commits raw, projections, counters, receipt, and audit atomically; replays preserve identities", async () => {
    const request = envelope();
    request.records = [message(0, "Build the transactional session index")];
    const accepted = await ingest.execute(organization.context, request);
    expect(accepted.result.sessionId).toEqual(expect.any(String));
    expect(accepted.result).toEqual({
      sessionId: accepted.result.sessionId,
      accepted: 1,
      duplicates: 0,
      cursor: request.cursor,
    });
    const first = await database.prisma.message.findMany({
      where: { sessionId: accepted.result.sessionId },
    });
    expect(first).toHaveLength(1);
    expect(first[0]?.searchText).toBe("Build the transactional session index");
    expect(
      await database.prisma.auditEvent.findUnique({
        where: { id: accepted.audit.id },
      }),
    ).not.toBeNull();
    expect(
      (await ingest.execute(organization.context, request)).result,
    ).toEqual(accepted.result);
    const overlapping = await ingest.execute(
      organization.context,
      next(request),
    );
    expect(overlapping.result).toMatchObject({ accepted: 0, duplicates: 1 });
    const second = await database.prisma.message.findMany({
      where: { sessionId: accepted.result.sessionId },
    });
    expect(second).toEqual(first);
    expect(
      await database.prisma.agentSession.findUnique({
        where: { id: accepted.result.sessionId },
      }),
    ).toMatchObject({ messageCount: 1, toolCallCount: 0 });

    const failed = envelope();
    failed.records = [message(0, "Must roll back")];
    const write = database.audit.write.bind(database.audit);
    const spy = vi
      .spyOn(database.audit, "write")
      .mockImplementation(async (context, description, tx) => {
        if (description.action === "ingest" && description.statusCode === 202)
          throw new Error("Injected before commit");
        return write(context, description, tx);
      });
    await expect(
      ingest.execute(organization.context, failed),
    ).rejects.toMatchObject({ statusCode: 500 });
    spy.mockRestore();
    expect(
      await database.prisma.agentSession.count({
        where: { harnessSessionId: failed.harnessSessionId },
      }),
    ).toBe(0);
    expect(
      await database.prisma.ingestBatch.count({
        where: { id: failed.batchId },
      }),
    ).toBe(0);
  });

  // @req R-ING-03 @req R-ORG-06 @req R-ORG-07
  it("isolates identical native session ids across organizations and rejects different owners", async () => {
    const request = envelope();
    request.records = [message(0, "Primary tenant")];
    const first = await ingest.execute(organization.context, request);
    const foreign = {
      ...request,
      batchId: uuidv7(),
      records: [message(0, "Other tenant")],
    };
    const second = await ingest.execute(other.context, foreign);
    expect(second.result.sessionId).not.toBe(first.result.sessionId);
    const member = await provisionMember(
      database,
      organization.owner,
      "other-ingest-member@example.com",
    );
    await expect(
      ingest.execute(member.context, next(request)),
    ).rejects.toMatchObject({ statusCode: 409, code: "SESSION_OWNED" });
  });

  // @req R-ING-05 @req R-ING-07 @req R-ING-08
  it("orders late records and lifecycle by source rather than arrival, and does not reopen on final sync", async () => {
    const request = envelope();
    request.records = [message(20, "Later source record")];
    request.sourcePos = 20;
    const first = await ingest.execute(organization.context, request);
    await ingest.execute(
      organization.context,
      next(request, [message(10, "Earlier source record")]),
    );
    expect(
      (
        await database.prisma.message.findMany({
          where: { sessionId: first.result.sessionId },
          orderBy: { seq: "asc" },
        })
      ).map((row) => row.content),
    ).toEqual(["Earlier source record", "Later source record"]);
    const ended = next(request, []);
    ended.behavior = "end";
    await ingest.execute(organization.context, ended);
    await ingest.execute(organization.context, next(ended, []));
    expect(
      await database.prisma.agentSession.findUnique({
        where: { id: first.result.sessionId },
      }),
    ).toMatchObject({ status: "ENDED" });
    const resumed = next(ended, [message(30, "Resumed source record")]);
    resumed.behavior = "start";
    await ingest.execute(organization.context, resumed);
    await ingest.execute(organization.context, { ...ended, batchId: uuidv7() });
    expect(
      await database.prisma.agentSession.findUnique({
        where: { id: first.result.sessionId },
      }),
    ).toMatchObject({ status: "ACTIVE", messageCount: 3, endedAt: null });
  });

  // @req R-RED-05 @req R-ING-10
  it("defers unpaired sensitive results without persistence, then accepts a later input and retry", async () => {
    const request = envelope();
    const privateText =
      "private file contents that do not match a credential pattern";
    const result = {
      pos: 10,
      sourceVersion: 0,
      key: "result",
      line: JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "read-secret",
              content: privateText,
            },
          ],
        },
        toolUseResult: { file: { content: privateText } },
      }),
    };
    request.records = [result];
    request.sourcePos = 10;
    await expect(
      ingest.execute(organization.context, request),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "UNPAIRED_TOOL_RESULT",
      detail: { records: [{ pos: 10, key: "result" }] },
    });
    expect(
      await database.prisma.agentSession.count({
        where: { harnessSessionId: request.harnessSessionId },
      }),
    ).toBe(0);
    const input = {
      pos: 0,
      sourceVersion: 0,
      key: "input",
      line: JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "read-secret",
              name: "Read",
              input: { file_path: "/repo/.env" },
            },
          ],
        },
      }),
    };
    await ingest.execute(organization.context, next(request, [input]));
    const accepted = await ingest.execute(organization.context, next(request));
    const stored = await database.prisma.rawRecord.findMany({
      where: { sessionId: accepted.result.sessionId },
    });
    expect(JSON.stringify(stored.map((row) => row.payload))).not.toContain(
      privateText,
    );
    expect(
      (
        await database.prisma.message.findFirst({
          where: { sessionId: accepted.result.sessionId, kind: "TOOL_RESULT" },
        })
      )?.content,
    ).toContain("sensitive file output redacted");
  });

  // @req R-ING-04 @req R-HRN-04
  it("projects only latest mutable observations including A to B to A", async () => {
    const request = envelope("GEMINI_CLI");
    const record = (sourceVersion: number, text: string) => ({
      pos: 0,
      sourceVersion,
      key: `native:${String(sourceVersion)}:${text}`,
      line: JSON.stringify({
        id: "native",
        type: "gemini",
        content: text,
        tokens: { input: 10, output: 2 },
      }),
    });
    request.records = [record(0, "A")];
    const accepted = await ingest.execute(organization.context, request);
    await ingest.execute(organization.context, next(request, [record(1, "B")]));
    await ingest.execute(organization.context, next(request, [record(2, "A")]));
    expect(
      await database.prisma.rawRecord.count({
        where: { sessionId: accepted.result.sessionId },
      }),
    ).toBe(3);
    expect(
      await database.prisma.agentSession.findUnique({
        where: { id: accepted.result.sessionId },
      }),
    ).toMatchObject({ messageCount: 1, inputTokens: 10n, outputTokens: 2n });
    expect(
      (
        await database.prisma.message.findFirst({
          where: { sessionId: accepted.result.sessionId },
        })
      )?.content,
    ).toBe("A");
  });

  // @req R-HRN-06 @req R-ING-08
  it("persists active leaf changes without bytes and preserves prior projection until missing ancestors arrive", async () => {
    const request = envelope("PI");
    const row = (
      pos: number,
      id: string,
      parentId: string | null,
      text: string,
    ) => ({
      pos,
      key: id,
      sourceVersion: 0,
      line: JSON.stringify({
        type: "message",
        id,
        parentId,
        message: { role: "user", content: [{ type: "text", text }] },
      }),
    });
    request.records = [
      row(0, "a", null, "Root"),
      row(10, "b", "a", "First branch"),
      row(20, "c", "a", "Other branch"),
    ];
    request.sourcePos = 20;
    request.context.activeLeafId = "b";
    const accepted = await ingest.execute(organization.context, request);
    const changed = next(request, []);
    changed.context = { ...request.context, activeLeafId: "c" };
    await ingest.execute(organization.context, changed);
    expect(
      (
        await database.prisma.message.findMany({
          where: { sessionId: accepted.result.sessionId },
          orderBy: { seq: "asc" },
        })
      ).map((item) => item.content),
    ).toEqual(["Root", "Other branch"]);
    const pending = next(changed, []);
    pending.context = { ...changed.context, activeLeafId: "d" };
    await ingest.execute(organization.context, pending);
    expect(
      await database.prisma.message.count({
        where: { sessionId: accepted.result.sessionId },
      }),
    ).toBe(2);
    await ingest.execute(
      organization.context,
      next(pending, [row(30, "d", "c", "Now received")]),
    );
    expect(
      await database.prisma.message.count({
        where: { sessionId: accepted.result.sessionId },
      }),
    ).toBe(3);
  });

  // @req R-ING-15 @req R-RED-01 @req R-RED-02
  it("redacts envelope fields, structured records, audit, and opaque cursor storage", async () => {
    const request = envelope();
    const secret = "ac_" + "a".repeat(40);
    request.records = [message(0, `A credential ${secret}`)];
    request.context.cwd = `/repo/${secret}`;
    request.context.git = {
      root: "/repo",
      remoteUrl:
        "https://user:private-password@github.com/rek7/agentcommons.git",
      branch: secret,
      head: "abc",
    };
    request.cursor = secret;
    const value = await ingest.execute(
      { ...organization.context, userAgent: secret },
      request,
    );
    expect(value.result.cursor).toBe(secret);
    const session = await database.prisma.agentSession.findUniqueOrThrow({
      where: { id: value.result.sessionId },
    });
    expect(session.repoName).toBe("github.com/rek7/agentcommons");
    expect(session.cwd).not.toContain(secret);
    expect(session.title).not.toContain(secret);
    expect(session.branch).not.toContain(secret);
    const batch = await database.prisma.ingestBatch.findUniqueOrThrow({
      where: {
        organizationId_id: {
          organizationId:
            organization.context.caller?.organizationId ?? "missing",
          id: request.batchId,
        },
      },
    });
    expect(batch.cursor).not.toContain(secret);
    expect(batch.userAgent).not.toContain(secret);
    expect(
      await database.prisma.redactionEvent.count({
        where: { sessionId: session.id },
      }),
    ).toBeGreaterThan(0);
    expect(JSON.stringify(value.audit.detail)).not.toContain(secret);
  });

  // @req R-HRN-01 @req R-HRN-02 @req R-HRN-04 @req R-HRN-06 @req R-ING-12 @req R-ING-13 @req R-ING-14
  it.each([
    ["CLAUDE_CODE", "claude-code/parent.jsonl"],
    ["CODEX", "codex/parent-with-subagent.jsonl"],
    ["PI", "pi/cli-tool.jsonl"],
  ] as const)(
    "accepts live %s raw records and derives source projections",
    async (harness, path) => {
      const contents = await readFile(
        new URL(`../../../fixtures/transcripts/${path}`, import.meta.url),
        "utf8",
      );
      const request = envelope(harness);
      let pos = 0;
      request.records = contents
        .trim()
        .split("\n")
        .map((line) => {
          const record = { pos, sourceVersion: 0, key: null, line };
          pos += Buffer.byteLength(line) + 1;
          return record;
        });
      request.sourcePos = pos;
      const result = await ingest.execute(organization.context, request);
      expect(result.result.accepted).toBe(request.records.length);
      expect(
        await database.prisma.message.count({
          where: { sessionId: result.result.sessionId },
        }),
      ).toBeGreaterThan(0);
      expect(
        await database.prisma.rawRecord.count({
          where: { sessionId: result.result.sessionId },
        }),
      ).toBe(request.records.length);
    },
  );
});

describe("organization policies", () => {
  // @req R-RED-02 @req R-RED-03 @req R-RED-04 @req R-ORG-09
  it("isolates validated policies, invalidates cache, and protects builtins", async () => {
    const saved = await policy.save(organization.owner, null, {
      name: "private-phrase",
      kind: "REGEX",
      pattern: "internal-phrase",
      flags: "g",
      enabled: true,
    });
    expect(
      (
        await policy.list(organization.owner, {
          filters: {
            name: "PHRASE",
            kind: "REGEX",
            builtin: false,
            enabled: true,
          },
        })
      ).result.items.map((item) => item.id),
    ).toEqual([saved.result.id]);
    expect(
      (
        await policy.list(organization.owner, {
          filters: { name: "PHRASE", enabled: false },
        })
      ).result.items,
    ).toEqual([]);
    expect(
      (await policy.test(organization.owner, { text: "internal-phrase" }))
        .result.text,
    ).toBe("[REDACTED:private-phrase]");
    expect(
      (await policy.test(other.owner, { text: "internal-phrase" })).result.text,
    ).toBe("internal-phrase");
    await expect(
      policy.save(organization.owner, null, {
        name: "unsafe",
        kind: "REGEX",
        pattern: "(a|aa)+$",
        flags: "g",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const builtins = await policy.list(organization.owner, {});
    const builtin = builtins.result.items.find((item) => item.builtin);
    if (!builtin) throw new Error("Missing builtin");
    await expect(
      policy.remove(organization.owner, builtin.id, { reason: "test" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await policy.remove(organization.owner, saved.result.id, {
      reason: "No longer needed",
    });
    expect(
      (await policy.test(organization.owner, { text: "internal-phrase" }))
        .result.text,
    ).toBe("internal-phrase");
  });
});
