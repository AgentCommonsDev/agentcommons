import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { createApp } from "../src/app.js";
import { createRuntime } from "../src/main.js";
import { environment } from "../src/env.js";
import { keyInstallation } from "../src/auth/installation.js";
import {
  startDatabase,
  provisionOrganization,
  provisionMember,
  testAuthConfiguration,
} from "./support.js";

let db: Awaited<ReturnType<typeof startDatabase>>;
let runtime: Awaited<ReturnType<typeof createRuntime>>;
let app: Awaited<ReturnType<typeof createApp>>;
let owner: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let member: Awaited<ReturnType<typeof provisionMember>>;
let address: string;
const clients: Client[] = [];
const shutdown: Array<() => Promise<unknown>> = [];
const headers = (key: string) => ({ authorization: `Bearer ${key}` });
function envelope(installationId: string) {
  return {
    envelopeVersion: 2,
    harness: "CLAUDE_CODE",
    harnessSessionId: randomUUID(),
    behavior: "sync",
    nativeEvent: "Stop",
    batchId: randomUUID(),
    installationId,
    sentAt: "2026-01-01T00:00:00.000Z",
    sourcePos: 0,
    context: {
      cwd: "/rollout",
      installation: {
        hostname: "rollout-device",
        osUser: "developer",
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
        key: "rollout-message",
        line: JSON.stringify({
          type: "user",
          uuid: "rollout-message",
          message: {
            content: [{ type: "text", text: "Installation rollout evidence" }],
          },
        }),
      },
    ],
    cursor: "1",
    end: null,
  };
}
async function ingest(key: string, installationId: string) {
  const body = envelope(installationId);
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/ingest",
    headers: headers(key),
    payload: body,
  });
  expect(response.statusCode, response.body).toBe(202);
  return body;
}
async function search(key: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/search",
    headers: headers(key),
    payload: { query: "rollout" },
  });
  expect(response.statusCode, response.body).toBe(200);
}
async function client(key: string) {
  const value = new Client({ name: "installation-rollout", version: "1" });
  clients.push(value);
  await value.connect(
    new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
      requestInit: { headers: headers(key) },
    }) as Transport,
  );
  return value;
}
beforeAll(async () => {
  db = await startDatabase();
  shutdown.push(() => db.close());
  owner = await provisionOrganization(db, "rollout-primary");
  other = await provisionOrganization(db, "rollout-other");
  member = await provisionMember(db, owner.owner, "rollout-member@example.com");
  const env = environment({
    PUBLIC_URL: testAuthConfiguration.publicUrl,
    DATABASE_URL: db.urls.app,
    DATABASE_READER_USER_URL: db.urls.user,
    DATABASE_READER_ADMIN_URL: db.urls.admin,
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    LOG_LEVEL: "silent",
    TRUST_PROXY: "loopback",
    EMBEDDINGS_ENABLED: "false",
  });
  runtime = await createRuntime(env);
  shutdown.push(() => runtime.close());
  app = await createApp({ env, services: runtime.services, static: false });
  shutdown.push(() => app.close());
  address = await app.listen({ host: "127.0.0.1", port: 0 });
});
afterAll(async () => {
  const errors = await cleanupAll([
    ...clients.map((value) => () => value.close()),
    ...shutdown.splice(0).reverse(),
  ]);
  if (errors.length)
    throw new AggregateError(errors, "Rollout test cleanup failed.");
});

// @req R-AUD-04
it("attributes audit to the latest accepted key/org receipt, including the first ingest transaction", async () => {
  const key = await db.auth.createKey(owner.owner, {
    name: "Attribution key",
    permissions: { sessions: ["ingest", "read"] },
  });
  const first = randomUUID();
  const latest = randomUUID();
  const unrelated = randomUUID();
  await search(key.result.key);
  const audit = () =>
    db.prisma.auditEvent.findFirstOrThrow({
      where: { apiKeyId: key.result.metadata.id, action: "search" },
      orderBy: [{ ts: "desc" }, { id: "desc" }],
    });
  expect((await audit()).installationId).toBeNull();
  const initial = await ingest(key.result.key, first);
  const initialAudit = await db.prisma.auditEvent.findFirstOrThrow({
    where: { apiKeyId: key.result.metadata.id, action: "ingest" },
    orderBy: { ts: "desc" },
  });
  expect(initialAudit.installationId).toBe(first);
  await ingest(member.key, unrelated);
  await search(key.result.key);
  expect((await audit()).installationId).toBe(first);
  await ingest(key.result.key, latest);
  await search(key.result.key);
  expect((await audit()).installationId).toBe(latest);
  const replay = await app.inject({
    method: "POST",
    url: "/api/v1/ingest",
    headers: headers(key.result.key),
    payload: initial,
  });
  expect(replay.statusCode, replay.body).toBe(202);
  await search(key.result.key);
  expect((await audit()).installationId).toBe(latest);
  expect(
    await keyInstallation(
      db.prisma,
      other.context.caller?.organizationId,
      key.result.metadata.id,
    ),
  ).toBeNull();
  const cookieSearch = await runtime.services.search.execute(owner.owner, {
    query: "rollout",
  });
  expect(cookieSearch.audit.installationId).toBeNull();
  const listed = await runtime.services.admin.auditLog(owner.owner, {
    filters: { api_key_id: key.result.metadata.id, action: "search" },
  });
  expect(
    z
      .object({
        items: z.array(z.object({ installation_id: z.uuid().nullable() })),
      })
      .parse(listed.result)
      .items.some((item) => item.installation_id === latest),
  ).toBe(true);
});

// @req R-DASH-14 @req R-AUD-04
it("disables current installation keys immediately on cached MCP clients while ingest and unrelated keys continue", async () => {
  const installation = randomUUID();
  await ingest(owner.key, installation);
  await ingest(member.key, installation);
  const ownerClient = await client(owner.key);
  const memberClient = await client(member.key);
  expect(
    (await memberClient.listTools()).tools.map((tool) => tool.name),
  ).toEqual(["search", "get", "sql"]);
  const unassociated = await db.auth.createKey(owner.owner, {
    name: "Unassociated reader",
    permissions: { sessions: ["read"] },
  });
  const reader = await client(unassociated.result.key);
  const reason = `Staged comparison ${"ac_" + "b".repeat(32)}`;
  const toggle = (key: string, id: string, enabled: boolean) =>
    app.inject({
      method: "POST",
      url: `/api/v1/admin/installations/${id}/tools`,
      headers: headers(key),
      payload: { enabled, reason },
    });
  expect((await toggle(member.key, installation, false)).statusCode).toBe(403);
  expect(
    (await toggle(unassociated.result.key, installation, false)).statusCode,
  ).toBe(403);
  const foreign = randomUUID();
  await ingest(other.key, foreign);
  expect((await toggle(owner.key, foreign, false)).statusCode).toBe(404);
  const missingReason = await app.inject({
    method: "POST",
    url: `/api/v1/admin/installations/${installation}/tools`,
    headers: headers(owner.key),
    payload: { enabled: false },
  });
  expect(missingReason.statusCode).toBe(400);
  const disabled = await toggle(owner.key, installation, false);
  expect(disabled.statusCode, disabled.body).toBe(200);
  expect(disabled.json()).toEqual({
    installation_id: installation,
    tools_enabled: false,
  });
  const change = await db.prisma.auditEvent.findFirstOrThrow({
    where: {
      action: "installations.tools",
      statusCode: 200,
      resourceIds: { has: installation },
    },
    orderBy: { ts: "desc" },
  });
  expect(change.detail).toMatchObject({
    enabled: false,
    previous_enabled: true,
  });
  expect(change.detail).toHaveProperty("reason");
  expect(JSON.stringify(change.detail)).not.toContain("ac_" + "b".repeat(32));
  expect((await ownerClient.listTools()).tools).toEqual([]);
  expect((await memberClient.listTools()).tools).toEqual([]);
  expect((await reader.listTools()).tools).toHaveLength(3);
  const count = await db.prisma.auditEvent.count({
    where: {
      apiKeyId: z.string().parse(member.context.caller?.apiKeyId),
      action: "mcp.call",
    },
  });
  const denied = await memberClient.callTool({
    name: "search",
    arguments: { query: "rollout" },
  });
  expect(denied.isError).toBe(true);
  expect(JSON.stringify(denied.content)).toContain(
    "INSTALLATION_TOOLS_DISABLED",
  );
  const rows = await db.prisma.auditEvent.findMany({
    where: {
      apiKeyId: z.string().parse(member.context.caller?.apiKeyId),
      action: "mcp.call",
    },
    orderBy: { ts: "desc" },
  });
  expect(rows).toHaveLength(count + 1);
  expect(rows[0]).toMatchObject({
    installationId: installation,
    statusCode: 403,
  });
  await ingest(member.key, installation);
  expect((await memberClient.listTools()).tools).toEqual([]);
  const listing = await app.inject({
    method: "GET",
    url: "/api/v1/installations",
    headers: headers(owner.key),
  });
  expect(
    z
      .object({
        items: z.array(
          z.object({ installation_id: z.uuid(), tools_enabled: z.boolean() }),
        ),
      })
      .parse(listing.json()).items,
  ).toContainEqual({ installation_id: installation, tools_enabled: false });
  // The same UUID in another organization is a separate installation and rollout cohort.
  await ingest(other.key, installation);
  expect((await (await client(other.key)).listTools()).tools).toHaveLength(7);
  expect(
    (
      await keyInstallation(
        db.prisma,
        other.context.caller?.organizationId,
        other.context.caller?.apiKeyId,
      )
    )?.toolsEnabled,
  ).toBe(true);
  const moved = randomUUID();
  await ingest(member.key, moved);
  expect((await memberClient.listTools()).tools).toHaveLength(3);
  expect(
    (
      await memberClient.callTool({
        name: "search",
        arguments: { query: "rollout" },
      })
    ).isError,
  ).not.toBe(true);
  const enabled = await app.inject({
    method: "POST",
    url: `/api/v1/admin/installations/${installation}/tools`,
    headers: {
      cookie: z.string().parse(owner.owner.headers.get("cookie")),
      origin: testAuthConfiguration.publicUrl,
    },
    payload: { enabled: true, reason: "Finish staged comparison" },
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
  expect((await ownerClient.listTools()).tools).toHaveLength(7);
});

// @req R-DASH-14
it("rolls back a rollout change if its mutation audit cannot be written", async () => {
  const installation = randomUUID();
  await ingest(owner.key, installation);
  const write = vi
    .spyOn(runtime.services.audit, "write")
    .mockRejectedValueOnce(new Error("Injected audit failure"));
  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/installations/${installation}/tools`,
      headers: headers(owner.key),
      payload: { enabled: false, reason: "Verify transactional rollout audit" },
    });
    expect(response.statusCode).toBe(500);
  } finally {
    write.mockRestore();
  }
  const current = await db.prisma.installation.findUniqueOrThrow({
    where: {
      organizationId_id: {
        organizationId: z.string().parse(owner.context.caller?.organizationId),
        id: installation,
      },
    },
  });
  expect(current.toolsEnabled).toBe(true);
});

it("normalizes typed audit detail before redaction, retains bounds, and rejects storage failure", async () => {
  const secret = "ac_" + "b".repeat(32);
  const at = new Date("2026-01-01T00:00:00.000Z");
  const result = await db.audit.write(owner.context, {
    action: "audit.normalization",
    detail: { nested: { omitted: undefined, at, count: 123n, text: secret } },
  });
  const stored = await db.prisma.auditEvent.findUniqueOrThrow({
    where: { id: result.id },
  });
  expect(stored.detail).toMatchObject({
    nested: { at: at.toISOString(), count: "123" },
  });
  expect(JSON.stringify(stored.detail)).not.toContain(secret);
  expect(stored.detail).not.toHaveProperty("nested.omitted");
  const bounded = await db.audit.write(owner.context, {
    action: "audit.bounded",
    detail: { large: `${secret} ${"long".repeat(5000)}` },
  });
  expect(Buffer.byteLength(JSON.stringify(bounded.detail))).toBeLessThanOrEqual(
    8192,
  );
  expect(JSON.stringify(bounded.detail)).not.toContain(secret);
  const storage = vi
    .spyOn(db.prisma.auditEvent, "create")
    .mockRejectedValueOnce(new Error("Injected audit storage failure"));
  try {
    await expect(
      db.audit.write(owner.context, {
        action: "audit.storage-failure",
        detail: { optional: undefined },
      }),
    ).rejects.toThrow("Injected audit storage failure");
  } finally {
    storage.mockRestore();
  }
});

it("rejects audit attribution to another organization's installation at the database boundary", async () => {
  const installation = randomUUID();
  await ingest(owner.key, installation);
  await expect(db.prisma.$executeRaw`
    INSERT INTO audit_event(id,organization_id,installation_id,request_id,auth_method,ip,transport,action,status_code,duration_ms,detail)
    VALUES(${randomUUID()}::uuid,${z.string().parse(other.context.caller?.organizationId)},${installation}::uuid,'foreign-installation','key','127.0.0.1','rest','audit.foreign',200,0,'{}'::jsonb)
  `).rejects.toThrow(/foreign key constraint/);
});

it("sorts and filters installation rollout rows on the server and bounds oversized metadata", async () => {
  const organizationId = z.string().parse(owner.context.caller?.organizationId);
  const prefix = `catalog-${randomUUID()}`;
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) {
    await ingest(owner.key, id);
    await db.prisma.installation.update({
      where: { organizationId_id: { organizationId, id } },
      data: {
        hostname: `${prefix}-${index === 2 ? "界".repeat(200_000) : String(index)}`,
        toolsEnabled: index !== 2,
        lastSeenAt: new Date(Date.UTC(2026, 0, index + 1)),
      },
    });
  }
  const input = {
    filters: { hostname: prefix, tools_enabled: true },
    sort: "last_seen_at",
    order: "asc",
    limit: 1,
  };
  const first = await runtime.services.sessions.installations(
    owner.context,
    input,
  );
  expect(first.result.items.map((row) => row.installation_id)).toEqual([
    ids[0],
  ]);
  const second = await runtime.services.sessions.installations(owner.context, {
    ...input,
    cursor: first.result.cursor,
  });
  expect(second.result.items.map((row) => row.installation_id)).toEqual([
    ids[1],
  ]);
  expect(second.result.cursor).toBeNull();
  await expect(
    runtime.services.sessions.installations(owner.context, {
      ...input,
      order: "desc",
      cursor: first.result.cursor,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  const query = new URLSearchParams({
    filters: JSON.stringify({ hostname: prefix }),
    sort: "tools_enabled",
    order: "asc",
    limit: "1",
  });
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/installations?${query.toString()}`,
    headers: headers(owner.key),
  });
  expect(response.statusCode, response.body).toBe(200);
  const row = z
    .object({
      items: z.array(
        z.object({
          installation_id: z.uuid(),
          hostname: z.string(),
          truncated_fields: z.array(z.string()),
        }),
      ),
    })
    .parse(response.json()).items[0];
  expect(row?.installation_id).toBe(ids[2]);
  expect(row?.truncated_fields).toContain("hostname");
  expect(Buffer.byteLength(row?.hostname ?? "")).toBeLessThanOrEqual(256);
  expect(
    (await runtime.services.sessions.installations(other.context, input)).result
      .items,
  ).toEqual([]);
  expect(
    (
      await runtime.services.sessions.installations(owner.context, {
        filters: { hostname: `${prefix}%` },
      })
    ).result.items,
  ).toEqual([]);
});

// @req R-GET-04 @req R-DASH-17
it("exposes distinct visible reuse counts and pages both directions from real attributed get audits", async () => {
  const org = z.string().parse(owner.context.caller?.organizationId);
  const recorded = async (key: string) => {
    const body = await ingest(key, randomUUID());
    return (
      await db.prisma.ingestBatch.findUniqueOrThrow({
        where: { organizationId_id: { organizationId: org, id: body.batchId } },
      })
    ).sessionId;
  };
  const target = await recorded(owner.key);
  const secondTarget = await recorded(owner.key);
  const firstReader = await recorded(member.key);
  const mcp = await client(member.key);
  const get = async (id: string) => {
    const result = await mcp.callTool({
      name: "get",
      arguments: { session_id: id },
    });
    expect(result.isError).not.toBe(true);
  };
  await get(target);
  await get(target);
  await get(secondTarget);
  const secondReader = await recorded(member.key);
  await get(target);
  const count = async (context = owner.owner) =>
    (await runtime.services.sessions.get(context, { session_id: target }))
      .result.header.reuse_count;
  expect(await count()).toBe(2);
  const from = await runtime.services.sessions.reuse(
    member.context,
    firstReader,
    { direction: "from" },
  );
  expect(
    new Set(from.result.items.map((edge) => edge.target_session_id)),
  ).toEqual(new Set([target, secondTarget]));
  expect(
    from.result.items.every(
      (edge) =>
        edge.source_session_id === firstReader &&
        edge.reader_user_id === member.context.caller?.userId &&
        edge.reader_email === member.email &&
        edge.reader_harness === "CLAUDE_CODE",
    ),
  ).toBe(true);
  await db.prisma.agentSession.update({
    where: { id: firstReader },
    data: { title: "界".repeat(2000) },
  });
  const first = await runtime.services.sessions.reuse(member.context, target, {
    direction: "by",
    limit: 1,
  });
  expect(first.result.items).toHaveLength(1);
  expect(first.result.cursor).not.toBeNull();
  const thirdReader = await recorded(member.key);
  await get(target);
  const second = await runtime.services.sessions.reuse(member.context, target, {
    direction: "by",
    limit: 1,
    cursor: first.result.cursor,
  });
  expect(second.result.items).toHaveLength(1);
  expect(second.result.cursor).toBeNull();
  expect(
    new Set(
      [...first.result.items, ...second.result.items].map(
        (edge) => edge.source_session_id,
      ),
    ),
  ).toEqual(new Set([firstReader, secondReader]));
  const shortened = [...first.result.items, ...second.result.items].find(
    (edge) => edge.source_session_id === firstReader,
  );
  expect(shortened?.truncated_fields).toContain("source_title");
  expect(Buffer.byteLength(shortened?.source_title ?? "")).toBeLessThanOrEqual(
    256,
  );
  expect(await count()).toBe(3);
  const listing = await app.inject({
    method: "GET",
    url: "/api/v1/sessions?sort=reuse_count&order=desc&limit=1",
    headers: headers(owner.key),
  });
  expect(listing.statusCode, listing.body).toBe(200);
  expect(
    z
      .object({
        items: z.array(
          z.object({ session_id: z.uuid(), reuse_count: z.number() }),
        ),
      })
      .parse(listing.json()).items,
  ).toEqual([{ session_id: target, reuse_count: 3 }]);
  const endpoint = await app.inject({
    method: "GET",
    url: `/api/v1/sessions/${target}/reuse?direction=by&limit=1`,
    headers: headers(member.key),
  });
  expect(endpoint.statusCode, endpoint.body).toBe(200);
  await expect(
    runtime.services.sessions.reuse(member.context, target, {
      direction: "from",
      limit: 1,
      cursor: first.result.cursor,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  await expect(
    runtime.services.sessions.reuse(other.context, target, {
      direction: "by",
      limit: 1,
      cursor: first.result.cursor,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  await expect(
    runtime.services.sessions.reuse(other.context, target, {}),
  ).rejects.toMatchObject({ statusCode: 404 });
  await db.prisma.agentSession.updateMany({
    where: { id: { in: [firstReader, thirdReader] } },
    data: { title: "界".repeat(200_000) },
  });
  await db.prisma.agentSession.update({
    where: { id: secondReader },
    data: { title: null },
  });
  const sortedInput = {
    direction: "by",
    sort: "source_title",
    order: "asc",
    limit: 1,
  };
  const sorted = await runtime.services.sessions.reuse(
    member.context,
    target,
    sortedInput,
  );
  const tied = [firstReader, thirdReader].sort();
  expect(sorted.result.items[0]?.source_session_id).toBe(tied[0]);
  expect(Buffer.byteLength(sorted.result.cursor ?? "")).toBeLessThan(4096);
  const anchor = z.string().parse(sorted.result.items[0]?.source_session_id);
  await runtime.services.admin.setVisibility(owner.owner, {
    session_id: anchor,
    visibility: "PRIVATE",
    reason: "Hide the paging anchor",
  });
  const afterHidden = await runtime.services.sessions.reuse(
    member.context,
    target,
    { ...sortedInput, cursor: sorted.result.cursor },
  );
  expect(afterHidden.result.items[0]?.source_session_id).toBe(tied[1]);
  const nullPage = await runtime.services.sessions.reuse(
    member.context,
    target,
    { ...sortedInput, cursor: afterHidden.result.cursor },
  );
  expect(nullPage.result.items[0]?.source_session_id).toBe(secondReader);
  expect(nullPage.result.items[0]?.source_title).toBeNull();
  expect(nullPage.result.cursor).toBeNull();
  await runtime.services.admin.setVisibility(owner.owner, {
    session_id: anchor,
    visibility: "PUBLIC",
    reason: "Restore the paging fixture",
  });
  const descending = await runtime.services.sessions.reuse(
    member.context,
    target,
    { ...sortedInput, order: "desc", limit: 10 },
  );
  expect(descending.result.items.map((edge) => edge.source_session_id)).toEqual(
    [...tied, secondReader],
  );
  expect(
    (
      await runtime.services.sessions.reuse(member.context, target, {
        reader_user_id: owner.context.caller?.userId,
      })
    ).result.items,
  ).toEqual([]);
  await expect(
    runtime.services.sessions.reuse(member.context, target, {
      ...sortedInput,
      order: "desc",
      cursor: sorted.result.cursor,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  await runtime.services.admin.setVisibility(owner.owner, {
    session_id: secondReader,
    visibility: "PRIVATE",
    reason: "Verify reuse visibility",
  });
  expect(
    (
      await runtime.services.sessions.reuse(member.context, target, {})
    ).result.items
      .map((edge) => edge.source_session_id)
      .sort(),
  ).toEqual([firstReader, thirdReader].sort());
  expect(await count(member.owner)).toBe(2);
  expect(await count()).toBe(3);
  await runtime.services.admin.purge(owner.owner, {
    session_id: firstReader,
    reason: "Verify reuse tombstones",
  });
  expect(await count(member.owner)).toBe(1);
  expect(await count()).toBe(2);
});
