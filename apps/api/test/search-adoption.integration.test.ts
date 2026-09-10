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
type JsonObject = z.infer<typeof jsonObjectSchema>;
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { traceServices } from "./trace-services.js";
import { DashboardService } from "../src/services/dashboards.js";
import { QueryService } from "../src/services/query.js";
import { MetricsService } from "../src/services/metrics.js";
import { PolicyService } from "../src/services/policies.js";
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
  subsequent_other_search_calls: z.coerce.number(),
});
const week = new Date();
week.setUTCHours(0, 0, 0, 0);
week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
const dateFrom = week.toISOString();
const dateTo = new Date(week.getTime() + 7 * 86_400_000).toISOString();

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
      `SELECT session_id,agentcommons_search_calls,
      repeat_agentcommons_search_calls,subsequent_other_search_calls
      FROM api_ro.metrics_search_sessions WHERE session_id IN {ids:Array(UUID)} ORDER BY session_id`,
      { ids },
    );
    return z.array(countSchema).parse(result.rows);
  });
}
async function one(id: string, calls: number, repeat: number, other: number) {
  expect(await counts(org.context, [id])).toEqual([
    {
      session_id: id,
      agentcommons_search_calls: calls,
      repeat_agentcommons_search_calls: repeat,
      subsequent_other_search_calls: other,
    },
  ]);
}
function claudeTool(name: string, id: string, uuid = randomUUID()): JsonObject {
  return {
    type: "assistant",
    uuid,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name, input: { query: "fixture" } }],
    },
  };
}
/** pi transcript rows: the extension's bridge tools are ordinary `toolCall` blocks (ADR 0054). */
function piRecords(calls: Array<{ name: string; id: string }>): JsonObject[] {
  const rows: JsonObject[] = [];
  let parentId: string | null = null;
  const push = (row: JsonObject) => {
    const id = randomUUID().slice(0, 8);
    rows.push({ ...row, id, parentId });
    parentId = id;
  };
  rows.push({
    type: "session",
    version: 3,
    id: randomUUID(),
    cwd: "/adoption",
  });
  push({
    type: "message",
    message: {
      role: "user",
      content: [
        { type: "text", text: "Find prior work on the adoption view." },
      ],
    },
  });
  for (const call of calls) {
    push({
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: call.id,
            name: call.name,
            arguments: { query: "fixture" },
          },
        ],
      },
    });
    push({
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: "fixture result" }],
        isError: false,
      },
    });
  }
  return rows;
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

// @req R-DASH-18
it("counts real persisted Claude and Codex typed calls, including rejected Codex attempts, without counting results or batch retries", async () => {
  for (const [harness, name, other] of [
    ["CLAUDE_CODE", "claude.jsonl", 2],
    ["CODEX", "codex.jsonl", 1],
    ["CODEX", "codex-failed.jsonl", 1],
  ] as const) {
    const { input, id } = await capture(
      harness,
      await fixture(name),
      `native-${name}`,
    );
    await one(id, 2, 1, other);
    const rows = await messages(org.context, id);
    expect(
      rows.filter(
        (message) =>
          message.kind === "TOOL_USE" &&
          message.tool_name === "mcp__agentcommons__search",
      ),
    ).toHaveLength(2);
    if (name !== "codex-failed.jsonl")
      expect(rows.some((message) => message.kind === "TOOL_RESULT")).toBe(true);
    await publish(org.context, input);
    await publish(org.context, { ...input, batchId: randomUUID() });
    await one(id, 2, 1, other);
  }
});

// @req R-DASH-18
it("deduplicates native call IDs, counts failed attempts and uses source order while ignoring shell text, prose, tool results and unknown identities", async () => {
  const callId = randomUUID();
  const records: JsonObject[] = [
    claudeTool("Grep", "before"),
    {
      type: "user",
      uuid: randomUUID(),
      message: {
        role: "user",
        content: "mcp__agentcommons__search search Grep WebSearch",
      },
    },
    claudeTool("mcp__agentcommons__search", callId),
    claudeTool("mcp__agentcommons__search", callId),
    {
      type: "user",
      uuid: randomUUID(),
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: callId,
            is_error: true,
            content: "Search failed. mcp__agentcommons__search Grep",
          },
        ],
      },
    },
    claudeTool("Glob", "after-glob"),
    claudeTool("mcp__agentcommons__search", "second"),
    {
      type: "assistant",
      uuid: randomUUID(),
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "shell",
            name: "Bash",
            input: {
              command: "rg needle .; curl /mcp; echo mcp__agentcommons__search",
            },
          },
        ],
      },
    },
    claudeTool("search", "bare"),
    claudeTool("mcp__different_server__search", "foreign-tool"),
    claudeTool("WebSearch", "after-web"),
  ];
  const input = envelope("CLAUDE_CODE", records, "source-order");
  input.records = input.records.map((record, index) => ({
    ...record,
    line: JSON.stringify({
      ...jsonObjectSchema.parse(JSON.parse(record.line)),
      timestamp: new Date(
        week.getTime() + (records.length - index) * 1000,
      ).toISOString(),
    }),
  }));
  const result = await publish(org.context, input);
  await one(result.result.sessionId, 2, 1, 2);
  expect(
    (await messages(org.context, result.result.sessionId)).filter(
      (row) => row.kind === "TOOL_RESULT",
    ).length,
  ).toBe(1);
});

// @req R-DASH-18 @req R-MCP-08
it("counts pi bridge searches (agentcommons_search) like the MCP-native identities", async () => {
  const result = await publish(
    org.context,
    envelope(
      "PI",
      piRecords([
        { name: "agentcommons_search", id: "bridge-1" },
        { name: "agentcommons_search", id: "bridge-2" },
        { name: "grep", id: "native-grep" },
        { name: "search", id: "unqualified" },
      ]),
      "pi-bridge",
    ),
  );
  await one(result.result.sessionId, 2, 1, 1);
  expect(
    (await messages(org.context, result.result.sessionId))
      .filter((row) => row.kind === "TOOL_USE")
      .map((row) => row.tool_name),
  ).toEqual(["agentcommons_search", "agentcommons_search", "grep", "search"]);
});

// @req R-DASH-18
it("replaces rewritten Gemini document observations instead of accumulating old search calls", async () => {
  const records = await fixture("gemini.json");
  const full = envelope("GEMINI_CLI", records, "gemini-rewrite");
  const initial = { ...full, records: full.records.slice(0, 2) };
  const response = await publish(org.context, initial);
  await one(response.result.sessionId, 1, 0, 0);
  await publish(org.context, {
    ...full,
    batchId: randomUUID(),
    records: full.records.map((record) => ({
      ...record,
      key: `${z.string().parse(record.key)}:1`,
      sourceVersion: 1,
    })),
  });
  await one(response.result.sessionId, 2, 1, 2);
  // A later document version removes the second message's tools; the old projection must disappear.
  const withoutTools = full.records.map((record) => ({
    ...record,
    key: `${z.string().parse(record.key)}:2`,
    sourceVersion: 2,
    line: JSON.stringify({
      ...jsonObjectSchema.parse(JSON.parse(record.line)),
      ...(record.pos === 2 ? { toolCalls: [] } : {}),
    }),
  }));
  await publish(org.context, {
    ...full,
    batchId: randomUUID(),
    records: withoutTools,
  });
  await one(response.result.sessionId, 1, 0, 0);
  await publish(org.context, { ...full, batchId: randomUUID() });
  await one(response.result.sessionId, 1, 0, 0);
});

// @req R-DASH-18
it("uses distinct projected message identities when an invocation has no native call ID", async () => {
  const records: JsonObject[] = [0, 1].map(() => ({
    type: "assistant",
    uuid: randomUUID(),
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          name: "mcp__agentcommons__search",
          input: { query: "fixture" },
        },
      ],
    },
  }));
  const { input, id } = await capture(
    "CLAUDE_CODE",
    records,
    "missing-call-id",
  );
  await one(id, 2, 1, 0);
  await publish(org.context, { ...input, batchId: randomUUID() });
  await one(id, 2, 1, 0);
});

// @req R-DASH-18
it("uses pi's current projected branch and never invents AgentCommons usage from ordinary grep/find calls", async () => {
  const records = await fixture("pi.jsonl");
  const { input, id } = await capture("PI", records, "pi-branch");
  await one(id, 0, 0, 0);
  expect(
    (await messages(org.context, id)).filter((row) => row.kind === "TOOL_USE")
      .length,
  ).toBe(2);
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
  await one(id, 0, 0, 0);
  const finalLeaf = z.string().parse(records.at(-1)?.id);
  await publish(org.context, {
    ...input,
    batchId: randomUUID(),
    records: [],
    sentAt: new Date(Date.parse(input.sentAt) + 2000).toISOString(),
    context: { ...input.context, activeLeafId: finalLeaf },
  });
  expect(
    (await messages(org.context, id)).filter((row) => row.kind === "TOOL_USE")
      .length,
  ).toBe(2);
  await one(id, 0, 0, 0);
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
  await capture("CLAUDE_CODE", native, "window", org.context, new Date(dateTo));
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
    ["subsequent_other_search_calls", 4],
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
            name: "mcp__agentcommons__search",
            input: { query: "prior implementation" },
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
  await capture("CLAUDE_CODE", searching, "metrics-alpha", fresh.context);
  await capture("CLAUDE_CODE", plain, "metrics-beta", freshMember.context);
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
  ).toHaveLength(5);
  await expect(
    metrics.get(org.owner, "usage", {
      ...input,
      cursor: z.string().parse(firstCursor),
      filters: { ...input.filters, repo_name: "different" },
    }),
  ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
});

// @req R-DASH-18
it("classifies the redacted native projection without recovering tool identities hidden by organization policy", async () => {
  const scoped = await provisionOrganization(db, "adoption-redacted-tools");
  await new PolicyService({
    ...db,
    cache: db.policies,
    cursors: new CursorCodec("adoption-redaction"),
  }).save(scoped.owner, null, {
    name: "hide-search-identity",
    kind: "REGEX",
    flags: "g",
    enabled: true,
    pattern: "mcp__agentcommons__search",
  });
  const accepted = await capture(
    "CLAUDE_CODE",
    await fixture("claude.jsonl"),
    "redacted-tools",
    scoped.context,
  );
  expect(await counts(scoped.context, [accepted.id])).toEqual([
    {
      session_id: accepted.id,
      agentcommons_search_calls: 0,
      repeat_agentcommons_search_calls: 0,
      subsequent_other_search_calls: 0,
    },
  ]);
  const tools = (await messages(scoped.context, accepted.id)).filter(
    (row) => row.kind === "TOOL_USE",
  );
  expect(tools.map((message) => message.tool_name)).toEqual([
    "[REDACTED:hide-search-identity]",
    "[REDACTED:hide-search-identity]",
    "Grep",
    "WebSearch",
  ]);
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
