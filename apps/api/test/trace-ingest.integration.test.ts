import { TraceReaders } from "@agentcommons/traces";
import { traceServices } from "./trace-services.js";
import { EmbeddingService } from "../src/embeddings/service.js";
import { FakeEmbeddingProvider } from "../src/embeddings/provider.js";
import { AdminService } from "../src/services/admin.js";
import { CursorCodec } from "../src/services/cursor.js";
import { TraceAuditProjectionService } from "../src/services/trace-audit-projection.js";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { PrismaClient, lockTracePublication } from "@agentcommons/db";
import { ingestEnvelopeSchema } from "@agentcommons/core";
import { createClient } from "@clickhouse/client";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { provisionOrganization } from "./support.js";
import { cleanup } from "../../../scripts/cleanup.js";
import { IngestService } from "../src/services/ingest.js";
import { TraceProjectionService } from "../src/services/trace-projection.js";
import { JobService } from "../src/services/jobs.js";
import { AuditService } from "../src/services/audit.js";
import { createPolicyCache } from "../src/services/policy-cache.js";
import { requireCaller } from "../src/services/context.js";
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let prisma: PrismaClient;
let jobs: JobService;
let projection: TraceProjectionService;
let ingest: IngestService;
let audit: AuditService;
const release: Array<() => Promise<unknown>> = [];
const workerErrors: Error[] = [];
beforeAll(async () => {
  db = await startTraceDatabase();
  release.unshift(() => db.close());
  prisma = new PrismaClient({ datasourceUrl: db.urls.app });
  release.unshift(() => prisma.$disconnect());
  audit = new AuditService(prisma, createPolicyCache(prisma));
  projection = new TraceProjectionService({
    prisma,
    audit,
    repository: db.traces,
  });
  jobs = new JobService({
    prisma,
    audit,
    traces: projection,
    traceAudit: new TraceAuditProjectionService({
      prisma,
      audit,
      traces: db.traces,
    }),
    connectionString: db.urls.app,
    allowedEmailDomains: [],
    auditRetentionDays: 365,
    onError: (error) => workerErrors.push(error),
  });
  release.unshift(() => jobs.stop());
  ingest = new IngestService({ prisma, audit, traces: jobs });
});
afterAll(async () => {
  expect(await cleanup(release)).toEqual([]);
  expect(workerErrors).toEqual([]);
});
async function captured() {
  const lines = (
    await readFile(
      new URL(
        "../../../fixtures/transcripts/tool-identities/claude.jsonl",
        import.meta.url,
      ),
      "utf8",
    )
  )
    .trimEnd()
    .split("\n");
  return ingestEnvelopeSchema.parse({
    envelopeVersion: 2,
    hook: { sha256: "a".repeat(64), extensionSha256: null },
    harness: "CLAUDE_CODE",
    harnessSessionId: randomUUID(),
    installationId: randomUUID(),
    batchId: randomUUID(),
    behavior: "sync",
    nativeEvent: "Stop",
    start: null,
    sentAt: new Date().toISOString(),
    sourcePos: lines.length,
    cursor: "capture",
    end: null,
    context: {
      cwd: "/trace",
      installation: {
        hostname: "trace",
        osUser: "developer",
        platform: "linux",
        arch: "x64",
      },
      git: null,
      parentHint: null,
    },
    records: lines.map((line, pos) => ({
      pos,
      key: `fixture-${String(pos)}`,
      sourceVersion: 0,
      line,
    })),
  });
}
// @req R-ING-01 @req R-ING-04 @req R-AUD-01
it("acknowledges durable redacted queue acceptance then publishes the captured projection exactly once", async () => {
  const org = await provisionOrganization(db, "trace-queue");
  const caller = requireCaller(org.context);
  const envelope = await captured();
  const queued = await ingest.execute(org.context, envelope);
  expect(queued.result.publication).toBe("queued");
  expect(
    await prisma.traceOutbox.count({
      where: { organizationId: caller.organizationId },
    }),
  ).toBe(1);
  expect(
    await prisma.traceSourceAdmission.count({
      where: { organizationId: caller.organizationId },
    }),
  ).toBe(envelope.records.length);
  const before = await db.traceReaders.read(caller, (client) =>
    client.query("SELECT count() AS count FROM sessions"),
  );
  expect(Number(before.rows[0]?.count)).toBe(0);
  await projection.process(caller.organizationId, queued.result.sessionId);
  const control = await prisma.traceSessionControl.findUniqueOrThrow({
    where: {
      organizationId_id: {
        organizationId: caller.organizationId,
        id: queued.result.sessionId,
      },
    },
  });
  expect(control).toMatchObject({
    acceptedRevision: 1n,
    publishedRevision: 1n,
    projectionState: "published",
  });
  expect(
    await prisma.traceOutbox.count({
      where: { organizationId: caller.organizationId },
    }),
  ).toBe(0);
  const visible = await db.traceReaders.read(caller, (client) =>
    client.query("SELECT session_id,message_count FROM sessions"),
  );
  expect(visible.rows).toHaveLength(1);
  expect(Number(visible.rows[0]?.message_count)).toBeGreaterThan(0);
  expect((await ingest.execute(org.context, envelope)).result).toEqual({
    ...queued.result,
    publication: "published",
  });
  expect(
    await prisma.traceSourceAdmission.count({
      where: { organizationId: caller.organizationId },
    }),
  ).toBe(envelope.records.length);
});
// @req R-ING-02 @req R-ING-04
it("accepts and replays a durable batch while the real ClickHouse server is paused", async () => {
  const org = await provisionOrganization(db, "trace-offline-admission");
  const caller = requireCaller(org.context);
  const envelope = await captured();
  const docker = (action: "pause" | "unpause") =>
    promisify(execFile)("docker", [action, db.traceContainer.getId()], {
      timeout: 10_000,
    });
  await docker("pause");
  let sessionId: string;
  try {
    const accepted = await ingest.execute(org.context, envelope);
    sessionId = accepted.result.sessionId;
    expect(accepted.result.publication).toBe("queued");
    expect((await ingest.execute(org.context, envelope)).result).toEqual(
      accepted.result,
    );
    expect(
      await prisma.traceOutbox.count({
        where: { organizationId: caller.organizationId, sessionId },
      }),
    ).toBe(1);
    expect(
      await prisma.traceSourceAdmission.count({
        where: { organizationId: caller.organizationId, sessionId },
      }),
    ).toBe(envelope.records.length);
  } finally {
    await docker("unpause");
  }
  await projection.process(caller.organizationId, sessionId);
  expect((await ingest.execute(org.context, envelope)).result.publication).toBe(
    "published",
  );
  expect(
    await prisma.traceOutbox.count({
      where: { organizationId: caller.organizationId, sessionId },
    }),
  ).toBe(0);
});
// @req R-ING-04 @req R-AUD-01
it("keeps partial ClickHouse writes invisible and retains the outbox until retry publishes", async () => {
  const org = await provisionOrganization(db, "trace-retry");
  const caller = requireCaller(org.context);
  const envelope = await captured();
  const queued = await ingest.execute(org.context, envelope);
  const failure = vi
    .spyOn(db.traces, "writeProjection")
    .mockRejectedValueOnce(
      new Error("Injected sink failure after raw insertion"),
    );
  await expect(
    projection.process(caller.organizationId, queued.result.sessionId),
  ).rejects.toThrow("Trace publication failed");
  failure.mockRestore();
  expect(
    await prisma.traceOutbox.count({
      where: { organizationId: caller.organizationId },
    }),
  ).toBe(1);
  const hidden = await db.traceReaders.read(caller, (client) =>
    client.query("SELECT count() AS count FROM raw_records"),
  );
  expect(Number(hidden.rows[0]?.count)).toBe(0);
  expect((await ingest.execute(org.context, envelope)).result.publication).toBe(
    "queued",
  );
  await projection.process(caller.organizationId, queued.result.sessionId);
  const visible = await db.traceReaders.read(caller, (client) =>
    client.query("SELECT count() AS count FROM raw_records"),
  );
  expect(Number(visible.rows[0]?.count)).toBe(envelope.records.length);
  expect(
    await prisma.traceOutbox.count({
      where: { organizationId: caller.organizationId },
    }),
  ).toBe(0);
});
// @req R-ING-02 @req R-ING-04 @req R-AUD-01
it("recovers accepted payloads after native delivery retention and an abandoned projection lease", async () => {
  const org = await provisionOrganization(db, "trace-recovery");
  const caller = requireCaller(org.context);
  const envelope = await captured();
  const accepted = await ingest.execute(org.context, envelope);
  const queued = await prisma.traceOutbox.findFirstOrThrow({
    where: {
      organizationId: caller.organizationId,
      sessionId: accepted.result.sessionId,
    },
  });
  // pg-boss owns delivery retention; the compact outbox must survive its deletion.
  expect(
    await db.prisma
      .$executeRaw`DELETE FROM pgboss.job WHERE name='trace-projection' AND data->>'outboxId'=${queued.id}`,
  ).toBe(1);
  await prisma.traceSessionControl.update({
    where: {
      organizationId_id: {
        organizationId: caller.organizationId,
        id: accepted.result.sessionId,
      },
    },
    data: { projectionLease: randomUUID(), projectionLeaseUntil: new Date(0) },
  });
  const recovered = traceServices(db, prisma);
  try {
    await recovered.jobs.start();
    await expect
      .poll(
        async () =>
          (
            await prisma.traceSessionControl.findFirstOrThrow({
              where: {
                organizationId: caller.organizationId,
                id: accepted.result.sessionId,
              },
            })
          ).projectionState,
        { timeout: 20_000, interval: 100 },
      )
      .toBe("published");
    expect(await prisma.traceOutbox.count({ where: { id: queued.id } })).toBe(
      0,
    );
    expect(
      await recovered.raw(caller.organizationId, accepted.result.sessionId),
    ).toHaveLength(envelope.records.length);
    expect((await ingest.execute(org.context, envelope)).result).toEqual({
      ...accepted.result,
      publication: "published",
    });
    expect(
      await prisma.traceSourceAdmission.count({
        where: {
          organizationId: caller.organizationId,
          sessionId: accepted.result.sessionId,
        },
      }),
    ).toBe(envelope.records.length);
    expect(
      await prisma.auditEvent.count({
        where: {
          organizationId: caller.organizationId,
          action: "trace.publish",
          statusCode: 200,
        },
      }),
    ).toBe(1);
  } finally {
    await recovered.close();
  }
});
// @req R-ING-04
it("appends one changed message without copying the captured raw corpus or unchanged messages", async () => {
  const org = await provisionOrganization(db, "trace-deltas");
  const caller = requireCaller(org.context);
  const envelope = await captured();
  const first = await ingest.execute(org.context, envelope);
  await projection.process(caller.organizationId, first.result.sessionId);
  const next = {
    ...envelope,
    batchId: randomUUID(),
    cursor: "next",
    sourcePos: envelope.sourcePos + 1,
    records: [
      {
        pos: envelope.sourcePos + 1,
        key: randomUUID(),
        sourceVersion: 0,
        line: JSON.stringify({
          type: "user",
          uuid: randomUUID(),
          message: {
            role: "user",
            content: "One newly appended native user message",
          },
        }),
      },
    ],
  };
  await ingest.execute(org.context, next);
  await projection.process(caller.organizationId, first.result.sessionId);
  const raw = createClient({
    url: db.traceConfig.url,
    username: db.traceMigration.username,
    password: db.traceMigration.password,
  });
  try {
    const response = await raw.query({
      query:
        "SELECT countIf(revision=2) AS changed FROM ac_trace.messages FINAL WHERE organization_id={organization:String} AND session_id={session:UUID}",
      query_params: {
        organization: caller.organizationId,
        session: first.result.sessionId,
      },
      format: "JSONEachRow",
    });
    expect(await response.json()).toEqual([{ changed: 1 }]);
    const records = await raw.query({
      query:
        "SELECT countIf(revision=2) AS changed FROM ac_trace.raw_records FINAL WHERE organization_id={organization:String} AND session_id={session:UUID}",
      query_params: {
        organization: caller.organizationId,
        session: first.result.sessionId,
      },
      format: "JSONEachRow",
    });
    expect(await records.json()).toEqual([{ changed: 1 }]);
  } finally {
    await raw.close();
  }
});
// @req R-SAAS-03 @req R-SAAS-04
it("rejects an over-allowance capture before committing source identities, receipts or payloads", async () => {
  const org = await provisionOrganization(db, "trace-free-cap");
  const caller = requireCaller(org.context);
  const envelope = await captured();
  const limited = new IngestService({
    prisma,
    audit,
    traces: jobs,
    billing: {
      mode: "saas",
      freeMonthlyRecords: envelope.records.length - 1,
      proIncludedRecords: 10000,
      captureCentsPer1000: null,
      embeddingCentsPer1000: null,
      captureEventName: null,
      embeddingEventName: null,
      calComUrl: null,
    },
  });
  await expect(limited.execute(org.context, envelope)).rejects.toMatchObject({
    statusCode: 402,
    code: "USAGE_LIMIT_REACHED",
  });
  expect(
    await prisma.traceReceipt.count({
      where: { organizationId: caller.organizationId },
    }),
  ).toBe(0);
  expect(
    await prisma.traceSourceAdmission.count({
      where: { organizationId: caller.organizationId },
    }),
  ).toBe(0);
  expect(
    await prisma.traceOutbox.count({
      where: { organizationId: caller.organizationId },
    }),
  ).toBe(0);
  expect(
    await prisma.usageAdmission.count({
      where: { organizationId: caller.organizationId },
    }),
  ).toBe(0);
});

// @req R-EMB-02 @req R-EMB-04 @req R-EMB-05
it("indexes real published messages with the deterministic provider and fences a failed same-source vector rebuild", async () => {
  const org = await provisionOrganization(db, "trace-vectors");
  const caller = requireCaller(org.context);
  const first = await ingest.execute(org.context, await captured());
  await projection.process(caller.organizationId, first.result.sessionId);
  await prisma.organizationSettings.upsert({
    where: { organizationId: caller.organizationId },
    create: { organizationId: caller.organizationId, embeddingsEnabled: true },
    update: { embeddingsEnabled: true },
  });
  const provider = new FakeEmbeddingProvider();
  const embed = vi.spyOn(provider, "embed");
  const service = new EmbeddingService({
    prisma,
    audit,
    policies: createPolicyCache(prisma),
    traces: db.traces,
    provider,
    dailyTokenBudget: 1000000,
  });
  await service.initialize();
  const target = {
    organizationId: caller.organizationId,
    sessionId: first.result.sessionId,
  };
  expect(await service.process(target)).toMatchObject({ complete: true });
  expect(embed).toHaveBeenCalledTimes(1);
  const control = await prisma.traceSessionControl.findUniqueOrThrow({
    where: {
      organizationId_id: {
        organizationId: caller.organizationId,
        id: target.sessionId,
      },
    },
  });
  expect(control.embeddingSourceRevision).toBe(control.publishedRevision);
  expect(control.embeddingRevision).not.toBeNull();
  const visible = () =>
    db.traceReaders.read(caller, (client) =>
      client.query(
        "SELECT count() AS count FROM message_chunks WHERE session_id={session:UUID}",
        { session: target.sessionId },
      ),
    );
  const count = Number((await visible()).rows[0]?.count);
  expect(count).toBeGreaterThan(0);
  const headers = await db.traceReaders.read(caller, (client) =>
    client.query(
      "SELECT length(embedding) AS dimensions FROM session_embeddings WHERE session_id={session:UUID}",
      { session: target.sessionId },
    ),
  );
  expect(headers.rows).toHaveLength(1);
  expect(Number(headers.rows[0]?.dimensions)).toBe(1024);
  await prisma.redactionPolicy.create({
    data: {
      organizationId: caller.organizationId,
      id: randomUUID(),
      name: "new-index-policy",
      kind: "REGEX",
      pattern: "nonmatching-embedding-word",
      flags: "g",
      replacement: "[REMOVED]",
      enabled: true,
    },
  });
  const original = db.traces.writeEmbeddings.bind(db.traces);
  const failure = vi
    .spyOn(db.traces, "writeEmbeddings")
    .mockImplementationOnce(async (scope, input) => {
      await original(scope, input);
      throw new Error("lost vector write acknowledgement");
    });
  await expect(service.process(target)).rejects.toThrow(
    "Embedding publication must retry",
  );
  failure.mockRestore();
  expect(Number((await visible()).rows[0]?.count)).toBe(count);
  expect(
    (
      await prisma.traceSessionControl.findUniqueOrThrow({
        where: {
          organizationId_id: {
            organizationId: caller.organizationId,
            id: target.sessionId,
          },
        },
      })
    ).embeddingRevision,
  ).toBe(control.embeddingRevision);
  const calls = embed.mock.calls.length;
  expect(await service.process(target)).toMatchObject({ complete: true });
  expect(embed.mock.calls).toHaveLength(calls);
  expect(
    (
      await prisma.traceSessionControl.findUniqueOrThrow({
        where: {
          organizationId_id: {
            organizationId: caller.organizationId,
            id: target.sessionId,
          },
        },
      })
    ).embeddingRevision,
  ).not.toBe(control.embeddingRevision);
});

// @req R-EMB-06
it("discards a provider response completed after organization disable and re-enable", async () => {
  const org = await provisionOrganization(db, "trace-vector-race");
  const caller = requireCaller(org.context);
  const first = await ingest.execute(org.context, await captured());
  await projection.process(caller.organizationId, first.result.sessionId);
  await prisma.organizationSettings.upsert({
    where: { organizationId: caller.organizationId },
    create: { organizationId: caller.organizationId, embeddingsEnabled: true },
    update: { embeddingsEnabled: true },
  });
  const provider = new FakeEmbeddingProvider();
  const actual = provider.embed.bind(provider);
  const changed = vi
    .spyOn(provider, "embed")
    .mockImplementationOnce(async (inputs) => {
      await prisma.organizationSettings.update({
        where: { organizationId: caller.organizationId },
        data: { embeddingsEnabled: false, revision: { increment: 1 } },
      });
      await prisma.organizationSettings.update({
        where: { organizationId: caller.organizationId },
        data: { embeddingsEnabled: true, revision: { increment: 1 } },
      });
      return actual(inputs);
    });
  const service = new EmbeddingService({
    prisma,
    audit,
    policies: createPolicyCache(prisma),
    traces: db.traces,
    provider,
    dailyTokenBudget: 1000000,
  });
  const target = {
    organizationId: caller.organizationId,
    sessionId: first.result.sessionId,
  };
  expect(await service.process(target)).toMatchObject({ complete: false });
  expect(
    (
      await prisma.traceSessionControl.findUniqueOrThrow({
        where: {
          organizationId_id: {
            organizationId: caller.organizationId,
            id: target.sessionId,
          },
        },
      })
    ).embeddingRevision,
  ).toBeNull();
  expect(await service.process(target)).toMatchObject({ complete: true });
  expect(changed).toHaveBeenCalledTimes(2);
});

// @req R-MOD-02
it("fences purged corpus immediately and completes native cleanup with a durable logical manifest", async () => {
  const org = await provisionOrganization(db, "trace-purge");
  const caller = requireCaller(org.context);
  const first = await ingest.execute(org.context, await captured());
  await projection.process(caller.organizationId, first.result.sessionId);
  const admin = new AdminService({
    prisma,
    audit,
    readers: db.traceReaders,
    cursors: new CursorCodec("trace-purge-cursor-secret"),
    jobs,
  });
  const accepted = await admin.purge(org.owner, {
    session_id: first.result.sessionId,
    reason: "Remove the captured trace",
  });
  expect(accepted.result.cleanup).toBe("queued");
  expect(accepted.result.manifest.deleted.raw_records).toBeNull();
  const visible = await db.traceReaders.read(caller, (client) =>
    client.query(
      "SELECT count() AS count FROM raw_records WHERE session_id={session:UUID}",
      { session: first.result.sessionId },
    ),
  );
  expect(Number(visible.rows[0]?.count)).toBe(0);
  const failed = vi
    .spyOn(db.traces, "cleanupSession")
    .mockRejectedValueOnce(new Error("temporary cleanup failure"));
  await expect(
    projection.process(caller.organizationId, first.result.sessionId),
  ).rejects.toThrow("Physical trace cleanup must retry");
  failed.mockRestore();
  await projection.process(caller.organizationId, first.result.sessionId);
  const completed = await admin.purge(org.owner, {
    session_id: first.result.sessionId,
    reason: "Confirm physical cleanup",
  });
  expect(completed.result.cleanup).toBe("completed");
  expect(completed.result.manifest.deleted.raw_records).toBeGreaterThan(0);
  expect(completed.result.manifest.deleted.messages).toBeGreaterThan(0);
  expect(
    await db.traces.sessionCounts({
      organizationId: caller.organizationId,
      sessionId: first.result.sessionId,
    }),
  ).toEqual({
    raw_records: 0,
    messages: 0,
    session_files: 0,
    message_chunks: 0,
    session_embeddings: 0,
  });
});

// @req R-RED-06
it("cancels a rescan whose key is revoked after native writes without blocking later accepted uploads", async () => {
  const org = await provisionOrganization(db, "trace-revoked-rescan");
  const caller = requireCaller(org.context);
  const envelope = await captured();
  const first = await ingest.execute(org.context, envelope);
  await projection.process(caller.organizationId, first.result.sessionId);
  const runId = randomUUID();
  const outboxId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.redactionRun.create({
      data: {
        organizationId: caller.organizationId,
        id: runId,
        totalSessions: 1,
      },
    });
    await tx.redactionRunSession.create({
      data: {
        organizationId: caller.organizationId,
        runId,
        sessionId: first.result.sessionId,
      },
    });
    await tx.traceOutbox.create({
      data: {
        id: outboxId,
        organizationId: caller.organizationId,
        sessionId: first.result.sessionId,
        revision: 2n,
        kind: "rescan",
        payload: {
          organizationId: caller.organizationId,
          runId,
          caller,
          requestId: org.context.requestId,
          input: { reason: "Reapply all active policies" },
        },
      },
    });
    await tx.traceSessionControl.update({
      where: {
        organizationId_id: {
          organizationId: caller.organizationId,
          id: first.result.sessionId,
        },
      },
      data: { acceptedRevision: 2n },
    });
  });
  const original = db.traces.writeProjection.bind(db.traces);
  const revoke = vi
    .spyOn(db.traces, "writeProjection")
    .mockImplementationOnce(async (input) => {
      await original(input);
      await prisma.apikey.update({
        where: { id: caller.apiKeyId ?? "" },
        data: { enabled: false },
      });
    });
  await expect(
    projection.process(caller.organizationId, first.result.sessionId),
  ).rejects.toThrow("Trace publication failed");
  revoke.mockRestore();
  expect(
    (
      await prisma.traceSessionControl.findUniqueOrThrow({
        where: {
          organizationId_id: {
            organizationId: caller.organizationId,
            id: first.result.sessionId,
          },
        },
      })
    ).redactionGeneration,
  ).toBe(0n);
  let publicationHeld: (pid: number) => void = () => {};
  const held = new Promise<number>((resolve) => {
    publicationHeld = resolve;
  });
  let allowSessionLock: () => void = () => {};
  const proceed = new Promise<void>((resolve) => {
    allowSessionLock = resolve;
  });
  const visibility = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM organization WHERE id=${caller.organizationId} FOR NO KEY UPDATE`;
      await lockTracePublication(tx, caller.organizationId, "write");
      const rows = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      const pid = rows[0]?.pid;
      if (pid === undefined) throw new Error("Missing native lock owner");
      publicationHeld(pid);
      await proceed;
      await tx.traceSessionControl.update({
        where: {
          organizationId_id: {
            organizationId: caller.organizationId,
            id: first.result.sessionId,
          },
        },
        data: { visibility: "PRIVATE" },
      });
    },
    { timeout: 15_000 },
  );
  const blocker = await held;
  const cancellation = projection.process(
    caller.organizationId,
    first.result.sessionId,
  );
  try {
    await expect
      .poll(
        async () => {
          const rows = await db.prisma.$queryRaw<
            { blocked: bigint }[]
          >`SELECT count(*) AS blocked FROM pg_stat_activity WHERE ${blocker}::int=ANY(pg_blocking_pids(pid))`;
          return Number(rows[0]?.blocked ?? 0n);
        },
        { timeout: 5_000, interval: 25 },
      )
      .toBeGreaterThan(0);
  } finally {
    allowSessionLock();
  }
  await Promise.all([visibility, cancellation]);

  expect(
    (
      await prisma.redactionRun.findUniqueOrThrow({
        where: {
          organizationId_id: {
            organizationId: caller.organizationId,
            id: runId,
          },
        },
      })
    ).state,
  ).toBe("failed");
  expect(
    await prisma.traceOutbox.count({
      where: { organizationId: caller.organizationId },
    }),
  ).toBe(0);
  await prisma.apikey.update({
    where: { id: caller.apiKeyId ?? "" },
    data: { enabled: true },
  });
  const next = await ingest.execute(org.context, {
    ...envelope,
    batchId: randomUUID(),
    records: [],
    cursor: "after-revoked-scan",
  });
  await projection.process(caller.organizationId, next.result.sessionId);
  const control = await prisma.traceSessionControl.findUniqueOrThrow({
    where: {
      organizationId_id: {
        organizationId: caller.organizationId,
        id: first.result.sessionId,
      },
    },
  });
  expect(control.publishedRevision).toBe(3n);
  expect(control.redactionGeneration).toBe(0n);
});

// @req R-SAAS-08 @req R-EMB-06
it("requires native paid embedding entitlement and meters each successfully indexed message only once", async () => {
  const org = await provisionOrganization(db, "trace-paid-vectors");
  const caller = requireCaller(org.context);
  const first = await ingest.execute(org.context, await captured());
  await projection.process(caller.organizationId, first.result.sessionId);
  await prisma.organizationSettings.upsert({
    where: { organizationId: caller.organizationId },
    create: { organizationId: caller.organizationId, embeddingsEnabled: true },
    update: { embeddingsEnabled: true },
  });
  await prisma.organization.update({
    where: { id: caller.organizationId },
    data: { stripeCustomerId: "cus_trace_paid" },
  });
  const native = await prisma.subscription.create({
    data: {
      id: randomUUID(),
      referenceId: caller.organizationId,
      plan: "pro",
      status: "active",
      stripeCustomerId: "cus_trace_paid",
      stripeSubscriptionId: "sub_trace_paid",
      periodStart: new Date(Date.now() - 10000),
      periodEnd: new Date(Date.now() + 86400000),
    },
  });
  const provider = new FakeEmbeddingProvider();
  const calls = vi.spyOn(provider, "embed");
  const service = new EmbeddingService({
    prisma,
    audit,
    policies: createPolicyCache(prisma),
    traces: db.traces,
    provider,
    dailyTokenBudget: 1000000,
    billing: {
      mode: "saas",
      freeMonthlyRecords: 1000,
      proIncludedRecords: 10000,
      captureCentsPer1000: 100,
      embeddingCentsPer1000: 100,
      captureEventName: "capture_records",
      embeddingEventName: "indexed_messages",
      calComUrl: null,
    },
  });
  const target = {
    organizationId: caller.organizationId,
    sessionId: first.result.sessionId,
  };
  expect(await service.process(target)).toMatchObject({ complete: true });
  expect(calls).not.toHaveBeenCalled();
  await prisma.subscription.update({
    where: { id: native.id },
    data: { plan: "pro_embeddings" },
  });
  expect(await service.process(target)).toMatchObject({ complete: true });
  const admitted = await prisma.usageAdmission.findMany({
    where: { organizationId: caller.organizationId, kind: "embedding" },
  });
  expect(admitted.length).toBeGreaterThan(0);
  const control = await prisma.traceSessionControl.findUniqueOrThrow({
    where: {
      organizationId_id: {
        organizationId: caller.organizationId,
        id: target.sessionId,
      },
    },
  });
  if (control.embeddingRevision === null)
    throw new Error("Expected a completed vector epoch.");
  const chunks = await db.traces.embeddingsPage(
    {
      ...target,
      revision: control.embeddingRevision,
      generation: control.redactionGeneration,
    },
    { after: null, limit: 1000 },
  );
  expect(new Set(admitted.map((row) => row.resourceId))).toEqual(
    new Set(chunks.items.map((row) => row.messageId)),
  );
  expect(await service.process(target)).toMatchObject({ complete: true });
  expect(
    await prisma.usageAdmission.count({
      where: { organizationId: caller.organizationId, kind: "embedding" },
    }),
  ).toBe(admitted.length);
  expect(
    await prisma.billingMeterEvent.findMany({
      where: { organizationId: caller.organizationId },
    }),
  ).toMatchObject([
    {
      kind: "embedding",
      quantity: admitted.length,
      state: "pending",
      eventName: "indexed_messages",
      customerId: "cus_trace_paid",
    },
  ]);
  const readers = new TraceReaders(db.traceConfig, prisma, {
    embeddings: true,
    saas: true,
  });
  try {
    const visible = () =>
      readers.read(caller, (client) =>
        client.query("SELECT count() AS count FROM message_chunks"),
      );
    expect(Number((await visible()).rows[0]?.count)).toBeGreaterThan(0);
    await prisma.subscription.update({
      where: { id: native.id },
      data: { plan: "pro" },
    });
    expect(Number((await visible()).rows[0]?.count)).toBe(0);
  } finally {
    await readers.close();
  }
});

// @req R-RED-06 @req R-AUD-01
it("runs a native queued rescan through an atomic redaction generation and removes historical secret bytes", async () => {
  const org = await provisionOrganization(db, "trace-rescan");
  const caller = requireCaller(org.context);
  const envelope = await captured();
  const pos = envelope.records.length;
  envelope.records.push({
    pos,
    key: "rescan-text",
    sourceVersion: 0,
    line: JSON.stringify({
      type: "user",
      uuid: randomUUID(),
      message: { role: "user", content: "rescan-sensitive-value" },
    }),
  });
  envelope.sourcePos = pos;
  const first = await ingest.execute(org.context, envelope);
  await projection.process(caller.organizationId, first.result.sessionId);
  const query = () =>
    db.traceReaders.read(caller, (client) =>
      client.query(
        "SELECT content FROM messages WHERE session_id={session:UUID} AND position(content,'rescan-sensitive-value')>0",
        { session: first.result.sessionId },
      ),
    );
  expect((await query()).rows).toHaveLength(1);
  await prisma.redactionPolicy.create({
    data: {
      organizationId: caller.organizationId,
      id: randomUUID(),
      name: "rescan-test-rule",
      kind: "REGEX",
      pattern: "rescan-sensitive-value",
      flags: "g",
      replacement: "[REMOVED]",
      enabled: true,
      builtin: false,
    },
  });
  const runId = await prisma.$transaction((tx) =>
    jobs.rescan(tx, org.owner, { reason: "Remove the newly classified value" }),
  );
  await jobs.start();
  await expect
    .poll(
      async () =>
        (
          await prisma.redactionRun.findUniqueOrThrow({
            where: {
              organizationId_id: {
                organizationId: caller.organizationId,
                id: runId,
              },
            },
          })
        ).state,
      { timeout: 60_000, interval: 250 },
    )
    .toBe("completed");
  expect((await query()).rows).toEqual([]);
  const control = await prisma.traceSessionControl.findUniqueOrThrow({
    where: {
      organizationId_id: {
        organizationId: caller.organizationId,
        id: first.result.sessionId,
      },
    },
  });
  expect(control.redactionGeneration).toBe(2n);
  await expect
    .poll(
      async () =>
        (
          await prisma.traceSessionControl.findUniqueOrThrow({
            where: {
              organizationId_id: {
                organizationId: caller.organizationId,
                id: first.result.sessionId,
              },
            },
          })
        ).redactionCleanedGeneration,
      { timeout: 15_000, interval: 100 },
    )
    .toBe(2n);
  const run = await prisma.redactionRun.findUniqueOrThrow({
    where: {
      organizationId_id: { organizationId: caller.organizationId, id: runId },
    },
  });
  expect(run).toMatchObject({ processedSessions: 1, totalSessions: 1 });
  expect(run.redactionCount).toBeGreaterThan(0);
  expect(
    await prisma.redactionEvent.count({
      where: { organizationId: caller.organizationId },
    }),
  ).toBeGreaterThan(0);
  const raw = createClient({
    url: db.traceMigration.url,
    username: db.traceMigration.username,
    password: db.traceMigration.password,
  });
  try {
    const response = await raw.query({
      query:
        "SELECT count() AS count FROM ac_trace.raw_records WHERE organization_id={organization:String} AND generation=0",
      query_params: { organization: caller.organizationId },
      format: "JSONEachRow",
    });
    expect(await response.json()).toEqual([{ count: 0 }]);
  } finally {
    await raw.close();
  }
});
