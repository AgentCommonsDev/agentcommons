import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { PrismaClient } from "@agentcommons/db";
import type { IngestEnvelope } from "@agentcommons/core";
import { cleanup } from "../../../scripts/cleanup.js";
import { provisionOrganization } from "./support.js";
import { createPolicyCache } from "../src/services/policy-cache.js";
import { AuditService } from "../src/services/audit.js";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { traceServices } from "./trace-services.js";
import { EmbeddingService } from "../src/embeddings/service.js";
import { FakeEmbeddingProvider } from "../src/embeddings/provider.js";
import { requireCaller } from "../src/services/context.js";
import { operatorContext } from "../src/auth/bootstrap.js";

let database: Awaited<ReturnType<typeof startTraceDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let organizationId: string;
let prisma: PrismaClient;
let policies: ReturnType<typeof createPolicyCache>;
let audit: AuditService;
let services: ReturnType<typeof traceServices>;
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  database = await startTraceDatabase();
  release.unshift(() => database.close());
  organization = await provisionOrganization(database, "bounded-pool");
  organizationId = requireCaller(organization.context).organizationId;
  const url = new URL(database.urls.app);
  url.searchParams.set("connection_limit", "3");
  url.searchParams.set("pool_timeout", "2");
  prisma = new PrismaClient({ datasourceUrl: url.toString() });
  release.unshift(() => prisma.$disconnect());
  policies = createPolicyCache(prisma);
  audit = new AuditService(prisma, policies);
  services = traceServices(database, prisma);
  release.unshift(() => services.close());
});
afterAll(async () => {
  expect(await cleanup(release)).toEqual([]);
});
function envelope(): IngestEnvelope {
  return {
    envelopeVersion: 2,
    hook: { sha256: "a".repeat(64), extensionSha256: null },
    harness: "CLAUDE_CODE",
    harnessSessionId: randomUUID(),
    behavior: "sync",
    start: null,
    nativeEvent: "Stop",
    batchId: randomUUID(),
    installationId: randomUUID(),
    sentAt: new Date().toISOString(),
    sourcePos: 1,
    context: {
      cwd: "/pool",
      installation: {
        hostname: "pool",
        osUser: "test",
        platform: "linux",
        arch: "x64",
      },
      git: null,
      parentHint: null,
    },
    records: [
      {
        pos: 0,
        sourceVersion: 0,
        key: randomUUID(),
        line: JSON.stringify({
          type: "user",
          message: { content: "pool regression searchable text" },
        }),
      },
    ],
    cursor: "1",
    end: null,
  };
}

// @req R-EMB-02 @req R-AUD-01 @req R-RED-02
it("indexes concurrent sessions with an explicitly bounded three-connection application pool", async () => {
  await prisma.organizationSettings.create({
    data: { organizationId, embeddingsEnabled: true },
  });
  const embeddings = new EmbeddingService({
    prisma,
    policies,
    audit,
    provider: new FakeEmbeddingProvider(),
    dailyTokenBudget: 5000000,
    traces: database.traces,
  });
  await embeddings.initialize();

  const sessions = [];
  for (let index = 0; index < 3; index++) {
    const received = await services.publish(organization.context, envelope());
    sessions.push({ organizationId, sessionId: received.result.sessionId });
  }
  policies.invalidate(organizationId);
  const results = await Promise.allSettled(
    sessions.map((session) => embeddings.process(session)),
  );
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
    expect(result.value).toEqual({ complete: true, deferredUntil: null });
  }
  expect(
    await prisma.embeddingState.count({
      where: { organizationId, complete: true },
    }),
  ).toBe(3);
  for (const session of sessions) {
    const control = await prisma.traceSessionControl.findUniqueOrThrow({
      where: { organizationId_id: { organizationId, id: session.sessionId } },
    });
    expect(control.embeddingRevision).not.toBeNull();
    expect(control.embeddingSourceRevision).toBe(control.publishedRevision);
    const vectorScope = {
      ...(await services.scope(organizationId, session.sessionId)),
      revision: control.embeddingRevision ?? 0n,
    };
    expect(
      (
        await database.traces.embeddingsPage(vectorScope, {
          after: null,
          limit: 1000,
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (await database.traces.readSessionEmbedding(vectorScope))?.embedding,
    ).toHaveLength(1024);
  }
});

// @req R-ING-02 @req R-AUD-01 @req R-RED-02
it("commits concurrent cold-cache ingestion and audits without requesting an additional connection", async () => {
  const ingest = services.ingest;
  policies.invalidate(organizationId);
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, () =>
      ingest.execute(organization.context, envelope()),
    ),
  );
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
    expect(result.value.result.accepted).toBe(1);
    expect(result.value.audit.action).toBe("ingest");
  }
  policies.invalidate(organizationId);
  let arrived = 0;
  let open = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const writes = await Promise.allSettled(
    Array.from({ length: 3 }, () =>
      prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1`;
          arrived++;
          if (arrived === 3) open();
          await gate;
          return audit.write(
            organization.context,
            { action: "pool.audit", detail: { text: "bounded pool audit" } },
            tx,
          );
        },
        { timeout: 15000, maxWait: 10000 },
      ),
    ),
  );
  for (const result of writes) {
    if (result.status === "rejected") throw result.reason;
    expect(result.value.detail).toEqual({ text: "bounded pool audit" });
  }
  expect(
    await prisma.auditEvent.count({
      where: { organizationId, action: "pool.audit" },
    }),
  ).toBe(3);
});

// @req R-AUD-01 @req R-RED-02
it("uses uncommitted transaction policies for worker audit but never publishes them to the shared cache after rollback", async () => {
  const shared = await policies.get(organizationId);
  const failure = new Error("Deliberate policy rollback");
  const policyId = randomUUID();
  await expect(
    prisma.$transaction(async (tx) => {
      await tx.redactionPolicy.create({
        data: {
          id: policyId,
          organizationId,
          name: "rollback-only",
          kind: "REGEX",
          pattern: "pending-policy-phrase",
          flags: "g",
          replacement: "[REDACTED:rollback-only]",
          builtin: false,
        },
      });
      expect(
        await audit.redactText(
          organization.context,
          "pending-policy-phrase",
          tx,
        ),
      ).toBe("[REDACTED:rollback-only]");
      const row = await audit.write(
        operatorContext(),
        {
          action: "pool.rollback",
          actor: {
            organizationId,
            userId: null,
            apiKeyId: null,
            authMethod: "worker",
          },
          detail: { text: "pending-policy-phrase" },
        },
        tx,
      );
      expect(z.object({ text: z.string() }).parse(row.detail).text).toBe(
        "[REDACTED:rollback-only]",
      );
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await prisma.redactionPolicy.count({ where: { id: policyId } })).toBe(
    0,
  );
  expect(
    await prisma.auditEvent.count({
      where: { organizationId, action: "pool.rollback" },
    }),
  ).toBe(0);
  expect(await policies.get(organizationId)).toBe(shared);
  expect((await shared.text("pending-policy-phrase")).value).toBe(
    "pending-policy-phrase",
  );
});
