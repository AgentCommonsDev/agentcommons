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
  jsonObjectSchema,
  type metricsOutputSchema,
  searchAdoptionMetricNames,
  type Harness,
  type IngestEnvelope,
  type MetricRow,
} from "@agentcommons/core";
type JsonObject = z.infer<typeof jsonObjectSchema>;
import { cleanup } from "../../../scripts/cleanup.js";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceProjectionService } from "../src/services/trace-projection.js";
import { TraceAuditProjectionService } from "../src/services/trace-audit-projection.js";
import { JobService } from "../src/services/jobs.js";
import { IngestService } from "../src/services/ingest.js";
import { HomeService } from "../src/services/home.js";
import { MetricsService } from "../src/services/metrics.js";
import { PolicyService } from "../src/services/policies.js";
import { AdminService } from "../src/services/admin.js";
import { CursorCodec } from "../src/services/cursor.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";
import { provisionOrganization, provisionMember } from "./support.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let org: Awaited<ReturnType<typeof provisionOrganization>>;
let member: Awaited<ReturnType<typeof provisionMember>>;
let foreign: Awaited<ReturnType<typeof provisionOrganization>>;
let ingest: IngestService;
let projection: TraceProjectionService;
const workerErrors: Error[] = [];
let home: HomeService;
let metrics: MetricsService;
let admin: AdminService;
const release: Array<() => Promise<unknown>> = [];
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
  return {
    envelopeVersion: 2,
    harness,
    harnessSessionId: native,
    batchId: randomUUID(),
    installationId: randomUUID(),
    behavior: "sync",
    start: null,
    nativeEvent: "fixture-sync",
    sentAt: new Date().toISOString(),
    sourcePos: records.length,
    cursor: "initial",
    end: null,
    context: {
      cwd: "/adoption",
      installation: {
        hostname: "adoption",
        osUser: "fixture",
        platform: "linux",
        arch: "x64",
      },
      git: {
        root: "/adoption",
        remoteUrl: `https://github.com/adoption/${repo}.git`,
        branch: "main",
        head: "abc123",
      },
      parentHint: null,
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
  };
}
async function publish(context: ServiceContext, input: IngestEnvelope) {
  const result = await ingest.execute(context, input);
  await projection.process(
    requireCaller(context).organizationId,
    result.result.sessionId,
  );
  return result;
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
  release.unshift(() => db.close());
  org = await provisionOrganization(db, "adoption-primary");
  member = await provisionMember(db, org.owner, "adoption-member@example.com");
  foreign = await provisionOrganization(db, "adoption-foreign");
  const dependencies = {
    ...db,
    readers: db.traceReaders,
    cursors: new CursorCodec("adoption-cursor-secret"),
  };
  projection = new TraceProjectionService({
    prisma: db.prisma,
    audit: db.audit,
    repository: db.traces,
  });
  const jobs = new JobService({
    prisma: db.prisma,
    audit: db.audit,
    traces: projection,
    traceAudit: new TraceAuditProjectionService({
      prisma: db.prisma,
      audit: db.audit,
      traces: db.traces,
    }),
    connectionString: db.urls.app,
    auditRetentionDays: 365,
    allowedEmailDomains: [],
    onError: (error) => {
      workerErrors.push(error);
    },
  });
  release.unshift(() => jobs.stop());
  ingest = new IngestService({ ...db, traces: jobs });
  home = new HomeService(dependencies);
  metrics = new MetricsService(dependencies);
  admin = new AdminService({
    ...dependencies,
    jobs,
  });
}, 120_000);
afterAll(async () => {
  expect(await cleanup(release.splice(0))).toEqual([]);
  expect(workerErrors).toEqual([]);
});

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

// @req R-DASH-18
it("shares exact caller-visible adoption with every member's Home and admin Usage, preserving private/purge/org scope, dates, repo filters and null denominators", async () => {
  const before = (await home.summary(member.owner)).result.search_adoption;
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
  const after = (await home.summary(member.owner)).result.search_adoption;
  expect(after).toEqual({
    sessions: before.sessions + 2,
    agentcommons_search_sessions: before.agentcommons_search_sessions + 1,
    agentcommons_search_rate:
      (before.agentcommons_search_sessions + 1) / (before.sessions + 2),
    agentcommons_search_calls: before.agentcommons_search_calls + 2,
    repeat_agentcommons_search_calls:
      before.repeat_agentcommons_search_calls + 1,
    subsequent_other_search_calls: before.subsequent_other_search_calls + 2,
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
  expect((await home.summary(empty.owner)).result.search_adoption).toEqual({
    sessions: 0,
    agentcommons_search_sessions: 0,
    agentcommons_search_rate: null,
    agentcommons_search_calls: 0,
    repeat_agentcommons_search_calls: 0,
    subsequent_other_search_calls: 0,
  });
  await expect(
    metrics.get(member.owner, "usage", {
      filters: { date_from: dateFrom, date_to: dateTo },
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
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
    expect(source.complete).toBe(true);
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
