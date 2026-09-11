import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  initialCursor,
  readSource,
} from "../../../packages/hook/src/readers.js";
import { HARNESSES } from "../../../packages/hook/src/harnesses.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import {
  builtinDashboardId,
  jsonObjectSchema,
  metricGroups,
  type metricsOutputSchema,
  searchAdoptionMetricNames,
  type Harness,
  type IngestEnvelope,
  type MetricRow,
} from "@agentcommons/core";
import {
  NO_TARGET_SESSION_ID,
  type TraceSessionRead,
} from "@agentcommons/traces";
type JsonObject = z.infer<typeof jsonObjectSchema>;
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { traceServices } from "./trace-services.js";
import { DashboardService } from "../src/services/dashboards.js";
import { QueryService } from "../src/services/query.js";
import { MetricsService } from "../src/services/metrics.js";
import { AdminService } from "../src/services/admin.js";
import { CursorCodec } from "../src/services/cursor.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";
import { provisionOrganization, provisionMember, releaser } from "./support.js";
import { testEnvelope } from "./envelopes.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let org: Awaited<ReturnType<typeof provisionOrganization>>;
let member: Awaited<ReturnType<typeof provisionMember>>;
let foreign: Awaited<ReturnType<typeof provisionOrganization>>;
let services: ReturnType<typeof traceServices>;
let dashboards: DashboardService;
let metrics: MetricsService;
let admin: AdminService;
const { defer, release } = releaser();
const countSchema = z.strictObject({
  session_id: z.string(),
  agentcommons_search_calls: z.coerce.number(),
  repeat_agentcommons_search_calls: z.coerce.number(),
});
const week = new Date();
week.setUTCHours(0, 0, 0, 0);
week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
const dateFrom = week.toISOString();
const dateTo = new Date(week.getTime() + 7 * 86_400_000).toISOString();
const minutes = (count: number, from = week) =>
  new Date(from.getTime() + count * 60_000);

async function fixture(name: string) {
  const text = await readFile(
    new URL(
      `../../../fixtures/transcripts/tool-identities/${name}`,
      import.meta.url,
    ),
    "utf8",
  );
  return name.endsWith(".jsonl")
    ? text
        .trim()
        .split("\n")
        .map((line) => jsonObjectSchema.parse(JSON.parse(line)))
    : z
        .array(jsonObjectSchema)
        .parse(jsonObjectSchema.parse(JSON.parse(text)).messages);
}
function envelope(
  harness: Harness,
  records: JsonObject[],
  repo: string,
  at = week,
): IngestEnvelope {
  const native = randomUUID();
  return testEnvelope({
    harness,
    harnessSessionId: native,
    nativeEvent: "fixture-sync",
    sourcePos: records.length,
    cursor: "initial",
    context: {
      cwd: "/adoption",
      installation: { hostname: "adoption", osUser: "fixture" },
      git: {
        root: "/adoption",
        remoteUrl: `https://github.com/adoption/${repo}.git`,
        branch: "main",
        head: "abc123",
      },
      ...(harness === "GEMINI_CLI"
        ? {
            transcriptMetadata: {
              sessionId: native,
              startTime: at.toISOString(),
            },
          }
        : {}),
    },
    // Rebase only the test clock; native tool names, calls, results and ordering are captured data.
    records: records.map((payload, pos) => ({
      pos,
      sourceVersion: 0,
      key: `record-${String(pos)}`,
      line: JSON.stringify({
        ...payload,
        timestamp: new Date(at.getTime() + pos).toISOString(),
      }),
    })),
  });
}
function publish(context: ServiceContext, input: IngestEnvelope) {
  return services.publishQueued(context, input);
}
async function messages(context: ServiceContext, id: string) {
  return db.traceReaders.read(
    requireCaller(context),
    async (client) =>
      (
        await client.query(
          "SELECT kind,tool_name FROM api_ro.messages WHERE session_id={id:UUID} ORDER BY seq",
          { id },
        )
      ).rows,
  );
}
async function capture(
  harness: Harness,
  records: JsonObject[],
  repo: string,
  context = org.context,
  at = week,
) {
  const input = envelope(harness, records, repo, at);
  const response = await publish(context, input);
  return { input, id: response.result.sessionId };
}
async function counts(context: ServiceContext, ids: string[]) {
  return db.traceReaders.read(requireCaller(context), async (client) => {
    const result = await client.query(
      `SELECT session_id,agentcommons_search_calls,repeat_agentcommons_search_calls
      FROM api_ro.metrics_search_sessions WHERE session_id IN {ids:Array(UUID)} ORDER BY session_id`,
      { ids },
    );
    return z.array(countSchema).parse(result.rows);
  });
}
async function one(id: string, calls: number, repeat: number) {
  expect(await counts(org.context, [id])).toEqual([
    {
      session_id: id,
      agentcommons_search_calls: calls,
      repeat_agentcommons_search_calls: repeat,
    },
  ]);
}
/**
 * Reads credited to a session, written the way the audit projection stores them
 * (ADR 0060): one row per successful key-authenticated call while the session was active.
 */
async function credit(
  context: ServiceContext,
  sessionId: string,
  actions: readonly ("search" | "sql")[],
): Promise<TraceSessionRead[]> {
  const caller = requireCaller(context);
  const rows: TraceSessionRead[] = actions.map((action, index) => ({
    organization_id: caller.organizationId,
    session_id: sessionId,
    audit_id: randomUUID(),
    read_at: minutes(index + 1),
    action,
    target_session_id: NO_TARGET_SESSION_ID,
    reader_user_id: caller.userId,
    reader_email: "reader@example.com",
    reader_harness: "CLAUDE_CODE",
  }));
  await db.traces.appendSessionReads(rows);
  return rows;
}
/** A successful key-authenticated MCP call audited from the envelope's installation at `time`. */
async function agentCall(
  context: ServiceContext,
  input: IngestEnvelope,
  action: "search" | "sql" | "get",
  time: Date,
  target?: string,
) {
  const caller = requireCaller(context);
  const row = await db.prisma.auditEvent.create({
    data: {
      organizationId: caller.organizationId,
      id: randomUUID(),
      ts: time,
      requestId: randomUUID(),
      userId: caller.userId,
      apiKeyId: caller.apiKeyId,
      installationId: input.installationId,
      authMethod: "key",
      ip: "fixture",
      transport: "mcp",
      action,
      statusCode: 200,
      durationMs: 1,
      resourceIds: target ? [target] : [],
      detail: {
        input: action === "sql" ? { sql: "SELECT 1" } : { query: "fixture" },
        result: target ? { session_id: target } : { hits: 0 },
      },
    },
  });
  await db.prisma.traceAuditOutbox.create({ data: { auditId: row.id } });
  await services.drainTraceAudit();
  return row;
}
/** Home's KPIs are stat tiles of the default dashboard; read this week's captured and searching sessions. */
async function homeKpis(context: ServiceContext) {
  // Saved renders are cached for an hour (ADR 0058); refresh so the tiles reflect the fixtures just captured.
  const rendered = (
    await dashboards.render(context, {
      id: builtinDashboardId,
      tiles: ["captured_sessions", "search_sessions"],
      variables: { time_range: "this_week" },
      refresh: true,
    })
  ).result;
  const value = (id: string) => {
    const tile = rendered.tiles.find((item) => item.id === id);
    expect(tile?.error, id).toBeNull();
    return Number(tile?.result?.rows[0]?.[0]);
  };
  return {
    sessions: value("captured_sessions"),
    agentcommons_search_sessions: value("search_sessions"),
  };
}
async function usage(
  repo: string,
  metric?: (typeof searchAdoptionMetricNames)[number],
) {
  return metrics.get(org.context, "usage", {
    filters: {
      date_from: dateFrom,
      date_to: dateTo,
      repo_name: `github.com/adoption/${repo}`,
      ...(metric ? { metric } : {}),
    },
    limit: 100,
    sort: "metric",
    order: "asc",
  });
}

beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  org = await provisionOrganization(db, "adoption-primary");
  member = await provisionMember(db, org.owner, "adoption-member@example.com");
  foreign = await provisionOrganization(db, "adoption-foreign");
  const dependencies = {
    ...db,
    readers: db.traceReaders,
    cursors: new CursorCodec("adoption-cursor-secret"),
  };
  services = traceServices(db);
  defer(() => services.close());
  dashboards = new DashboardService({
    prisma: db.prisma,
    audit: db.audit,
    query: new QueryService(dependencies),
  });
  metrics = new MetricsService(dependencies);
  admin = new AdminService({
    ...dependencies,
    jobs: services.jobs,
    server: { version: "test-release", autoUpdate: false },
  });
}, 120_000);
afterAll(release);

// @req R-DASH-18 @req R-AUD-05
it("counts sessions that queried AgentCommons from attributed search and sql reads, whatever the transcript calls the tool", async () => {
  // The transcript names the server by a user-chosen alias no list could know.
  const aliased: JsonObject[] = [
    {
      type: "user",
      uuid: randomUUID(),
      message: { role: "user", content: "Check prior work first." },
    },
    {
      type: "assistant",
      uuid: randomUUID(),
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "alias-1",
            name: "mcp__mymemory__sql",
            input: { sql: "SELECT 1" },
          },
          {
            type: "tool_use",
            id: "alias-2",
            name: "mcp__mymemory__sql",
            input: { sql: "SELECT 2" },
          },
          {
            type: "tool_use",
            id: "grep",
            name: "Grep",
            input: { pattern: "x" },
          },
        ],
      },
    },
  ];
  const prior = await capture("CLAUDE_CODE", aliased, "alias-prior");
  const reader = await capture("CLAUDE_CODE", aliased, "alias-reader");
  expect(
    (await messages(org.context, reader.id))
      .filter((row) => row.kind === "TOOL_USE")
      .map((row) => row.tool_name),
  ).toEqual(["mcp__mymemory__sql", "mcp__mymemory__sql", "Grep"]);
  await one(reader.id, 0, 0);
  // The calls the agent actually made, audited on the reader's installation while active.
  await agentCall(org.context, reader.input, "sql", minutes(1));
  await agentCall(org.context, reader.input, "sql", minutes(2));
  await agentCall(org.context, reader.input, "search", minutes(3));
  await agentCall(org.context, reader.input, "get", minutes(4), prior.id);
  // An hour before the session started, outside every active window: credited to no session.
  await agentCall(org.context, reader.input, "sql", minutes(-60));
  await one(reader.id, 3, 2);
  await one(prior.id, 0, 0);
  // Transcript tool names that match the retired identity list count for nothing on their own.
  const named = await capture(
    "CLAUDE_CODE",
    await fixture("claude.jsonl"),
    "named-only",
  );
  expect(
    (await messages(org.context, named.id)).filter(
      (row) =>
        row.kind === "TOOL_USE" &&
        row.tool_name === "mcp__agentcommons__search",
    ),
  ).toHaveLength(2);
  await one(named.id, 0, 0);
  expect(await homeKpis(org.owner)).toMatchObject({
    agentcommons_search_sessions: 1,
  });
});

// @req R-DASH-18
it("counts stored reads once per audited call and keeps transcript branches out of the metric", async () => {
  const records = await fixture("pi.jsonl");
  const { input, id } = await capture("PI", records, "pi-branch");
  expect(
    (await messages(org.context, id)).filter((row) => row.kind === "TOOL_USE")
      .length,
  ).toBe(2);
  const stored = await credit(org.context, id, ["sql", "search"]);
  await one(id, 2, 1);
  // A retried flush stores the same audit ids again without double counting.
  await db.traces.appendSessionReads(stored);
  await one(id, 2, 1);
  // Switching the projected branch rewrites the transcript, not the audited calls.
  const firstTool = records.find((record) => record.id === "6438540e");
  const priorLeaf = z.string().parse(firstTool?.parentId);
  await publish(org.context, {
    ...input,
    batchId: randomUUID(),
    records: [],
    sentAt: new Date(Date.parse(input.sentAt) + 1000).toISOString(),
    context: { ...input.context, activeLeafId: priorLeaf },
  });
  expect(
    (await messages(org.context, id)).filter((row) => row.kind === "TOOL_USE")
      .length,
  ).toBe(0);
  await one(id, 2, 1);
});

// @req R-DASH-18 @req R-DASH-16
it("shares exact caller-visible adoption with every member's Home dashboard and admin Usage, preserving private/purge/org scope, dates, repo filters and null denominators", async () => {
  const before = await homeKpis(member.owner);
  const native = await fixture("claude.jsonl");
  const visible = await capture(
    "CLAUDE_CODE",
    native,
    "window",
    member.context,
  );
  const zero = await capture(
    "PI",
    await fixture("pi.jsonl"),
    "window",
    member.context,
  );
  const hidden = await capture("CLAUDE_CODE", native, "window");
  const purged = await capture("CLAUDE_CODE", native, "window");
  const outside = await capture(
    "CLAUDE_CODE",
    native,
    "window",
    foreign.context,
  );
  const old = await capture(
    "CLAUDE_CODE",
    native,
    "window",
    org.context,
    new Date(week.getTime() - 86_400_000),
  );
  const next = await capture(
    "CLAUDE_CODE",
    native,
    "window",
    org.context,
    new Date(dateTo),
  );
  await credit(member.context, visible.id, ["search", "search"]);
  await credit(org.context, hidden.id, ["sql", "sql"]);
  await credit(org.context, purged.id, ["sql", "search"]);
  await credit(foreign.context, outside.id, ["sql", "sql"]);
  await credit(org.context, old.id, ["search"]);
  await credit(org.context, next.id, ["search"]);
  await admin.setVisibility(org.owner, {
    session_id: hidden.id,
    visibility: "PRIVATE",
    reason: "Test caller-visible adoption",
  });
  await admin.purge(org.owner, {
    session_id: purged.id,
    reason: "Test adoption removal",
  });
  const ids = [visible.id, zero.id, hidden.id, purged.id, outside.id, old.id];
  expect(
    (await counts(member.owner, ids)).map((row) => row.session_id).sort(),
  ).toEqual([visible.id, zero.id, old.id].sort());
  expect(
    (await counts(org.owner, ids)).map((row) => row.session_id).sort(),
  ).toEqual([visible.id, zero.id, hidden.id, old.id].sort());
  expect(await homeKpis(member.owner)).toEqual({
    sessions: before.sessions + 2,
    agentcommons_search_sessions: before.agentcommons_search_sessions + 1,
  });
  const rows = (await usage("window")).result.items;
  expect(
    rows
      .filter((row) =>
        searchAdoptionMetricNames.some((name) => name === row.metric),
      )
      .map((row) => [row.metric, row.value]),
  ).toEqual([
    ["agentcommons_search_calls", 4],
    ["agentcommons_search_rate", 2 / 3],
    ["agentcommons_search_sessions", 2],
    ["repeat_agentcommons_search_calls", 2],
  ]);
  const rate = (await usage("window", "agentcommons_search_rate")).result.items;
  expect(rate).toHaveLength(1);
  expect(rate[0]).toMatchObject({
    value: 2 / 3,
    numerator: 2,
    denominator: 3,
    unit: "ratio",
  });
  expect(
    (await usage("missing-repository", "agentcommons_search_rate")).result
      .items[0],
  ).toMatchObject({ value: null, numerator: 0, denominator: 0 });
  const empty = await provisionOrganization(db, "adoption-empty");
  expect(await homeKpis(empty.owner)).toEqual({
    sessions: 0,
    agentcommons_search_sessions: 0,
  });
  await expect(
    metrics.get(member.owner, "usage", {
      filters: { date_from: dateFrom, date_to: dateTo },
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
});

// @req R-DASH-13 @req R-DASH-15 @req R-DASH-16 @req R-DASH-18 @req R-ORG-07
it("executes every metric group on empty and populated native views with null ratios and keeps Home tiles and Usage in agreement per organization", async () => {
  const fresh = await provisionOrganization(db, "metric-groups");
  const freshMember = await provisionMember(
    db,
    fresh.owner,
    "metric-groups-member@example.com",
  );
  const window = { date_from: dateFrom, date_to: dateTo };
  const groups = Object.keys(metricGroups) as (keyof typeof metricGroups)[];
  expect(await homeKpis(fresh.owner)).toEqual({
    sessions: 0,
    agentcommons_search_sessions: 0,
  });
  for (const group of groups) {
    const result = (await metrics.get(fresh.owner, group, { filters: window }))
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
  const searching: JsonObject[] = [
    {
      type: "user",
      uuid: randomUUID(),
      message: { role: "user", content: "Native metrics verification" },
    },
    {
      type: "assistant",
      message: {
        id: randomUUID(),
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "search-first",
            name: "mcp__agentcommons__search",
            input: { query: "existing work" },
          },
          {
            type: "tool_use",
            id: "search-repeat",
            name: "mcp__agentcommons__sql",
            input: { sql: "SELECT 1" },
          },
          {
            type: "tool_use",
            id: "code-search",
            name: "Grep",
            input: { pattern: "implementation" },
          },
        ],
      },
    },
  ];
  const plain: JsonObject[] = [
    {
      type: "user",
      uuid: randomUUID(),
      message: { role: "user", content: "Captured work" },
    },
  ];
  const others = await homeKpis(org.owner);
  const alpha = await capture(
    "CLAUDE_CODE",
    searching,
    "metrics-alpha",
    fresh.context,
  );
  await capture("CLAUDE_CODE", plain, "metrics-beta", freshMember.context);
  await credit(fresh.context, alpha.id, ["search", "sql"]);
  expect(await homeKpis(fresh.owner)).toEqual({
    sessions: 2,
    agentcommons_search_sessions: 1,
  });
  expect(await homeKpis(org.owner)).toEqual(others);
  const usageRows = (
    await metrics.get(fresh.owner, "usage", {
      filters: { ...window, repo_name: "github.com/adoption/metrics-alpha" },
    })
  ).result;
  expect(
    usageRows.items.find((row) => row.metric === "agentcommons_search_rate"),
  ).toMatchObject({ value: 1, numerator: 1, denominator: 1 });
  expect(
    usageRows.items.find((row) => row.metric === "agentcommons_search_calls")
      ?.value,
  ).toBe(2);
  const absent = (
    await metrics.get(fresh.owner, "usage", {
      filters: { ...window, repo_name: "github.com/adoption/absent" },
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
  for (const group of groups) {
    const populated = (
      await metrics.get(fresh.owner, group, { filters: window })
    ).result;
    expect(populated.items.length).toBeGreaterThan(0);
    expect(
      populated.items.every(
        (row) => row.value === null || Number.isFinite(row.value),
      ),
    ).toBe(true);
  }
  const outcomes = (
    await metrics.get(fresh.owner, "outcomes", { filters: window })
  ).result;
  expect(
    outcomes.items.find(
      (row) =>
        row.metric === "tool_calls_per_session" &&
        row.repo_name === "github.com/adoption/metrics-alpha",
    ),
  ).toMatchObject({ value: 3, numerator: 3, denominator: 1 });
  await expect(
    metrics.get(freshMember.owner, "health", { filters: window }),
  ).rejects.toMatchObject({ statusCode: 403 });
  const first = (
    await metrics.get(fresh.owner, "usage", {
      filters: window,
      limit: 1,
      sort: "metric",
      order: "asc",
    })
  ).result;
  expect(first.cursor).not.toBeNull();
  const second = (
    await metrics.get(fresh.owner, "usage", {
      filters: window,
      limit: 1,
      sort: "metric",
      order: "asc",
      cursor: first.cursor,
    })
  ).result;
  expect(second.items[0]?.metric).not.toBe(first.items[0]?.metric);
});

// @req R-DASH-18
it("paginates and sorts admin adoption rows without omission or duplication and binds cursors to date/repo filters", async () => {
  const input = {
    filters: {
      date_from: dateFrom,
      date_to: dateTo,
      repo_name: "github.com/adoption/window",
    },
    limit: 2,
    sort: "metric",
    order: "asc",
  };
  const full = (await metrics.get(org.owner, "usage", { ...input, limit: 100 }))
    .result.items;
  const rows: MetricRow[] = [];
  let cursor: string | null = null;
  let firstCursor: string | null = null;
  for (let page = 0; page < 30; page++) {
    const result: z.infer<typeof metricsOutputSchema> = (
      await metrics.get(org.owner, "usage", {
        ...input,
        ...(cursor ? { cursor } : {}),
      })
    ).result;
    rows.push(...result.items);
    cursor = result.cursor;
    firstCursor ??= cursor;
    if (!cursor) break;
  }
  expect(cursor).toBeNull();
  expect(rows).toEqual(full);
  expect(
    rows.filter((row) =>
      searchAdoptionMetricNames.some((name) => name === row.metric),
    ),
  ).toHaveLength(searchAdoptionMetricNames.length);
  await expect(
    metrics.get(org.owner, "usage", {
      ...input,
      cursor: z.string().parse(firstCursor),
      filters: { ...input.filters, repo_name: "different" },
    }),
  ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
});

// @req R-HRN-03 @req R-HRN-04
it("retains real transient Gemini delegation snapshots in raw history while projecting only the current parent document", async () => {
  const input = envelope("GEMINI_CLI", [], "gemini-native-delegation");
  const snapshots = [
    "01-before.json",
    "02-child-read.json",
    "03-child-completed.json",
    "04-parent-resumed.json",
    "05-final.json",
  ];
  let cursor = initialCursor(HARNESSES.gemini);
  let watermark = 0;
  let id = "";
  const observed = new Set<string>();
  let finalIds: string[] = [];
  for (const [index, name] of snapshots.entries()) {
    const path = fileURLToPath(
      new URL(
        `../../../fixtures/transcripts/gemini-cli/delegation/${name}`,
        import.meta.url,
      ),
    );
    const source = readSource(path, cursor, HARNESSES.gemini, watermark);
    expect(source.transcriptMetadata?.sourceRecordCount).toBe(
      [1, 4, 5, 2, 4][index],
    );
    for (const record of source.records) observed.add(record.line);
    const response = await publish(org.context, {
      ...input,
      batchId: randomUUID(),
      sentAt: new Date(Date.now() + index).toISOString(),
      sourcePos: source.sourcePos,
      cursor: JSON.stringify(source.cursor),
      context: {
        ...input.context,
        transcriptMetadata: z
          .record(z.string(), z.json())
          .parse(source.transcriptMetadata),
      },
      records: source.records,
    });
    id = response.result.sessionId;
    cursor = source.cursor;
    watermark = source.sourcePos;
    if (index === snapshots.length - 1) {
      finalIds = z
        .looseObject({ messages: z.array(z.looseObject({ id: z.string() })) })
        .parse(JSON.parse(await readFile(path, "utf8")))
        .messages.map((message) => message.id);
    }
  }
  const rows = await db.traceReaders.read(
    requireCaller(org.context),
    async (client) => ({
      raw: (
        await client.query(
          "SELECT raw_record_id,payload FROM api_ro.raw_records WHERE session_id={id:UUID}",
          { id },
        )
      ).rows,
      messages: (
        await client.query(
          "SELECT raw_record_id,kind,tool_name,content FROM api_ro.messages WHERE session_id={id:UUID} ORDER BY seq",
          { id },
        )
      ).rows,
      session: (
        await client.query(
          "SELECT parent_session_id FROM api_ro.sessions WHERE session_id={id:UUID}",
          { id },
        )
      ).rows,
    }),
  );
  const raw = z
    .array(z.object({ raw_record_id: z.string(), payload: z.string() }))
    .parse(rows.raw);
  const actualPayloads = raw.map((record) =>
    jsonObjectSchema.parse(JSON.parse(record.payload)),
  );
  const observedPayloads = [...observed].map((line) =>
    jsonObjectSchema.parse(JSON.parse(line)),
  );
  expect(actualPayloads).toHaveLength(observedPayloads.length);
  expect(actualPayloads).toEqual(expect.arrayContaining(observedPayloads));
  expect(raw.length).toBeGreaterThan(finalIds.length);
  const sourceIds = new Map(
    raw.map((record) => [
      record.raw_record_id,
      z.looseObject({ id: z.string() }).parse(JSON.parse(record.payload)).id,
    ]),
  );
  for (const message of rows.messages)
    expect(finalIds).toContain(
      sourceIds.get(z.string().parse(message.raw_record_id)),
    );
  expect(
    rows.messages
      .filter((message) => message.kind === "TOOL_USE")
      .map((message) => message.tool_name),
  ).toEqual(["generalist", "read_file"]);
  expect(
    rows.messages.find(
      (message) =>
        message.kind === "TOOL_RESULT" && message.tool_name === "generalist",
    )?.content,
  ).toContain("NATIVE-GEMINI-DELEGATION-CONTRACT-20260908");
  expect(rows.session).toEqual([{ parent_session_id: null }]);
});
