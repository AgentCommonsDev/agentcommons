import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ingestEnvelopeSchema, metricGroups } from "@agentcommons/core";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { cleanup } from "../../../scripts/cleanup.js";
import { provisionOrganization, provisionMember } from "./support.js";
import { AuditService } from "../src/services/audit.js";
import { createPolicyCache } from "../src/services/policy-cache.js";
import { TraceProjectionService } from "../src/services/trace-projection.js";
import { TraceAuditProjectionService } from "../src/services/trace-audit-projection.js";
import { JobService } from "../src/services/jobs.js";
import { IngestService } from "../src/services/ingest.js";
import { HomeService } from "../src/services/home.js";
import { MetricsService } from "../src/services/metrics.js";
import { CursorCodec } from "../src/services/cursor.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let owner: Awaited<ReturnType<typeof provisionOrganization>>;
let member: Awaited<ReturnType<typeof provisionMember>>;
let foreign: Awaited<ReturnType<typeof provisionOrganization>>;
let home: HomeService;
let metrics: MetricsService;
let ingest: IngestService;
let projection: TraceProjectionService;
let audits: TraceAuditProjectionService;
const release: Array<() => Promise<unknown>> = [];
const workerErrors: Error[] = [];
const filters = {
  date_from: new Date(Date.now() - 86400000).toISOString(),
  date_to: new Date(Date.now() + 86400000).toISOString(),
};
beforeAll(async () => {
  db = await startTraceDatabase();
  release.unshift(() => db.close());
  owner = await provisionOrganization(db, "native-home-metrics");
  member = await provisionMember(
    db,
    owner.owner,
    "native-metrics-member@example.test",
  );
  foreign = await provisionOrganization(db, "native-home-foreign");
  const audit = new AuditService(db.prisma, createPolicyCache(db.prisma));
  projection = new TraceProjectionService({
    prisma: db.prisma,
    audit,
    repository: db.traces,
  });
  audits = new TraceAuditProjectionService({
    prisma: db.prisma,
    audit,
    traces: db.traces,
  });
  const jobs = new JobService({
    prisma: db.prisma,
    audit,
    traces: projection,
    traceAudit: audits,
    connectionString: db.urls.app,
    allowedEmailDomains: [],
    auditRetentionDays: 365,
    onError: (error) => {
      workerErrors.push(error);
    },
  });
  release.unshift(() => jobs.stop());
  ingest = new IngestService({ prisma: db.prisma, audit, traces: jobs });
  const dependencies = {
    prisma: db.prisma,
    audit,
    readers: db.traceReaders,
    cursors: new CursorCodec("native-home-metrics-cursor-secret"),
  };
  home = new HomeService(dependencies);
  metrics = new MetricsService(dependencies);
});
afterAll(async () => {
  expect(await cleanup(release)).toEqual([]);
  expect(workerErrors).toEqual([]);
});

async function capture(
  context: ServiceContext,
  repo: string,
  searches = false,
) {
  const timestamp = new Date().toISOString();
  const records = [
    {
      type: "user",
      uuid: randomUUID(),
      timestamp,
      message: { role: "user", content: "Native metrics verification" },
    },
    {
      type: "assistant",
      timestamp,
      message: {
        id: randomUUID(),
        role: "assistant",
        content: searches
          ? [
              {
                type: "tool_use",
                id: "search-first",
                name: "mcp__agentcommons__search",
                input: { query: "existing work" },
              },
              {
                type: "tool_use",
                id: "search-repeat",
                name: "mcp__agentcommons__search",
                input: { query: "prior implementation" },
              },
              {
                type: "tool_use",
                id: "code-search",
                name: "Grep",
                input: { pattern: "implementation" },
              },
            ]
          : [{ type: "text", text: "Captured work" }],
      },
    },
  ];
  const envelope = ingestEnvelopeSchema.parse({
    envelopeVersion: 2,
    harness: "CLAUDE_CODE",
    harnessSessionId: randomUUID(),
    installationId: randomUUID(),
    batchId: randomUUID(),
    behavior: "start",
    nativeEvent: "SessionStart",
    start: { resume: false },
    sentAt: timestamp,
    sourcePos: records.length,
    cursor: "native-metrics",
    end: null,
    context: {
      cwd: "/native-metrics",
      installation: {
        hostname: "native-metrics",
        osUser: "fixture",
        platform: "linux",
        arch: "x64",
      },
      git: {
        root: "/native-metrics",
        remoteUrl: `https://github.com/fixture/${repo}.git`,
        branch: "main",
        head: "abc123",
      },
      parentHint: null,
    },
    records: records.map((record, pos) => ({
      pos,
      key: `native-${String(pos)}`,
      sourceVersion: 0,
      line: JSON.stringify(record),
    })),
  });
  const accepted = await ingest.execute(context, envelope);
  await projection.process(
    requireCaller(context).organizationId,
    accepted.result.sessionId,
  );
  return accepted.result.sessionId;
}

// @req R-DASH-13 @req R-DASH-15 @req R-DASH-16 @req R-DASH-18
it("executes every metric group on empty native ClickHouse views with null ratios and eight empty Home weeks", async () => {
  const summary = (await home.summary(owner.context)).result;
  expect(summary.weekly).toHaveLength(8);
  expect(
    summary.weekly.every(
      (row) => row.sessions === 0 && row.reuse_rate === null,
    ),
  ).toBe(true);
  expect(summary.search_adoption).toMatchObject({
    sessions: 0,
    agentcommons_search_calls: 0,
    agentcommons_search_rate: null,
  });
  for (const group of Object.keys(
    metricGroups,
  ) as (keyof typeof metricGroups)[]) {
    const result = (await metrics.get(owner.context, group, { filters }))
      .result;
    expect(
      result.items.every(
        (row) =>
          row.unit !== "ratio" ||
          (row.denominator ? row.value === 0 : row.value === null),
      ),
    ).toBe(true);
    expect(
      result.items.every(
        (row) => row.value === null || Number.isFinite(row.value),
      ),
    ).toBe(true);
    if (group === "health")
      expect(
        result.items.find((row) => row.metric === "capture_latency_seconds")
          ?.value,
      ).toBeNull();
  }
});
// @req R-DASH-18 @req R-ORG-07 @req R-DASH-13
it("counts typed source-order search attempts after real publication and filters native analytics without leaking another organization", async () => {
  await capture(owner.context, "metrics-alpha", true);
  await capture(member.context, "metrics-beta");
  await audits.flush();
  const summary = (await home.summary(owner.context)).result;
  expect(summary.search_adoption).toEqual({
    sessions: 2,
    agentcommons_search_sessions: 1,
    agentcommons_search_rate: 0.5,
    agentcommons_search_calls: 2,
    repeat_agentcommons_search_calls: 1,
    subsequent_other_search_calls: 1,
  });
  const usage = (
    await metrics.get(owner.context, "usage", {
      filters: { ...filters, repo_name: "github.com/fixture/metrics-alpha" },
    })
  ).result;
  expect(
    usage.items.find((row) => row.metric === "agentcommons_search_rate"),
  ).toMatchObject({ value: 1, numerator: 1, denominator: 1 });
  expect(
    (await home.summary(foreign.context)).result.search_adoption.sessions,
  ).toBe(0);
  const absent = (
    await metrics.get(owner.context, "usage", {
      filters: { ...filters, repo_name: "github.com/fixture/absent" },
    })
  ).result;
  expect(
    absent.items.find((row) => row.metric === "agentcommons_search_calls")
      ?.value,
  ).toBe(0);
  expect(
    absent.items.find((row) => row.metric === "agentcommons_search_rate")
      ?.value,
  ).toBeNull();
  for (const group of Object.keys(
    metricGroups,
  ) as (keyof typeof metricGroups)[]) {
    const populated = (await metrics.get(owner.context, group, { filters }))
      .result;
    expect(populated.items.length).toBeGreaterThan(0);
    expect(
      populated.items.every(
        (row) => row.value === null || Number.isFinite(row.value),
      ),
    ).toBe(true);
  }
  const outcomes = (await metrics.get(owner.context, "outcomes", { filters }))
    .result;
  expect(
    outcomes.items.find(
      (row) =>
        row.metric === "tool_calls_per_session" &&
        row.repo_name === "github.com/fixture/metrics-alpha",
    ),
  ).toMatchObject({ value: 3, numerator: 3, denominator: 1 });
  await expect(
    metrics.get(member.context, "health", { filters }),
  ).rejects.toMatchObject({ statusCode: 403 });
});
// @req R-DASH-16 @req R-DASH-06 @req R-ORG-07
it("pages native UTF8 repository gaps in stable keyset order and binds cursors to literal filters", async () => {
  const first = (
    await home.list(owner.context, "gap_repos", {
      limit: 1,
      sort: "repo_name",
      order: "asc",
    })
  ).result;
  expect(first.items).toHaveLength(1);
  expect(first.cursor).not.toBeNull();
  const second = (
    await home.list(owner.context, "gap_repos", {
      limit: 1,
      sort: "repo_name",
      order: "asc",
      cursor: first.cursor,
    })
  ).result;
  expect(second.items).toHaveLength(1);
  expect(second.items).not.toEqual(first.items);
  expect(second.cursor).toBeNull();
  const filtered = (
    await home.list(owner.context, "gap_repos", { query: "ALPHA" })
  ).result;
  expect(filtered.items).toMatchObject([
    { repo_name: "github.com/fixture/metrics-alpha", sessions: 1 },
  ]);
  await expect(
    home.list(owner.context, "gap_repos", {
      limit: 1,
      sort: "repo_name",
      order: "asc",
      query: "ALPHA",
      cursor: first.cursor,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  const metricFirst = (
    await metrics.get(owner.context, "usage", {
      filters,
      limit: 1,
      sort: "metric",
      order: "asc",
    })
  ).result;
  expect(metricFirst.cursor).not.toBeNull();
  const metricSecond = (
    await metrics.get(owner.context, "usage", {
      filters,
      limit: 1,
      sort: "metric",
      order: "asc",
      cursor: metricFirst.cursor,
    })
  ).result;
  expect(metricSecond.items[0]?.metric).not.toBe(metricFirst.items[0]?.metric);
});
