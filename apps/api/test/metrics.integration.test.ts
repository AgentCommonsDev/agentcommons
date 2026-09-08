import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Prisma, ReaderPools, type AgentSession } from "@agentcommons/db";
import { metricRowSchema, type MetricRow } from "@agentcommons/core";
import { z } from "zod";
import { MetricsService } from "../src/services/metrics.js";
import { CursorCodec } from "../src/services/cursor.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";
import {
  startDatabase,
  provisionOrganization,
  provisionMember,
} from "./support.js";
let db: Awaited<ReturnType<typeof startDatabase>>;
let org: Awaited<ReturnType<typeof provisionOrganization>>;
let member: Awaited<ReturnType<typeof provisionMember>>;
let foreign: Awaited<ReturnType<typeof provisionOrganization>>;
let service: MetricsService;
const filters = {
  date_from: "2026-09-07T00:00:00Z",
  date_to: "2026-09-14T00:00:00Z",
};
const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 7, hour, minute));
const repo = "github.com/test/metrics";
async function session(
  context: ServiceContext,
  options: {
    repo?: string;
    start?: Date;
    end?: Date;
    enabled?: boolean;
    visibility?: "PUBLIC" | "PRIVATE";
    prompt?: string;
    toolCalls?: number;
    tokens?: number;
    commits?: boolean;
    installationId?: string;
  } = {},
) {
  const caller = requireCaller(context);
  const installationId = options.installationId ?? randomUUID();
  await db.prisma.installation.upsert({
    where: {
      organizationId_id: {
        organizationId: caller.organizationId,
        id: installationId,
      },
    },
    create: {
      organizationId: caller.organizationId,
      id: installationId,
      hostname: "metrics fixture",
      osUser: "fixture",
      platform: "linux",
      arch: "x64",
      toolsEnabled: options.enabled ?? true,
    },
    update: {},
  });
  const row = await db.prisma.agentSession.create({
    data: {
      id: randomUUID(),
      organizationId: caller.organizationId,
      harness: "CLAUDE_CODE",
      harnessSessionId: randomUUID(),
      userId: caller.userId,
      ingestApiKeyId: z.string().parse(caller.apiKeyId),
      installationId,
      cwd: "/fixture",
      repoName: options.repo ?? repo,
      startedAt: options.start ?? at(9),
      endedAt: options.end ?? at(10),
      lastActivityAt: options.end ?? at(10),
      status: "ENDED",
      visibility: options.visibility ?? "PUBLIC",
      title: "Metrics session",
      firstPrompt:
        options.prompt ?? "Fix the payment transaction retry implementation",
      toolCallCount: options.toolCalls ?? 4,
      inputTokens: options.tokens ?? 100,
      outputTokens: 50,
      observedCommits: options.commits
        ? [
            {
              sha: "123abc",
              subject: "Observed commit",
              author: "fixture",
              timestamp: at(10).toISOString(),
            },
          ]
        : Prisma.DbNull,
    },
  });
  await receipt(row, "start", row.startedAt, 0);
  await receipt(row, "end", z.date().parse(row.endedAt), 10);
  return row;
}
async function receipt(
  row: AgentSession,
  behavior: string,
  sentAt: Date,
  sourcePos: number,
  receivedAt = sentAt,
) {
  return db.prisma.ingestBatch.create({
    data: {
      organizationId: row.organizationId,
      id: randomUUID(),
      sessionId: row.id,
      apiKeyId: row.ingestApiKeyId,
      userId: row.userId,
      installationId: row.installationId,
      ip: "fixture",
      cursor: randomUUID(),
      acceptedCount: 0,
      sourcePos,
      sentAt,
      behavior,
      startResume: behavior === "start" && sourcePos > 0,
      nativeEvent: behavior,
      receivedAt,
      recordCount: 0,
      duplicateCount: 0,
      byteCount: 0,
      redactionCount: 0,
      durationMs: 0,
    },
  });
}
async function audit(
  context: ServiceContext,
  options: {
    time: Date;
    installationId?: string | null;
    target?: string;
    action?: string;
    results?: string[];
    hits?: number;
    cookie?: boolean;
    transport?: string;
  },
) {
  const caller = requireCaller(context);
  return db.prisma.auditEvent.create({
    data: {
      organizationId: caller.organizationId,
      id: randomUUID(),
      ts: options.time,
      requestId: randomUUID(),
      userId: caller.userId,
      apiKeyId: options.cookie ? null : caller.apiKeyId,
      installationId: options.installationId ?? null,
      authMethod: options.cookie ? "cookie" : "key",
      ip: "fixture",
      transport: options.transport ?? "mcp",
      action: options.action ?? "get",
      statusCode: 200,
      durationMs: 1,
      detail: {
        input: { query: "fixture searchable question" },
        result:
          options.action === "search"
            ? {
                hits: options.hits ?? options.results?.length ?? 0,
                session_ids: options.results ?? [],
                top_session_id: options.results?.[0] ?? null,
              }
            : { session_id: options.target ?? null },
      },
    },
  });
}
async function metrics(group: string, extra: Record<string, unknown> = {}) {
  return (
    await service.get(org.context, group, { filters, limit: 100, ...extra })
  ).result.items;
}
function find(rows: MetricRow[], metric: string, enabled?: boolean) {
  return metricRowSchema.parse(
    rows.find(
      (row) =>
        row.metric === metric &&
        (enabled === undefined || row.tools_enabled === enabled),
    ),
  );
}
beforeAll(async () => {
  db = await startDatabase();
  org = await provisionOrganization(db, "metrics");
  member = await provisionMember(db, org.owner, "metrics-member@example.com");
  foreign = await provisionOrganization(db, "metrics-foreign");
  service = new MetricsService({
    ...db,
    cursors: new CursorCodec("metrics-test-secret"),
  });
}, 120_000);
afterAll(async () => {
  await db.close();
});

// @req R-DASH-13 @req R-DASH-15 @req R-ORG-07
it("counts weekly reuse once per active reading session, respects event boundaries, resumed/inactive gaps, actor kind and visible source/target scope", async () => {
  const target = await session(member.context, {
    start: at(7),
    end: at(8),
    repo: "reuse-target",
  });
  const source = await session(org.context, { repo: "reuse-source" });
  const wrong = await session(org.context, { repo: "wrong-installation" });
  const hidden = await session(member.context, {
    visibility: "PRIVATE",
    repo: "hidden-target",
    start: at(7),
    end: at(8),
  });
  const outside = await session(foreign.context, { start: at(7), end: at(8) });
  for (const time of [at(9), at(9, 5), at(9, 59)])
    await audit(org.context, {
      time,
      installationId: source.installationId,
      target: target.id,
    });
  // Self reads, humans, missing/wrong installation and invalid windows never create edges.
  await audit(org.context, {
    time: at(9, 10),
    installationId: wrong.installationId,
    target: wrong.id,
  });
  await audit(org.context, {
    time: at(9, 11),
    installationId: wrong.installationId,
    target: target.id,
    cookie: true,
  });
  await audit(org.context, {
    time: at(8, 59),
    installationId: wrong.installationId,
    target: target.id,
  });
  await audit(org.context, {
    time: at(10),
    installationId: wrong.installationId,
    target: target.id,
  });
  await audit(org.context, { time: at(9, 12), target: target.id });
  await audit(org.context, {
    time: at(9, 13),
    installationId: wrong.installationId,
    target: outside.id,
  });
  await receipt(source, "start", at(12), 20);
  await receipt(source, "end", at(13), 30);
  await audit(org.context, {
    time: at(11),
    installationId: source.installationId,
    target: target.id,
  });
  await audit(org.context, {
    time: at(12, 5),
    installationId: source.installationId,
    target: target.id,
  });
  // Delivered after resume, this lower-position end cannot close the resumed window.
  await receipt(source, "end", at(12, 1), 15, at(12, 2));
  const long = await session(org.context, {
    repo: "long-gap",
    start: at(0),
    end: at(23),
  });
  await receipt(long, "sync", at(12), 5);
  await audit(org.context, {
    time: at(8),
    installationId: long.installationId,
    target: target.id,
  });
  const query = (ctx: ServiceContext) =>
    db.readers.read(requireCaller(ctx), async (client) => ({
      edges: (
        await client.query<Record<string, unknown>>(
          "SELECT * FROM api_ro.reuse_edges ORDER BY read_at",
        )
      ).rows,
      weekly: (
        await client.query<Record<string, unknown>>(
          "SELECT * FROM api_ro.metrics_reuse_weekly",
        )
      ).rows,
      counts: (
        await client.query<Record<string, unknown>>(
          "SELECT * FROM api_ro.session_reuse WHERE session_id=$1",
          [target.id],
        )
      ).rows,
    }));
  const data = await query(org.context);
  expect(
    data.edges.filter((row) => row.source_session_id === source.id),
  ).toHaveLength(4);
  expect(
    data.edges.some(
      (row) =>
        row.source_session_id === wrong.id || row.source_session_id === long.id,
    ),
  ).toBe(false);
  expect(data.counts[0]).toMatchObject({
    reuse_count: "1",
    unique_readers: "1",
    cross_user_reuse_count: "1",
  });
  expect(data.weekly[0]).toMatchObject({
    sessions: "5",
    reuse_sessions: "1",
    cross_user_reuse_sessions: "1",
    reuse_rate: 0.2,
  });
  await audit(org.context, {
    time: at(9, 20),
    installationId: source.installationId,
    target: hidden.id,
  });
  const memberData = await query(member.context);
  const assisted = await db.readers.read(
    requireCaller(member.context),
    async (client) =>
      (
        await client.query<Record<string, unknown>>(
          "SELECT memory_assisted FROM api_ro.metrics_reuse_sessions",
        )
      ).rows,
  );
  expect(assisted.length).toBeGreaterThan(0);
  expect(assisted.every((row) => row.memory_assisted === null)).toBe(true);
  expect(
    memberData.edges.some((row) => row.target_session_id === hidden.id),
  ).toBe(false);
  expect(memberData.weekly[0]).toMatchObject({
    sessions: "4",
    reuse_sessions: "1",
    reuse_rate: 0.25,
  });
  expect((await query(foreign.context)).edges).toHaveLength(0);
  const page = await service.get(org.context, "reuse", {
    filters: { ...filters, repo_name: "reuse-source" },
    limit: 100,
  });
  expect(find(page.result.items, "reuse_rate")).toMatchObject({
    numerator: 1,
    denominator: 1,
    value: 1,
  });
  const before = await service.get(org.context, "reuse", {
    filters: {
      date_from: "2026-08-31T00:00:00Z",
      date_to: "2026-09-07T00:00:00Z",
    },
  });
  expect(find(before.result.items, "reuse_rate")).toMatchObject({
    numerator: 0,
    denominator: 0,
    value: null,
  });
});

// @req R-DASH-13 @req R-ORG-07
it("computes filtered capture, redaction, search precision, cross-user and dashboard metrics from real observations", async () => {
  const source = await session(org.context, { repo: "metric-observations" });
  const target = await session(member.context, {
    repo: "metric-observations",
    start: at(7),
    end: at(8),
  });
  const batch = await receipt(source, "sync", at(9, 1), 2);
  for (const [index, latency] of [2, 4, -1].entries()) {
    const raw = await db.prisma.rawRecord.create({
      data: {
        organizationId: source.organizationId,
        id: randomUUID(),
        sessionId: source.id,
        pos: index,
        key: randomUUID(),
        recordType: "user",
        payload: {},
        ingestBatchId: batch.id,
      },
    });
    for (let block = 0; block < 2; block++)
      await db.prisma.message.create({
        data: {
          organizationId: source.organizationId,
          id: randomUUID(),
          sessionId: source.id,
          rawRecordId: raw.id,
          seq: index * 2 + block,
          blockIndex: block,
          role: "USER",
          kind: "TEXT",
          content: "fixture",
          timestamp: at(9),
          receivedAt: new Date(at(9).getTime() + latency * 1000),
          searchable: true,
          searchText: "fixture",
        },
      });
  }
  const policy = await db.prisma.redactionPolicy.findFirstOrThrow({
    where: { organizationId: source.organizationId },
  });
  await db.prisma.redactionEvent.create({
    data: {
      organizationId: source.organizationId,
      ingestBatchId: batch.id,
      sessionId: source.id,
      policyId: policy.id,
      count: 7,
    },
  });
  await audit(org.context, {
    time: at(9, 1),
    installationId: source.installationId,
    action: "search",
    results: [target.id],
  });
  await audit(org.context, {
    time: at(9, 2),
    installationId: source.installationId,
    target: target.id,
  });
  await audit(org.context, {
    time: at(9, 20),
    installationId: source.installationId,
    action: "search",
    results: [],
  });
  await audit(org.context, {
    time: at(9, 30),
    installationId: source.installationId,
    action: "sql",
  });
  await audit(org.context, {
    time: at(9, 40),
    action: "search",
    results: [target.id],
    cookie: true,
    transport: "rest",
  });
  await audit(org.context, {
    time: at(9, 41),
    target: target.id,
    cookie: true,
    transport: "rest",
  });
  for (const action of [
    "sessions.visibility",
    "sessions.purge",
    "audit.list",
    "status",
    "mcp.tools.list",
    "mcp.protocol",
    "auth.failure",
  ])
    await audit(org.context, {
      time: at(9, 32),
      installationId: source.installationId,
      action,
    });
  const f = { ...filters, repo_name: "metric-observations" };
  const health = await metrics("health", { filters: f });
  expect(find(health, "capture_latency_seconds").value).toBe(3);
  expect(find(health, "negative_capture_latency_records").value).toBe(1);
  expect(find(health, "redaction_hits")).toMatchObject({
    policy_id: policy.id,
    value: 7,
  });
  expect(find(health, "capture_coverage")).toMatchObject({
    numerator: 2,
    denominator: 2,
    value: 1,
  });
  expect(
    health
      .filter((row) => row.metric === "sessions")
      .reduce((sum, row) => sum + (row.value ?? 0), 0),
  ).toBe(2);
  const usage = await metrics("usage", { filters: f });
  expect(find(usage, "follow_through_rate")).toMatchObject({
    numerator: 2,
    denominator: 3,
    value: 2 / 3,
  });
  expect(find(usage, "zero_result_rate")).toMatchObject({
    numerator: 1,
    denominator: 3,
    value: 1 / 3,
  });
  expect(find(usage, "cross_user_hit_rate")).toMatchObject({
    numerator: 2,
    denominator: 2,
    value: 1,
  });
  expect(find(usage, "memory_assisted_rate")).toMatchObject({
    numerator: 1,
    denominator: 2,
    value: 0.5,
  });
  expect(find(usage, "dashboard_weekly_actives").value).toBe(1);
  expect(find(usage, "dashboard_searches").value).toBe(1);
  expect(find(usage, "dashboard_session_views").value).toBe(1);
  expect(
    usage
      .filter((row) => row.metric === "mcp_calls")
      .reduce((sum, row) => sum + (row.value ?? 0), 0),
  ).toBe(8);
  expect(
    usage
      .filter((row) => row.metric === "mcp_calls")
      .map((row) => row.tool)
      .sort(),
  ).toEqual([
    "audit",
    "get",
    "purge",
    "search",
    "set_visibility",
    "sql",
    "status",
  ]);
  await db.prisma.apikey.update({
    where: { id: source.ingestApiKeyId },
    data: { enabled: false },
  });
  expect(
    find(
      await metrics("health", { filters: f }),
      "authorization_blocked_sessions",
    ).value,
  ).toBe(1);
  await db.prisma.apikey.update({
    where: { id: source.ingestApiKeyId },
    data: { enabled: true },
  });
  await db.prisma.member.updateMany({
    where: { organizationId: source.organizationId, userId: target.userId },
    data: { suspended: true },
  });
  expect(
    find(
      await metrics("health", { filters: f }),
      "authorization_blocked_sessions",
    ).value,
  ).toBe(1);
  await db.prisma.member.updateMany({
    where: { organizationId: source.organizationId, userId: target.userId },
    data: { suspended: false },
  });
});

// @req R-DASH-13
it("compares current rollout cohorts, requires paired failed reruns, and gates vector similarity independently of trigram matches", async () => {
  const enabled = await session(org.context, {
    repo: "outcomes",
    enabled: true,
    toolCalls: 8,
    tokens: 150,
    commits: true,
  });
  const disabled = await session(member.context, {
    repo: "outcomes",
    enabled: false,
    toolCalls: 2,
    tokens: 50,
  });
  const batch = await receipt(enabled, "sync", at(9, 1), 2);
  for (let index = 0; index < 4; index++) {
    const raw = await db.prisma.rawRecord.create({
      data: {
        organizationId: enabled.organizationId,
        id: randomUUID(),
        sessionId: enabled.id,
        pos: index,
        key: randomUUID(),
        recordType: "assistant",
        payload: {},
        ingestBatchId: batch.id,
      },
    });
    await db.prisma.message.create({
      data: {
        organizationId: enabled.organizationId,
        id: randomUUID(),
        sessionId: enabled.id,
        rawRecordId: raw.id,
        seq: index,
        blockIndex: 0,
        role: index % 2 ? "TOOL_RESULT" : "ASSISTANT",
        kind: index % 2 ? "TOOL_RESULT" : "TOOL_USE",
        content: index % 2 ? "Tests failed, exit code 1" : "",
        toolUseId: `call-${String(Math.floor(index / 2))}`,
        toolName: "Bash",
        toolInput: index % 2 ? Prisma.DbNull : { command: "pnpm test" },
        searchable: true,
        searchText: "test failure",
      },
    });
  }
  const rows = await metrics("outcomes", {
    filters: { ...filters, repo_name: "outcomes" },
  });
  expect(find(rows, "tool_calls_per_session", true)).toMatchObject({
    value: 8,
    numerator: 8,
    denominator: 1,
  });
  expect(find(rows, "tokens_per_session", true).value).toBe(200);
  expect(find(rows, "duration_seconds_per_session", true).value).toBe(3600);
  expect(find(rows, "rerun_loop_rate", true).value).toBe(1);
  expect(find(rows, "rerun_loop_rate", false).value).toBe(0);
  expect(find(rows, "observed_commit_rate", true).value).toBe(1);
  expect(find(rows, "near_duplicate_rate", true).value).toBe(1);
  await db.prisma.installation.update({
    where: {
      organizationId_id: {
        organizationId: disabled.organizationId,
        id: disabled.installationId,
      },
    },
    data: { toolsEnabled: true },
  });
  expect(
    find(
      await metrics("outcomes", {
        filters: { ...filters, repo_name: "outcomes" },
      }),
      "tool_calls_per_session",
      true,
    ),
  ).toMatchObject({ value: 5, denominator: 2 });
  const one = await session(org.context, { repo: "vectors", prompt: "alpha" });
  const two = await session(member.context, {
    repo: "vectors",
    prompt: "zulu",
  });
  const vector =
    "[" + [1, ...Array.from({ length: 1023 }, () => 0)].join(",") + "]";
  for (const s of [one, two])
    await db.prisma
      .$executeRaw`INSERT INTO session_embedding(organization_id,session_id,embedding,model,token_count,updated_at) VALUES(${s.organizationId},${s.id}::uuid,${vector}::vector,'text-embedding-3-small',1,now())`;
  expect(
    find(
      await metrics("outcomes", {
        filters: { ...filters, repo_name: "vectors" },
      }),
      "near_duplicate_rate",
    ).value,
  ).toBe(0);
  const readers = new ReaderPools(db.urls, {}, { embeddings: true });
  try {
    const on = new MetricsService({
      ...db,
      readers,
      cursors: new CursorCodec("metrics-on-secret"),
    });
    expect(
      find(
        (
          await on.get(org.context, "outcomes", {
            filters: { ...filters, repo_name: "vectors" },
          })
        ).result.items,
        "near_duplicate_rate",
      ).value,
    ).toBe(1);
  } finally {
    await readers.close();
  }
});

// @req R-DASH-13 @req R-AUD-01 @req R-ORG-09
it("pages and sorts with filter-bound cursors, denies members, and fails closed when read auditing fails", async () => {
  const input = { filters, limit: 2, sort: "metric", order: "asc" };
  const first = await service.get(org.context, "health", input);
  expect(first.result.items).toHaveLength(2);
  expect(first.result.cursor).not.toBeNull();
  const second = await service.get(org.context, "health", {
    ...input,
    cursor: first.result.cursor,
  });
  expect(second.result.items).not.toEqual(first.result.items);
  await expect(
    service.get(org.context, "health", {
      ...input,
      filters: { ...filters, repo_name: "changed" },
      cursor: first.result.cursor,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  await expect(
    service.get(foreign.context, "health", {
      ...input,
      cursor: first.result.cursor,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  await expect(
    service.get(member.context, "health", input),
  ).rejects.toMatchObject({ statusCode: 403 });
  const spy = vi
    .spyOn(db.audit, "write")
    .mockRejectedValueOnce(new Error("Audit unavailable"));
  await expect(service.get(org.context, "health", input)).rejects.toThrow();
  spy.mockRestore();
  expect(
    await db.prisma.auditEvent.count({
      where: {
        organizationId: requireCaller(org.context).organizationId,
        action: "admin.metrics",
        statusCode: 200,
      },
    }),
  ).toBeGreaterThan(0);
});

// @req R-DASH-13 @req R-DASH-15 @req R-AUD-01 @req R-RED-07
it("retains authoritative read resource IDs and numeric search results under UUID policies and oversized audit filters", async () => {
  const { SearchService } = await import("../src/services/search.js");
  const { SessionService } = await import("../src/services/session.js");
  const now = Date.now();
  const target = await session(member.context, {
    repo: "audit-metrics",
    start: new Date(now - 7_200_000),
    end: new Date(now - 3_600_000),
  });
  const source = await session(org.context, {
    repo: "audit-metrics",
    start: new Date(now - 600_000),
    end: new Date(now + 600_000),
  });
  const batch = await receipt(target, "sync", target.startedAt, 1);
  const raw = await db.prisma.rawRecord.create({
    data: {
      id: randomUUID(),
      organizationId: target.organizationId,
      sessionId: target.id,
      pos: 0,
      key: randomUUID(),
      recordType: "user",
      payload: {},
      ingestBatchId: batch.id,
    },
  });
  await db.prisma.message.create({
    data: {
      id: randomUUID(),
      organizationId: target.organizationId,
      sessionId: target.id,
      rawRecordId: raw.id,
      seq: 0,
      blockIndex: 0,
      role: "USER",
      kind: "TEXT",
      content: "audit fixture searchable",
      searchText: "audit fixture searchable",
      searchable: true,
    },
  });
  const rule = await db.prisma.redactionPolicy.create({
    data: {
      id: randomUUID(),
      organizationId: target.organizationId,
      name: "audit_identifiers",
      kind: "REGEX",
      pattern:
        "(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|result|hits|input|query|filters)",
      flags: "g",
      replacement: "[REDACTED:audit_identifiers]",
      builtin: false,
    },
  });
  db.policies.invalidate(target.organizationId);
  try {
    const dependencies = {
      ...db,
      cursors: new CursorCodec("metrics-authoritative-audit"),
    };
    const search = new SearchService(dependencies);
    const get = new SessionService(dependencies);
    const result = await search.execute(org.context, {
      query: "audit fixture",
      filters: {
        repo_name: [
          "audit-metrics",
          ...Array.from(
            { length: 300 },
            (_, index) => `irrelevant-${String(index)}-${"x".repeat(100)}`,
          ),
          "token=not_a_real_secret123456789",
        ],
      },
    });
    expect(result.audit.resourceIds).toContain(target.id);
    expect(result.audit.detail).toMatchObject({
      result: { hits: 1, truncated_response: false },
    });
    expect(
      Buffer.byteLength(JSON.stringify(result.audit.detail)),
    ).toBeLessThanOrEqual(8192);
    expect(JSON.stringify(result.audit.detail)).not.toContain(
      "not_a_real_secret123456789",
    );
    const read = await get.get(org.context, { session_id: target.id });
    expect(read.audit.resourceIds).toEqual([target.id]);
    expect(JSON.stringify(read.audit.detail)).not.toContain(target.id);
    const edges = await db.readers.read(
      requireCaller(org.context),
      async (client) =>
        (
          await client.query<Record<string, unknown>>(
            "SELECT * FROM api_ro.reuse_edges WHERE source_session_id=$1 AND target_session_id=$2",
            [source.id, target.id],
          )
        ).rows,
    );
    expect(edges).toHaveLength(1);
    const events = await db.readers.read(
      requireCaller(org.context),
      async (client) =>
        (
          await client.query<Record<string, unknown>>(
            "SELECT hits,followed_through FROM api_ro.metrics_usage WHERE id=$1",
            [result.audit.id],
          )
        ).rows,
    );
    expect(events[0]).toMatchObject({ hits: "1", followed_through: true });
    const structural = await db.audit.write(org.context, {
      action: "search",
      detail: {
        input: {
          query: "query input",
          filters: { repo_name: ["query"] },
          "query-private-field": "input",
        },
        result: { hits: 0, truncated_response: false },
      },
    });
    const structuralInput = z
      .object({ input: z.record(z.string(), z.json()) })
      .parse(structural.detail).input;
    expect(structuralInput.query).toBe(
      "[REDACTED:audit_identifiers] [REDACTED:audit_identifiers]",
    );
    expect(structuralInput).not.toHaveProperty("query-private-field");
    expect(
      Object.keys(structuralInput).some((key) =>
        key.startsWith("[REDACTED:audit_identifiers]"),
      ),
    ).toBe(true);
    const empty = await search.execute(org.context, {
      query: "query missingauditword token=not_a_real_secret123456789",
      filters: {
        repo_name: [
          "audit-metrics",
          ...Array.from(
            { length: 300 },
            (_, index) => `irrelevant-${String(index)}-${"x".repeat(100)}`,
          ),
        ],
      },
    });
    expect(empty.audit.detail).toMatchObject({
      result: { hits: 0, truncated_response: false },
    });
    const own = await db.readers.read(
      requireCaller(org.context),
      async (client) =>
        (
          await client.query<Record<string, unknown>>(
            "SELECT search_id,query FROM api_ro.metrics_own_zero_results WHERE search_id=$1",
            [empty.audit.id],
          )
        ).rows,
    );
    expect(own).toHaveLength(1);
    const query = z.string().parse(own[0]?.query);
    expect(query).toContain("missingauditword");
    expect(query).toContain("[REDACTED:audit_identifiers]");
    expect(query).not.toContain("not_a_real_secret123456789");
    expect(
      Buffer.byteLength(JSON.stringify(empty.audit.detail)),
    ).toBeLessThanOrEqual(8192);
  } finally {
    await db.prisma.redactionPolicy.update({
      where: { id: rule.id },
      data: { enabled: false },
    });
    db.policies.invalidate(target.organizationId);
  }
});

// @req R-DASH-13
it("uses strict similarity thresholds and does not turn one failed attempt with a reused tool ID into a rerun loop", async () => {
  const low = await session(org.context, {
    repo: "trigram-boundary",
    prompt: "abcdefg",
  });
  await session(member.context, {
    repo: "trigram-boundary",
    prompt: "abcdefh",
  });
  expect(
    (
      await db.prisma.$queryRaw<
        { value: number }[]
      >`SELECT similarity('abcdefg','abcdefh') AS value`
    )[0]?.value,
  ).toBeCloseTo(0.6);
  expect(
    find(
      await metrics("outcomes", {
        filters: { ...filters, repo_name: "trigram-boundary" },
      }),
      "near_duplicate_rate",
    ).value,
  ).toBe(0);
  const batch = await receipt(low, "sync", at(9, 1), 2);
  for (let index = 0; index < 4; index++) {
    const raw = await db.prisma.rawRecord.create({
      data: {
        organizationId: low.organizationId,
        id: randomUUID(),
        sessionId: low.id,
        pos: index,
        key: randomUUID(),
        recordType: "assistant",
        payload: {},
        ingestBatchId: batch.id,
      },
    });
    await db.prisma.message.create({
      data: {
        organizationId: low.organizationId,
        id: randomUUID(),
        sessionId: low.id,
        rawRecordId: raw.id,
        seq: index,
        blockIndex: 0,
        role: index % 2 ? "TOOL_RESULT" : "ASSISTANT",
        kind: index % 2 ? "TOOL_RESULT" : "TOOL_USE",
        content:
          index === 1 ? "Tests passed" : index === 3 ? "Tests failed" : "",
        toolUseId: "reused-native-id",
        toolName: "Bash",
        toolInput: index % 2 ? Prisma.DbNull : { command: "pnpm test" },
        searchable: true,
        searchText: "test",
      },
    });
  }
  expect(
    find(
      await metrics("outcomes", {
        filters: { ...filters, repo_name: "trigram-boundary" },
      }),
      "rerun_loop_rate",
    ).value,
  ).toBe(0);
  const readers = new ReaderPools(db.urls, {}, { embeddings: true });
  try {
    const on = new MetricsService({
      ...db,
      readers,
      cursors: new CursorCodec("threshold-audit"),
    });
    for (const similarity of [0.59, 0.61]) {
      const name = `cosine-${String(similarity)}`;
      const first = await session(org.context, { repo: name, prompt: "alpha" });
      const second = await session(member.context, {
        repo: name,
        prompt: "zulu",
      });
      for (const [row, x, y] of [
        [first, 1, 0],
        [second, similarity, Math.sqrt(1 - similarity ** 2)],
      ] as const) {
        const vector = JSON.stringify([
          x,
          y,
          ...Array.from({ length: 1022 }, () => 0),
        ]);
        await db.prisma
          .$executeRaw`INSERT INTO session_embedding(organization_id,session_id,embedding,model,token_count,updated_at) VALUES(${row.organizationId},${row.id}::uuid,${vector}::vector,'text-embedding-3-small',1,now())`;
      }
      expect(
        find(
          (
            await on.get(org.context, "outcomes", {
              filters: { ...filters, repo_name: name },
            })
          ).result.items,
          "near_duplicate_rate",
        ).value,
      ).toBe(similarity > 0.6 ? 1 : 0);
    }
  } finally {
    await readers.close();
  }
});

// @req R-DASH-13 @req R-DASH-15
it("returns complete eight-week empty trends and bounds displayed metadata without changing stored filter values", async () => {
  const trend = (
    await service.get(org.context, "reuse", {
      filters: {
        date_from: "2026-07-20T00:00:00Z",
        date_to: "2026-09-14T00:00:00Z",
      },
      limit: 100,
    })
  ).result.items;
  expect(trend).toHaveLength(16);
  expect(new Set(trend.map((row) => row.date)).size).toBe(8);
  const name = `github.com/${"界".repeat(2000)}/bounded`;
  const row = await session(org.context, { repo: name });
  const result = await metrics("outcomes", {
    filters: { ...filters, repo_name: name },
  });
  expect(result).toHaveLength(6);
  for (const item of result) {
    expect(item.truncated_fields).toContain("repo_name");
    expect(Buffer.byteLength(item.repo_name ?? "")).toBeLessThanOrEqual(256);
    expect(item.repo_name).toMatch(/…$/u);
  }
  expect(
    (await db.prisma.agentSession.findUniqueOrThrow({ where: { id: row.id } }))
      .repoName,
  ).toBe(name);
});
