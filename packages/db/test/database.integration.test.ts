import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "pg";
import { beforeAll, afterAll, expect, it } from "vitest";
import { z } from "zod";
import { PrismaClient } from "../src/index.js";
import {
  startDatabase,
  provisionOrganization,
} from "../../../apps/api/test/support.js";
import { cleanup } from "../../../scripts/cleanup.js";

let db: Awaited<ReturnType<typeof startDatabase>>;
let admin: PrismaClient;
let control: Client;
let first: Awaited<ReturnType<typeof provisionOrganization>>;
let second: Awaited<ReturnType<typeof provisionOrganization>>;
const releases: Array<() => Promise<unknown>> = [];

beforeAll(async () => {
  db = await startDatabase();
  releases.unshift(() => db.close());
  admin = new PrismaClient({ datasourceUrl: db.urls.migration });
  releases.unshift(() => admin.$disconnect());
  control = new Client({ connectionString: db.urls.traceControl });
  await control.connect();
  releases.unshift(() => control.end());
  first = await provisionOrganization(db, "control-first");
  second = await provisionOrganization(db, "control-second");
});
afterAll(async () => {
  expect(await cleanup(releases.splice(0))).toEqual([]);
});

async function session(organization = first) {
  const caller = z
    .object({
      organizationId: z.string(),
      userId: z.string(),
      apiKeyId: z.string(),
    })
    .parse(organization.context.caller);
  const installation = await db.prisma.installation.create({
    data: {
      id: randomUUID(),
      organizationId: caller.organizationId,
      hostname: "fixture",
      osUser: "fixture",
      platform: "linux",
      arch: "x64",
    },
  });
  return db.prisma.traceSessionControl.create({
    data: {
      organizationId: caller.organizationId,
      id: randomUUID(),
      harness: "CODEX",
      nativeIdentity: createHash("sha256").update(randomUUID()).digest("hex"),
      harnessSessionId: randomUUID(),
      userId: caller.userId,
      ingestApiKeyId: caller.apiKeyId,
      installationId: installation.id,
      startedAt: new Date(),
      lastActivityAt: new Date(),
    },
  });
}

// @req R-SEC-01
it("creates only the PostgreSQL control plane, native auth and native job schema", async () => {
  const tables = await admin.$queryRaw<
    { name: string }[]
  >`SELECT tablename AS name FROM pg_tables WHERE schemaname='public'`;
  const names = tables.map((row) => row.name);
  for (const name of [
    "agent_session",
    "raw_record",
    "message",
    "session_file",
    "ingest_batch",
    "message_chunk",
    "session_embedding",
  ])
    expect(names).not.toContain(name);
  for (const name of [
    "user",
    "member",
    "subscription",
    "trace_session_control",
    "trace_source_admission",
    "trace_outbox",
    "trace_receipt",
    "audit_event",
    "usage_admission",
  ])
    expect(names).toContain(name);
  expect(
    await admin.$queryRaw`SELECT extname FROM pg_extension WHERE extname IN ('vector','pg_trgm')`,
  ).toEqual([]);
  expect(
    await admin.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname IN ('api_ro','api_vector')`,
  ).toEqual([]);
  expect(
    await admin.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname IN ('ac_reader_user','ac_reader_admin')`,
  ).toEqual([]);
  expect(
    await admin.$queryRaw`SELECT version FROM pgboss.version`,
  ).toHaveLength(1);
});

// @req R-SEC-01
it("restricts the native control credential to narrow read-only control views", async () => {
  const identity = await control.query<{
    current_user: string;
    transaction_read_only: string;
  }>(
    "SELECT current_user,current_setting('transaction_read_only') AS transaction_read_only",
  );
  expect(identity.rows[0]).toEqual({
    current_user: "ac_trace_control",
    transaction_read_only: "on",
  });
  await expect(
    control.query("SELECT * FROM public.apikey"),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    control.query("SELECT payload FROM public.trace_outbox"),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    control.query("CREATE TABLE public.forbidden(id integer)"),
  ).rejects.toMatchObject({ code: "25006" });
  const result = await control.query(
    "SELECT * FROM trace_control.session_scope LIMIT 0",
  );
  expect(result.fields.map((field) => field.name)).toContain(
    "redaction_generation",
  );
  expect(result.fields.map((field) => field.name)).toContain(
    "embedding_source_revision",
  );
  const columns = await admin.$queryRaw<
    { table_name: string; column_name: string }[]
  >`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='trace_control'`;
  for (const name of [
    "password",
    "token",
    "secret",
    "key",
    "payload",
    "content",
    "tool_input",
    "search_text",
  ])
    expect(columns.map((row) => row.column_name)).not.toContain(name);
  const views = await admin.$queryRaw<
    { reloptions: string[] }[]
  >`SELECT reloptions FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='trace_control' AND c.relkind='v'`;
  expect(views.length).toBeGreaterThan(5);
  expect(
    views.every((view) => view.reloptions.includes("security_barrier=true")),
  ).toBe(true);
});

// @req R-ORG-06 @req R-ORG-07
it("enforces organization foreign keys across every domain table and rejects cross-organization controls", async () => {
  const missing = await admin.$queryRaw<{ table_name: string }[]>`
    SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='organization_id'
    WHERE n.nspname='public' AND c.relkind='r' AND NOT EXISTS (
      SELECT 1 FROM pg_constraint f WHERE f.conrelid=c.oid AND f.contype='f' AND a.attnum=ANY(f.conkey))`;
  expect(missing).toEqual([]);
  const own = await session();
  const foreign = await session(second);
  await expect(
    db.prisma.traceSessionControl.update({
      where: {
        organizationId_id: { organizationId: own.organizationId, id: own.id },
      },
      data: { parentSessionId: foreign.id },
    }),
  ).rejects.toMatchObject({ code: "P2003" });
  await expect(
    db.prisma.traceSessionControl.update({
      where: {
        organizationId_id: { organizationId: own.organizationId, id: own.id },
      },
      data: { installationId: foreign.installationId },
    }),
  ).rejects.toMatchObject({ code: "P2003" });
  await expect(
    db.prisma.traceSessionControl.update({
      where: {
        organizationId_id: { organizationId: own.organizationId, id: own.id },
      },
      data: { ingestApiKeyId: foreign.ingestApiKeyId },
    }),
  ).rejects.toMatchObject({ code: "P2003" });
  await expect(
    db.prisma.traceSourceAdmission.create({
      data: {
        organizationId: foreign.organizationId,
        sessionId: own.id,
        sourceIdentity: "a".repeat(64),
        rawRecordId: randomUUID(),
        pos: 0n,
        sourceVersion: 0,
        introducedRevision: 1n,
        receivedAt: new Date(),
      },
    }),
  ).rejects.toMatchObject({ code: "P2003" });
  await expect(
    db.prisma.traceSessionControl.update({
      where: {
        organizationId_id: { organizationId: own.organizationId, id: own.id },
      },
      data: { organizationId: foreign.organizationId },
    }),
  ).rejects.toThrow();
  expect(
    (
      await db.prisma.traceSessionControl.findUniqueOrThrow({
        where: {
          organizationId_id: { organizationId: own.organizationId, id: own.id },
        },
      })
    ).organizationId,
  ).toBe(own.organizationId);
});

// @req R-ING-03 @req R-ING-04
it("deduplicates compact logical source identities while retaining distinct native keys at one position", async () => {
  const source = await session();
  const value = {
    organizationId: source.organizationId,
    sessionId: source.id,
    pos: 0n,
    sourceVersion: 0,
    introducedRevision: 1n,
    receivedAt: new Date(),
  };
  const firstRecord = await db.prisma.traceSourceAdmission.create({
    data: {
      ...value,
      sourceIdentity: "a".repeat(64),
      rawRecordId: randomUUID(),
    },
  });
  await db.prisma.traceSourceAdmission.create({
    data: {
      ...value,
      sourceIdentity: "b".repeat(64),
      rawRecordId: randomUUID(),
    },
  });
  await expect(
    db.prisma.traceSourceAdmission.create({
      data: {
        ...value,
        sourceIdentity: firstRecord.sourceIdentity,
        rawRecordId: randomUUID(),
        pos: 999n,
      },
    }),
  ).rejects.toMatchObject({ code: "P2002" });
  await expect(
    db.prisma.traceSourceAdmission.create({
      data: {
        ...value,
        sourceIdentity: "c".repeat(64),
        rawRecordId: firstRecord.rawRecordId,
      },
    }),
  ).rejects.toMatchObject({ code: "P2002" });
  expect(
    await db.prisma.traceSourceAdmission.count({
      where: { organizationId: source.organizationId, sessionId: source.id },
    }),
  ).toBe(2);
});

// @req R-ING-03 @req R-SEC-01
it("keeps durable admissions and queued payloads immutable under application credentials", async () => {
  const source = await session();
  await db.prisma.traceSourceAdmission.create({
    data: {
      organizationId: source.organizationId,
      sessionId: source.id,
      sourceIdentity: "e".repeat(64),
      rawRecordId: randomUUID(),
      pos: 0n,
      sourceVersion: 0,
      introducedRevision: 1n,
      receivedAt: new Date(),
    },
  });
  const queued = await db.prisma.traceOutbox.create({
    data: {
      id: randomUUID(),
      organizationId: source.organizationId,
      sessionId: source.id,
      revision: 1n,
      kind: "ingest",
      payload: { redacted: "accepted" },
    },
  });
  for (const sql of [
    "UPDATE trace_source_admission SET pos=1",
    "DELETE FROM trace_source_admission",
    "UPDATE trace_outbox SET payload='{}'",
    "DELETE FROM trace_receipt",
    "DELETE FROM trace_session_control",
  ])
    await expect(db.prisma.$executeRawUnsafe(sql)).rejects.toMatchObject({
      meta: { code: "42501" },
    });
  await expect(
    db.prisma.$queryRawUnsafe(
      "SELECT audit_id FROM trace_audit_outbox LIMIT 0 FOR UPDATE SKIP LOCKED",
    ),
  ).resolves.toEqual([]);
  await expect(
    db.prisma.$executeRawUnsafe(
      "UPDATE trace_audit_outbox SET audit_id=audit_id",
    ),
  ).rejects.toMatchObject({ meta: { code: "55000" } });
  expect(
    (
      await db.prisma.traceOutbox.findUniqueOrThrow({
        where: { id: queued.id },
      })
    ).payload,
  ).toEqual({ redacted: "accepted" });
  await db.prisma.traceOutbox.delete({ where: { id: queued.id } });
  expect(
    await db.prisma.traceOutbox.findUnique({ where: { id: queued.id } }),
  ).toBeNull();
});

// @req R-ING-03 @req R-AUD-01
it("rolls back admission, publication checkpoint and outbox together on audit failure", async () => {
  const source = await session();
  const outboxId = randomUUID();
  await admin.$executeRawUnsafe(
    "CREATE FUNCTION public.reject_control_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit storage unavailable'; END $$",
  );
  await admin.$executeRawUnsafe(
    "CREATE TRIGGER reject_control_audit BEFORE INSERT ON public.audit_event FOR EACH ROW EXECUTE FUNCTION public.reject_control_audit()",
  );
  try {
    await expect(
      db.prisma.$transaction(async (tx) => {
        await tx.traceSourceAdmission.create({
          data: {
            organizationId: source.organizationId,
            sessionId: source.id,
            sourceIdentity: "f".repeat(64),
            rawRecordId: randomUUID(),
            pos: 0n,
            sourceVersion: 0,
            introducedRevision: 1n,
            receivedAt: new Date(),
          },
        });
        await tx.traceOutbox.create({
          data: {
            id: outboxId,
            organizationId: source.organizationId,
            sessionId: source.id,
            revision: 1n,
            kind: "ingest",
            payload: { redacted: true },
          },
        });
        await tx.traceSessionControl.update({
          where: {
            organizationId_id: {
              organizationId: source.organizationId,
              id: source.id,
            },
          },
          data: { acceptedRevision: 1n },
        });
        await db.audit.write(
          first.context,
          { action: "ingest", resourceIds: [source.id] },
          tx,
        );
      }),
    ).rejects.toThrow("audit storage unavailable");
  } finally {
    await admin.$executeRawUnsafe(
      "DROP TRIGGER reject_control_audit ON public.audit_event",
    );
    await admin.$executeRawUnsafe(
      "DROP FUNCTION public.reject_control_audit()",
    );
  }
  expect(
    await db.prisma.traceOutbox.findUnique({ where: { id: outboxId } }),
  ).toBeNull();
  expect(
    await db.prisma.traceSourceAdmission.count({
      where: { organizationId: source.organizationId, sessionId: source.id },
    }),
  ).toBe(0);
  expect(
    (
      await db.prisma.traceSessionControl.findUniqueOrThrow({
        where: {
          organizationId_id: {
            organizationId: source.organizationId,
            id: source.id,
          },
        },
      })
    ).acceptedRevision,
  ).toBe(0n);
});

it("keeps Prisma-owned schema in sync with migrations", async () => {
  const result = await promisify(execFile)(
    "pnpm",
    [
      "exec",
      "prisma",
      "migrate",
      "diff",
      "--from-schema-datasource",
      "prisma",
      "--to-schema-datamodel",
      "prisma",
      "--script",
    ],
    {
      cwd: new URL("../", import.meta.url),
      env: { ...process.env, DATABASE_URL: db.urls.migration },
    },
  );
  // SQL-owned foreign keys and checks remain visible in this reviewed snapshot.
  expect(result.stdout).toMatchSnapshot();
}, 30_000);
