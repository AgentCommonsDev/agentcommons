import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import {
  startTraceDatabase,
  waitForTracePublication,
} from "../../../packages/traces/test/support.js";
import { requireCaller } from "../src/services/context.js";
import { startApp, type StartedApp, type TraceDatabase } from "./app.js";
import { testEnvelope, textRecord } from "./envelopes.js";
import { injectHeaders, provisionOrganization, releaser } from "./support.js";

/**
 * Every path and method the generated OpenAPI document advertises is called against the real
 * runtime as an organization admin (cookie), as an API key and anonymously. A route may reject
 * the call (400 for an empty body, 401/403 for a missing right, 404 for an unknown id) but a
 * 5xx means the route itself is broken; the sweep catches wiring and startup regressions that
 * per-feature tests miss because they only visit the routes they need.
 */
const documentSchema = z.object({
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});
const document = documentSchema.parse(
  JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8")),
);
const resources = releaser();
let database: TraceDatabase;
let started: StartedApp;
let admin: Record<string, string>;
let key: Record<string, string>;
let sessionId: string;
let dashboardId: string;

beforeAll(async () => {
  database = await startTraceDatabase();
  resources.defer(() => database.close());
  const organization = await provisionOrganization(database, "route-sweep");
  started = await startApp(database, undefined, { jobs: true });
  resources.defer(() => started.close());
  admin = injectHeaders(organization.owner);
  key = { authorization: `Bearer ${organization.key}` };
  const ingest = await started.app.inject({
    method: "POST",
    url: "/api/v1/ingest",
    headers: { ...key, "content-type": "application/json" },
    payload: testEnvelope({
      records: [textRecord(0, "route sweep: how do I paginate the audit log?")],
    }),
  });
  expect(ingest.statusCode).toBe(202);
  const organizationId = requireCaller(organization.owner).organizationId;
  const [control] = await database.prisma.traceSessionControl.findMany({
    where: { organizationId },
  });
  if (!control) throw new Error("The ingest did not create a session.");
  sessionId = control.id;
  await waitForTracePublication(database.prisma, [sessionId]);
  const dashboards = await started.app.inject({
    method: "GET",
    url: "/api/v1/dashboards",
    headers: admin,
  });
  expect(dashboards.statusCode).toBe(200);
  const listed = z
    .object({ items: z.array(z.object({ id: z.string() })).min(1) })
    .parse(dashboards.json());
  dashboardId = listed.items[0]?.id ?? "";
}, 180_000);
afterAll(() => resources.release());

function concrete(path: string): string {
  return path
    .replace("/sessions/{id}", `/sessions/${sessionId}`)
    .replace("/dashboards/{id}", `/dashboards/${dashboardId}`)
    .replace("/metrics/{group}", "/metrics/reuse")
    .replaceAll("{id}", randomUUID());
}
const skipped = new Set([
  // Server-sent events never end; the SSE contract has its own test.
  "get /api/v1/sessions/{id}/events",
]);
const variants: Array<[string, () => Record<string, string>]> = [
  ["admin", () => admin],
  ["key", () => key],
  ["anonymous", () => ({})],
];

it("answers every documented route without a server error", async () => {
  const failures: string[] = [];
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const method of Object.keys(operations)) {
      if (skipped.has(`${method} ${path}`)) continue;
      for (const [name, headers] of variants) {
        const withBody = method === "post" || method === "patch";
        const response = await started.app.inject({
          method: method.toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE",
          url: concrete(path),
          headers: {
            ...headers(),
            ...(withBody ? { "content-type": "application/json" } : {}),
          },
          ...(withBody ? { payload: {} } : {}),
        });
        if (response.statusCode >= 500)
          failures.push(
            `${method.toUpperCase()} ${path} as ${name}: ${String(response.statusCode)} ${response.body.slice(0, 200)}`,
          );
      }
    }
  }
  expect(failures).toEqual([]);
}, 120_000);

it("serves the core read routes to the organization admin", async () => {
  const reads = [
    "/api/v1/me",
    "/api/v1/sessions",
    `/api/v1/sessions/${sessionId}`,
    `/api/v1/sessions/${sessionId}/tree`,
    `/api/v1/sessions/${sessionId}/raw`,
    "/api/v1/repos",
    "/api/v1/installations",
    "/api/v1/schema",
    "/api/v1/dashboards",
    "/api/v1/admin/status",
    "/api/v1/admin/audit",
    "/api/v1/admin/users",
    "/api/v1/admin/keys",
    "/api/v1/admin/redaction/policies",
  ];
  for (const url of reads) {
    const response = await started.app.inject({
      method: "GET",
      url,
      headers: admin,
    });
    expect(`${url} ${String(response.statusCode)}`).toBe(`${url} 200`);
  }
  const render = await started.app.inject({
    method: "POST",
    url: "/api/v1/dashboards/render",
    headers: { ...admin, "content-type": "application/json" },
    payload: { id: dashboardId, variables: {} },
  });
  expect(render.statusCode).toBe(200);
  const rendered = z
    .object({ tiles: z.array(z.object({ error: z.unknown().nullable() })) })
    .parse(render.json());
  expect(rendered.tiles.filter((tile) => tile.error !== null)).toEqual([]);
}, 60_000);
