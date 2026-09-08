import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Harness, IngestEnvelope } from "../packages/core/src/index.js";
import { IngestService } from "../apps/api/src/services/ingest.js";
import { PolicyService } from "../apps/api/src/services/policies.js";
import { CursorCodec } from "../apps/api/src/services/cursor.js";
import {
  startDatabase,
  provisionOrganization,
} from "../apps/api/test/support.js";

let database: Awaited<ReturnType<typeof startDatabase>>;
let primary: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let ingest: IngestService;
let policies: PolicyService;
function envelope(
  harness: Harness = "CLAUDE_CODE",
): IngestEnvelope & { sourcePos: number } {
  return {
    envelopeVersion: 2,
    harness,
    harnessSessionId: randomUUID(),
    behavior: "start",
    nativeEvent: "SessionStart",
    start: { resume: false },
    batchId: randomUUID(),
    installationId: randomUUID(),
    sentAt: "2026-09-07T00:00:00Z",
    sourcePos: 0,
    context: {
      cwd: "/repo",
      installation: {
        hostname: "review-host",
        osUser: "review-user",
        platform: "linux",
        arch: "x64",
      },
      git: null,
      parentHint: null,
    },
    records: [],
    cursor: "initial",
    end: null,
  };
}
function record(
  pos: number,
  payload: Record<string, unknown>,
  key = `record-${String(pos)}`,
) {
  return { pos, sourceVersion: 0, key, line: JSON.stringify(payload) };
}
function text(pos: number, content: string) {
  return record(pos, {
    type: "user",
    message: { content: [{ type: "text", text: content }] },
  });
}
function next(
  input: IngestEnvelope,
  override: Partial<IngestEnvelope> = {},
): IngestEnvelope {
  return {
    ...input,
    batchId: randomUUID(),
    start:
      override.behavior && override.behavior !== "start" ? null : input.start,
    ...override,
  };
}
function upload(input: IngestEnvelope, organization = primary) {
  return ingest.execute(
    { ...organization.context, requestId: randomUUID(), startedAt: Date.now() },
    input,
  );
}
beforeAll(async () => {
  database = await startDatabase();
  primary = await provisionOrganization(database, "review-primary");
  other = await provisionOrganization(database, "review-other");
  ingest = new IngestService({
    prisma: database.prisma,
    audit: database.audit,
    policies: database.policies,
  });
  policies = new PolicyService({
    prisma: database.prisma,
    audit: database.audit,
    cache: database.policies,
    cursors: new CursorCodec("independent-review-cursor-secret"),
  });
});
afterAll(async () => {
  await database.close();
});

describe("independent ingestion adversarial review", () => {
  // @req R-ING-07
  it("does not promote an old source event to the latest position even if its client clock is later", async () => {
    const initial = envelope();
    initial.records = [text(0, "Before resume")];
    const created = await upload(initial);
    await upload(
      next(initial, {
        records: [text(10, "After resume")],
        sourcePos: 10,
        sentAt: "2026-09-07T00:00:10Z",
      }),
    );
    await upload(
      next(initial, {
        behavior: "end",
        sourcePos: 0,
        sentAt: "2026-09-07T00:00:20Z",
        end: {
          reason: "delayed old end",
          head: null,
          observedCommits: [],
          observedDiffStat: null,
          dirtyFileCount: null,
        },
      }),
    );
    expect(
      await database.prisma.agentSession.findUnique({
        where: { id: created.result.sessionId },
      }),
    ).toMatchObject({ status: "ACTIVE", endedAt: null, lifecyclePos: 10n });
    await upload(
      next(initial, {
        records: [],
        behavior: "end",
        sourcePos: 0,
        sentAt: "2026-09-07T00:00:30Z",
        end: {
          reason: "delayed empty old end",
          head: null,
          observedCommits: [],
          observedDiffStat: null,
          dirtyFileCount: null,
        },
      }),
    );
    expect(
      await database.prisma.agentSession.findUnique({
        where: { id: created.result.sessionId },
      }),
    ).toMatchObject({ status: "ACTIVE", endedAt: null, lifecyclePos: 10n });
  });

  // @req R-RED-05
  it("retains sensitive-file classification after the input path is redacted by an organization policy", async () => {
    const saved = await policies.save(primary.owner, null, {
      name: "mask-sensitive-path",
      kind: "REGEX",
      pattern: "\\.env",
      flags: "g",
    });
    try {
      const initial = envelope();
      initial.records = [
        record(0, {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "sensitive-call",
                name: "Read",
                input: { file_path: "/repo/.env" },
              },
            ],
          },
        }),
      ];
      const first = await upload(initial);
      const privateText =
        "private contents without a recognizable credential shape";
      const result = record(10, {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "sensitive-call",
              content: privateText,
            },
          ],
        },
        toolUseResult: { file: { content: privateText } },
      });
      await upload(
        next(initial, { behavior: "sync", sourcePos: 10, records: [result] }),
      );
      const raw = await database.prisma.rawRecord.findMany({
        where: { sessionId: first.result.sessionId },
      });
      const messages = await database.prisma.message.findMany({
        where: { sessionId: first.result.sessionId },
      });
      expect(JSON.stringify(raw.map((row) => row.payload))).not.toContain(
        privateText,
      );
      expect(
        messages.find((row) => row.kind === "TOOL_RESULT")?.content,
      ).toContain("sensitive file output redacted");
    } finally {
      await policies.remove(primary.owner, saved.result.id, {
        reason: "Review fixture cleanup",
      });
    }
  });

  it("pairs later tool results using canonical identity after native call IDs are redacted", async () => {
    const initial = envelope();
    const nativeId = `ac_${"b".repeat(40)}`;
    initial.records = [
      record(0, {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: nativeId,
              name: "Read",
              input: { file_path: "/repo/readme.md" },
            },
          ],
        },
      }),
    ];
    const first = await upload(initial);
    await upload(
      next(initial, {
        behavior: "sync",
        sourcePos: 10,
        records: [
          record(10, {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: nativeId,
                  content: "Readable non-sensitive output",
                },
              ],
            },
          }),
        ],
      }),
    );
    const messages = await database.prisma.message.findMany({
      where: { sessionId: first.result.sessionId },
      orderBy: { seq: "asc" },
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.toolUseId).toBe(messages[1]?.toolUseId);
    expect(messages[1]?.toolName).toBe("Read");
    expect(JSON.stringify(messages)).not.toContain(nativeId);
  });

  // @req R-ORG-06
  it("allows independent organizations to reuse an otherwise identical batch UUID", async () => {
    const request = envelope();
    request.records = [text(0, "Tenant-local batch identity")];
    const first = await upload(request);
    const second = await upload(request, other);
    expect(second.result.sessionId).not.toBe(first.result.sessionId);
    expect(second.result.accepted).toBe(1);
    expect(
      await database.prisma.ingestBatch.count({
        where: { id: request.batchId },
      }),
    ).toBe(2);
  });

  // @req R-ING-02 @req R-ING-10
  it("rejects a malformed record without partially persisting otherwise valid records", async () => {
    const initial = envelope();
    initial.records = [
      text(0, "Must remain absent"),
      { pos: 10, sourceVersion: 0, key: "invalid", line: "{ invalid JSON" },
    ];
    initial.sourcePos = 10;
    await expect(upload(initial)).rejects.toMatchObject({
      statusCode: 422,
      code: "INVALID_RECORD",
      detail: { records: [{ pos: 10, key: "invalid" }] },
    });
    expect(
      await database.prisma.agentSession.count({
        where: { harnessSessionId: initial.harnessSessionId },
      }),
    ).toBe(0);
    expect(
      await database.prisma.ingestBatch.count({
        where: { id: initial.batchId },
      }),
    ).toBe(0);
  });
  it("does not apply free-text policies to typed envelope discriminators", async () => {
    const saved = await policies.save(primary.owner, null, {
      name: "protocol-word",
      kind: "REGEX",
      pattern: "CLAUDE_CODE",
      flags: "g",
    });
    try {
      const request = envelope();
      request.records = [
        text(0, "A valid CLAUDE_CODE transcript remains ingestible"),
      ];
      const result = await upload(request);
      expect(result.result.accepted).toBe(1);
      expect(
        await database.prisma.agentSession.findUnique({
          where: { id: result.result.sessionId },
        }),
      ).toMatchObject({ harness: "CLAUDE_CODE" });
      expect(
        (
          await database.prisma.message.findFirst({
            where: { sessionId: result.result.sessionId },
          })
        )?.content,
      ).not.toContain("CLAUDE_CODE");
    } finally {
      await policies.remove(primary.owner, saved.result.id, {
        reason: "Review fixture cleanup",
      });
    }
  });

  it("rejects secret-bearing policy names before a generated replacement can persist a credential", async () => {
    const created: { id: string | null } = { id: null };
    try {
      await expect(
        policies
          .save(primary.owner, null, {
            name: `ac_${"c".repeat(40)}`,
            kind: "REGEX",
            pattern: "review-placeholder",
            flags: "g",
          })
          .then((result) => {
            created.id = result.result.id;
            return result;
          }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "POLICY_CONTAINS_SECRET",
      });
    } finally {
      if (created.id)
        await policies.remove(primary.owner, created.id, {
          reason: "Review fixture cleanup",
        });
    }
  });

  it("serializes concurrent opposite parent links so the organization graph remains acyclic", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const left = envelope();
      const right = envelope();
      const [a, b] = await Promise.all([upload(left), upload(right)]);
      await Promise.all([
        upload(
          next(left, {
            behavior: "sync",
            context: {
              ...left.context,
              parentHint: {
                harnessSessionId: right.harnessSessionId,
                relation: "SPAWNED",
              },
            },
          }),
        ),
        upload(
          next(right, {
            behavior: "sync",
            context: {
              ...right.context,
              parentHint: {
                harnessSessionId: left.harnessSessionId,
                relation: "SPAWNED",
              },
            },
          }),
        ),
      ]);
      const rows = await database.prisma.agentSession.findMany({
        where: { id: { in: [a.result.sessionId, b.result.sessionId] } },
        select: { id: true, parentSessionId: true },
      });
      expect(rows.filter((row) => row.parentSessionId !== null)).toHaveLength(
        1,
      );
    }
  });
});

// @req R-LNK-04
it("resolves redacted parent identities from both hook hints and native records, including late parents", async () => {
  for (const mode of ["hook", "native"] as const) {
    const parent = envelope(mode === "hook" ? "CLAUDE_CODE" : "CODEX");
    parent.harnessSessionId = `ac_${(mode === "hook" ? "d" : "e").repeat(40)}`;
    const child = envelope(parent.harness);
    if (mode === "hook") {
      child.context.parentHint = {
        harnessSessionId: parent.harnessSessionId,
        relation: "SPAWNED",
      };
      child.records = [text(0, "Child before parent")];
    } else {
      child.records = [
        record(0, {
          type: "session_meta",
          payload: {
            id: child.harnessSessionId,
            parent_thread_id: parent.harnessSessionId,
            timestamp: "2026-09-07T00:00:00Z",
            git: { branch: "native-branch" },
          },
        }),
      ];
    }
    const first = await upload(child);
    const arrival = await upload(parent);
    const row = await database.prisma.agentSession.findUniqueOrThrow({
      where: { id: first.result.sessionId },
    });
    const parentRow = await database.prisma.agentSession.findUniqueOrThrow({
      where: { id: arrival.result.sessionId },
    });
    expect(row.parentSessionId).toBe(parentRow.id);
    expect(row.parentNativeRef).toBe(parentRow.harnessSessionId);
    expect(row.parentNativeRef).toMatch(/^redacted-[a-f0-9]{64}$/);
    if (mode === "native") expect(row.branch).toBe("native-branch");
    const raw = await database.prisma.rawRecord.findMany({
      where: { sessionId: row.id },
    });
    expect(JSON.stringify(raw.map((item) => item.payload))).not.toContain(
      parent.harnessSessionId,
    );
  }
});

// @req R-RED-02
it("accepts an upload using a stale process policy cache after that policy and its counters are deleted", async () => {
  const saved = await policies.save(primary.owner, null, {
    name: "stale-process",
    kind: "REGEX",
    pattern: "private-cache-marker",
    flags: "g",
  });
  const cached = await database.policies.get(
    primary.owner.caller?.organizationId ?? "",
  );
  await policies.remove(primary.owner, saved.result.id, {
    reason: "Delete custom policy on another process",
  });
  const staleProcess = vi
    .spyOn(database.policies, "get")
    .mockResolvedValue(cached);
  try {
    const request = envelope();
    request.records = [text(0, "private-cache-marker")];
    const result = await upload(request);
    expect(result.result.accepted).toBe(1);
    expect(
      await database.prisma.redactionEvent.count({
        where: { policyId: saved.result.id },
      }),
    ).toBe(0);
    const messages = await database.prisma.message.findMany({
      where: { sessionId: result.result.sessionId },
    });
    expect(messages[0]?.content).toBe("[REDACTED:stale-process]");
  } finally {
    staleProcess.mockRestore();
  }
});
