import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTraceClient } from "@agentcommons/traces";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { MetricsFixtures, metricsAt } from "./metrics-fixtures.js";
import { provisionOrganization, releaser } from "./support.js";
import { drainTraceAudit } from "./trace-services.js";
import { TraceAuditProjectionService } from "../src/services/trace-audit-projection.js";
import { requireCaller } from "../src/services/context.js";

// The hosted audit projection stopped on 2026-10-19: attributing one batch of reads derived
// the active windows of every session in the organization from all of its receipts, which
// outgrew the 256 MiB reader limit, and the failed batch held back every later one (ADR 0099).
// This installation has 2,000 sessions of 300 sync receipts each, one every fifteen minutes.
const SESSIONS = 2_000;
const RECEIPTS = 300;
const START = metricsAt(1);
const SESSION_SECONDS = 900;
const { defer, release } = releaser();
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let org: Awaited<ReturnType<typeof provisionOrganization>>;
let projection: TraceAuditProjectionService;
let writer: ReturnType<typeof createTraceClient>;
let sessions: string[];
let installationId: string;

beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  org = await provisionOrganization(db, "attribution-scale");
  writer = createTraceClient(db.traceConfig);
  defer(() => writer.close());
  const fixtures = new TraceFixtures(db);
  defer(() => fixtures.close());
  const metrics = new MetricsFixtures(db, fixtures);
  projection = new TraceAuditProjectionService({
    prisma: db.prisma,
    audit: db.audit,
    traces: db.traces,
    readers: db.traceReaders,
  });
  installationId = randomUUID();
  sessions = [];
  for (let index = 0; index < SESSIONS; index += 1) {
    const start = new Date(START.getTime() + index * SESSION_SECONDS * 1000);
    sessions.push(
      (
        await metrics.session(org.context, {
          installationId,
          start,
          end: new Date(start.getTime() + RECEIPTS * 2000),
        })
      ).id,
    );
  }
  const caller = requireCaller(org.context);
  // Session i sends a sync receipt every two seconds from its start, as the hook does.
  await writer.command({
    query: `INSERT INTO ingest_receipts (organization_id,session_id,receipt_id,installation_id,api_key_id,user_id,source_pos,sent_at,received_at,behavior,native_event,start_resume,lifecycle_applied,accepted_count,duplicate_count,record_count,byte_count,redaction_count,duration_ms,revision,generation,deleted,fingerprint)
      SELECT {organization:String},arrayElement({sessions:Array(UUID)},toUInt32(intDiv(number,{receipts:UInt64}))+1),generateUUIDv4(),{installation:UUID},{key:String},{user:String},
        toInt64(number % {receipts:UInt64}),
        {start:DateTime64(6,'UTC')}+toIntervalSecond(intDiv(number,{receipts:UInt64})*{session:UInt64}+(number % {receipts:UInt64})*2) AS sent,
        sent,'sync','sync',false,false,1,0,1,100,0,1,1,0,0,repeat('a',64)
      FROM numbers({total:UInt64})`,
    query_params: {
      organization: caller.organizationId,
      sessions,
      receipts: RECEIPTS,
      installation: installationId,
      key: caller.apiKeyId,
      user: caller.userId,
      start: START.toISOString().replace("T", " ").replace("Z", ""),
      session: SESSION_SECONDS,
      total: SESSIONS * RECEIPTS,
    },
    abort_signal: AbortSignal.timeout(120_000),
  });
}, 600_000);
afterAll(release);

/** A successful key-authenticated MCP call from the installation at `time`, queued for projection. */
async function read(time: Date, action: "get" | "mcp.tools.list") {
  const caller = requireCaller(org.context);
  const target = sessions[0] ?? "";
  const row = await db.prisma.auditEvent.create({
    data: {
      organizationId: caller.organizationId,
      id: randomUUID(),
      ts: time,
      requestId: randomUUID(),
      userId: caller.userId,
      apiKeyId: caller.apiKeyId,
      installationId,
      authMethod: "key",
      ip: "fixture",
      transport: "mcp",
      action,
      statusCode: 200,
      durationMs: 1,
      resourceIds: action === "get" ? [target] : [],
      detail: {
        input: {},
        result: action === "get" ? { session_id: target } : {},
      },
    },
  });
  await db.prisma.traceAuditOutbox.create({ data: { auditId: row.id } });
  return row;
}

// @req R-AUD-06
it("attributes a batch of reads from an installation with 600,000 receipts under the reader limits", async () => {
  // The newest session is active from `latest`; its reads come five minutes in, after the
  // key's handshake, and its receipt then is their nearest observation.
  const latest = new Date(
    START.getTime() + (SESSIONS - 1) * SESSION_SECONDS * 1000,
  );
  await read(new Date(latest.getTime() + 60_000), "mcp.tools.list");
  const reads = [];
  for (let index = 0; index < 50; index += 1)
    reads.push(
      await read(new Date(latest.getTime() + 300_000 + index * 1000), "get"),
    );
  await drainTraceAudit(projection);
  expect(await db.prisma.traceAuditOutbox.count()).toBe(0);
  const response = await writer.query({
    query:
      "SELECT audit_id,session_id FROM session_reads FINAL WHERE audit_id IN {ids:Array(UUID)}",
    query_params: { ids: reads.map((row) => row.id) },
    format: "JSONEachRow",
  });
  const credited = await response.json<{
    audit_id: string;
    session_id: string;
  }>();
  expect(credited).toHaveLength(reads.length);
  for (const row of credited) expect(row.session_id).toBe(sessions.at(-1));
}, 300_000);
