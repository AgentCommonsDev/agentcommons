import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  homeOutputSchema,
  homeSummarySchema,
  ingestOutputSchema,
} from "@agentcommons/core";
import {
  startTraceDatabase,
  traceEnvironment,
} from "../../../packages/traces/test/support.js";
import { TraceProjectionService } from "../src/services/trace-projection.js";
import { TraceAuditProjectionService } from "../src/services/trace-audit-projection.js";
import { createRuntime } from "../src/main.js";
import { createApp } from "../src/app.js";
import { environment } from "../src/env.js";
import { requireCaller } from "../src/services/context.js";
import {
  provisionOrganization,
  provisionMember,
  testAuthConfiguration,
} from "./support.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let runtime: Awaited<ReturnType<typeof createRuntime>>;
let app: Awaited<ReturnType<typeof createApp>>;
let owner: Awaited<ReturnType<typeof provisionOrganization>>;
let member: Awaited<ReturnType<typeof provisionMember>>;
let foreign: Awaited<ReturnType<typeof provisionOrganization>>;
let projection: TraceProjectionService;
let auditProjection: TraceAuditProjectionService;
let target: string;
let second: string;
let source: string;
const auth = (key: string) => ({ authorization: `Bearer ${key}` });
const cleanup: Array<() => Promise<unknown>> = [];

async function capture(key: string, title: string, repo = "shared") {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/ingest",
    headers: auth(key),
    payload: {
      envelopeVersion: 2,
      harness: "CLAUDE_CODE",
      harnessSessionId: randomUUID(),
      behavior: "start",
      nativeEvent: "SessionStart",
      start: { resume: false },
      batchId: randomUUID(),
      installationId: randomUUID(),
      sentAt: new Date().toISOString(),
      sourcePos: 0,
      context: {
        cwd: "/home-fixture",
        installation: {
          hostname: "home-fixture",
          osUser: "developer",
          platform: "linux",
          arch: "x64",
        },
        git: {
          root: "/home-fixture",
          remoteUrl: `https://github.com/fixture/${repo}.git`,
          branch: "main",
          head: "abc123",
        },
        parentHint: null,
      },
      records: [
        {
          pos: 0,
          key: randomUUID(),
          line: JSON.stringify({
            type: "user",
            message: { role: "user", content: title },
          }),
        },
      ],
      cursor: "1",
      end: null,
    },
  });
  expect(response.statusCode, response.body).toBe(202);
  const sessionId = ingestOutputSchema.parse(response.json()).sessionId;
  const organizationId = (
    await db.prisma.traceSessionControl.findFirstOrThrow({
      where: { id: sessionId },
    })
  ).organizationId;
  await projection.process(organizationId, sessionId);
  return sessionId;
}
async function get(key: string, id: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/sessions/${id}`,
    headers: auth(key),
  });
  expect(response.statusCode, response.body).toBe(200);
  while (await auditProjection.flush()) {
    /* Drain committed native read evidence. */
  }
}
async function search(key: string, query: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/search",
    headers: auth(key),
    payload: { query },
  });
  expect(response.statusCode, response.body).toBe(200);
  while (await auditProjection.flush()) {
    /* Drain committed native read evidence. */
  }
}
async function page(key: string, section: string, query = "") {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/home/${section}${query}`,
    headers: auth(key),
  });
  expect(response.statusCode, response.body).toBe(200);
  return homeOutputSchema.parse(response.json());
}
beforeAll(async () => {
  db = await startTraceDatabase();
  cleanup.push(() => db.close());
  owner = await provisionOrganization(db, "home-primary");
  member = await provisionMember(db, owner.owner, "home-member@example.com");
  foreign = await provisionOrganization(db, "home-foreign");
  runtime = await createRuntime(
    environment({
      ...traceEnvironment(db.traceConfig),
      PUBLIC_URL: testAuthConfiguration.publicUrl,
      DATABASE_URL: db.urls.app,
      BETTER_AUTH_SECRET: testAuthConfiguration.secret,
      LOG_LEVEL: "silent",
      EMBEDDINGS_ENABLED: "false",
    }),
  );
  cleanup.unshift(() => runtime.close());
  projection = new TraceProjectionService({
    prisma: db.prisma,
    audit: runtime.services.audit,
    repository: db.traces,
  });
  auditProjection = new TraceAuditProjectionService({
    prisma: db.prisma,
    audit: runtime.services.audit,
    traces: db.traces,
  });
  app = await createApp({
    static: false,
    env: environment({
      ...traceEnvironment(db.traceConfig),
      PUBLIC_URL: testAuthConfiguration.publicUrl,
      DATABASE_URL: db.urls.app,
      BETTER_AUTH_SECRET: testAuthConfiguration.secret,
      LOG_LEVEL: "silent",
    }),
    services: runtime.services,
  });
  cleanup.unshift(() => app.close());
  target = await capture(owner.key, "Previous queue investigation");
  second = await capture(owner.key, "Previous database investigation");
  await capture(owner.key, "Unexplored archive", "gap-alpha");
  await capture(owner.key, "Unexplored store", "gap-beta");
  source = await capture(member.key, "Current implementation");
  await get(member.key, target);
  await get(member.key, target);
  await get(member.key, second);
  await search(member.key, "missingmemberfrobnicator");
  await search(owner.key, "missingownerfrobnicator");
  await search(foreign.key, "missingforeignfrobnicator");
});
afterAll(async () => {
  vi.restoreAllMocks();
  expect(await cleanupAll(cleanup.splice(0))).toEqual([]);
});

// @req R-DASH-16 @req R-ORG-07 @req R-ORG-09
it("serves every member eight weekly reuse rates, their impact, and bounded visible reuse feeds from real key reads", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/home",
    headers: auth(member.key),
  });
  expect(response.statusCode, response.body).toBe(200);
  const summary = homeSummarySchema.parse(response.json());
  expect(summary.weekly).toHaveLength(8);
  expect(summary.weekly.at(-1)).toMatchObject({
    sessions: 5,
    reuse_sessions: 1,
    cross_user_reuse_sessions: 1,
    reuse_rate: 0.2,
    cross_user_reuse_rate: 0.2,
  });
  expect(summary.impact).toMatchObject({
    sessions_reused_by_others: 0,
    reuses_made: 2,
  });
  const ownerSummary = await runtime.services.home.summary(owner.owner);
  expect(ownerSummary.result.impact).toMatchObject({
    sessions_reused_by_others: 2,
    distinct_readers: 1,
  });
  const feed = await page(member.key, "reused", "?limit=1");
  expect(feed.items).toHaveLength(1);
  expect(feed.cursor).toBeTruthy();
  const next = await page(
    member.key,
    "reused",
    `?limit=1&cursor=${encodeURIComponent(feed.cursor ?? "")}`,
  );
  expect(next.items).toHaveLength(1);
  expect(next.cursor).toBeNull();
  expect(
    new Set(
      [...feed.items, ...next.items].flatMap((row) =>
        "target_session_id" in row ? [row.target_session_id] : [],
      ),
    ),
  ).toEqual(new Set([target, second]));
  expect([...feed.items, ...next.items]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source_session_id: source,
        reader_email: member.email,
      }),
    ]),
  );
  expect((await page(member.key, "outbound")).items).toHaveLength(2);
  expect((await page(member.key, "inbound")).items).toHaveLength(0);
  expect((await page(owner.key, "inbound")).items).toHaveLength(2);
  expect(
    (
      await page(
        member.key,
        "reused",
        `?reader_user_id=${encodeURIComponent(requireCaller(member.context).userId)}`,
      )
    ).items,
  ).toHaveLength(2);
  expect(
    (await page(member.key, "reused", "?reader_user_id=absent-reader")).items,
  ).toEqual([]);
  const other = await app.inject({
    method: "GET",
    url: `/api/v1/home/reused?limit=1&cursor=${encodeURIComponent(feed.cursor ?? "")}`,
    headers: auth(foreign.key),
  });
  expect(other.statusCode).toBe(400);
  const wrongSection = await app.inject({
    method: "GET",
    url: `/api/v1/home/outbound?limit=1&cursor=${encodeURIComponent(feed.cursor ?? "")}`,
    headers: auth(member.key),
  });
  expect(wrongSection.statusCode).toBe(400);
});

// @req R-DASH-16 @req R-AUD-01
it("shows gaps and only the author's redacted zero-result searches, including through pooled SQL connections", async () => {
  expect(
    (await page(member.key, "gap_repos", "?sort=repo_name&order=asc")).items,
  ).toEqual([
    {
      repo_name: "github.com/fixture/gap-alpha",
      sessions: 1,
      truncated_fields: [],
    },
    {
      repo_name: "github.com/fixture/gap-beta",
      sessions: 1,
      truncated_fields: [],
    },
  ]);
  const own = await page(member.key, "zero_results");
  expect(
    (await page(member.key, "gap_repos", "?query=GAP-BETA")).items,
  ).toEqual([
    expect.objectContaining({ repo_name: "github.com/fixture/gap-beta" }),
  ]);
  expect((await page(member.key, "gap_repos", "?query=%25")).items).toEqual([]);
  expect(
    (await page(member.key, "zero_results", "?query=missingowner")).items,
  ).toEqual([]);
  expect(own.items).toEqual([
    expect.objectContaining({ query: "missingmemberfrobnicator" }),
  ]);
  expect((await page(owner.key, "zero_results")).items).toEqual([
    expect.objectContaining({ query: "missingownerfrobnicator" }),
  ]);
  for (const context of [member.context, foreign.context, member.context]) {
    const result = await runtime.services.query.execute(context, {
      sql: "SELECT query FROM metrics_own_zero_results",
    });
    expect(JSON.stringify(result.result)).toContain(
      context === foreign.context
        ? "missingforeignfrobnicator"
        : "missingmemberfrobnicator",
    );
    expect(JSON.stringify(result.result)).not.toContain(
      "missingownerfrobnicator",
    );
  }
  const caller = requireCaller(member.context);
  await expect(
    db.traceReaders.read(
      {
        organizationId: caller.organizationId,
        role: caller.role,
        permissions: caller.permissions,
        authMethod: caller.authMethod,
      },
      (client) => client.query("SELECT * FROM api_ro.metrics_own_zero_results"),
    ),
  ).rejects.toThrow("Trace readers require an authenticated issuing user.");
  await expect(
    runtime.services.query.execute(member.context, {
      sql: "SELECT set_config('agentcommons.user_id','someone-else',true)",
    }),
  ).rejects.toThrow();
  const csv = await app.inject({
    method: "GET",
    url: "/api/v1/home/gap_repos?format=csv",
    headers: auth(member.key),
  });
  expect(csv.statusCode).toBe(200);
  expect(csv.headers["content-type"]).toContain("text/csv");
  expect(csv.body).toContain("gap-alpha");
  const invalid = await app.inject({
    method: "GET",
    url: "/api/v1/home/gap_repos?sort=query",
    headers: auth(member.key),
  });
  expect(invalid.statusCode).toBe(400);
  const failure = vi
    .spyOn(runtime.services.audit, "write")
    .mockRejectedValue(new Error("audit offline"));
  await expect(runtime.services.home.summary(member.owner)).rejects.toThrow(
    "audit offline",
  );
  failure.mockRestore();
});

// @req R-DASH-16 @req R-ORG-09
it("keeps reuse pagination stable when its last row becomes private", async () => {
  const first = await capture(owner.key, "Keyset Alpha");
  const next = await capture(owner.key, "Keyset Beta");
  await get(member.key, first);
  await get(member.key, next);
  const initial = await page(
    member.key,
    "reused",
    "?limit=1&sort=target_title&order=asc",
  );
  expect(initial.items).toEqual([
    expect.objectContaining({ target_session_id: first }),
  ]);
  await runtime.services.admin.setVisibility(owner.owner, {
    session_id: first,
    visibility: "PRIVATE",
    reason: "Cursor anchor removal",
  });
  const continued = await page(
    member.key,
    "reused",
    `?limit=1&sort=target_title&order=asc&cursor=${encodeURIComponent(initial.cursor ?? "")}`,
  );
  expect(continued.items).toEqual([
    expect.objectContaining({ target_session_id: next }),
  ]);
  for (const id of [first, next])
    await runtime.services.admin.purge(owner.owner, {
      session_id: id,
      reason: "Complete isolated pagination fixture",
    });
});

// @req R-DASH-16
it("bounds large gap metadata and cursors without blocking pagination", async () => {
  await capture(
    owner.key,
    "Large repository boundary",
    `long-${"z".repeat(300_000)}`,
  );
  await search(member.key, "missinghomequery ".repeat(100));
  const gaps = await page(member.key, "gap_repos");
  const large = gaps.items.find(
    (item) =>
      "repo_name" in item && item.truncated_fields.includes("repo_name"),
  );
  expect(large).toBeDefined();
  if (large && "repo_name" in large)
    expect(Buffer.byteLength(large.repo_name)).toBeLessThanOrEqual(256);
  const zero = await page(member.key, "zero_results");
  const query = zero.items.find(
    (item) => "query" in item && item.truncated_fields.includes("query"),
  );
  expect(query).toBeDefined();
  if (query && "query" in query)
    expect(Buffer.byteLength(query.query)).toBeLessThanOrEqual(256);
  let cursor: string | null = null;
  let count = 0;
  do {
    const current = await page(
      member.key,
      "gap_repos",
      `?limit=1&sort=repo_name&order=asc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    count += current.items.length;
    cursor = current.cursor;
    if (cursor) expect(Buffer.byteLength(cursor)).toBeLessThan(4096);
    expect(count).toBeLessThan(10);
  } while (cursor);
  expect(count).toBe(3);
});

// @req R-DASH-16 @req R-ORG-08
it("removes private and purged targets from member reuse counts and feeds immediately", async () => {
  await runtime.services.admin.setVisibility(owner.owner, {
    session_id: target,
    visibility: "PRIVATE",
    reason: "Home visibility regression",
  });
  expect((await page(member.key, "reused")).items).toEqual([
    expect.objectContaining({ target_session_id: second }),
  ]);
  expect((await page(owner.key, "reused")).items).toHaveLength(2);
  await runtime.services.admin.purge(owner.owner, {
    session_id: second,
    reason: "Home purge regression",
  });
  expect((await page(member.key, "reused")).items).toEqual([]);
  expect(
    (await runtime.services.home.summary(member.owner)).result.weekly.at(-1)
      ?.reuse_sessions,
  ).toBe(0);
  expect((await page(foreign.key, "reused")).items).toEqual([]);
});
