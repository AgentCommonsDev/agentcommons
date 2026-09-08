import { afterEach, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  registerRequestDecompression,
  INFLATED_LIMIT,
} from "../src/routes/compression.js";
import { assertRouteContract } from "../src/app.js";
import { generateOpenApi } from "../src/openapi.js";
import { queryValidatorCompiler } from "../src/routes/query.js";
import {
  getQuerySchema,
  sessionsInputSchema,
  auditListInputSchema,
} from "@agentcommons/core/schemas";
import qs from "qs";
const applications: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of applications.splice(0)) await app.close();
});

// @req R-ARCH-01
it("generates the API contract from actual routes and rejects missing schemas or summaries at registration", async () => {
  const document = await generateOpenApi();
  expect(Object.keys(document.paths ?? {})).toContain("/api/v1/ingest");
  expect(Object.keys(document.paths ?? {})).toContain(
    "/api/v1/admin/users/password-setup",
  );
  expect(
    document.paths?.["/api/v1/admin/users"]?.get?.responses["200"],
  ).toMatchObject({ content: { "application/json": {}, "text/csv": {} } });
  for (const schema of [
    {},
    { summary: "missing output" },
    { summary: "missing params", response: { 200: z.string() } },
  ])
    expect(() => {
      assertRouteContract({ url: "/api/v1/broken", method: "GET", schema });
    }).toThrow("complete Zod schemas");
  const app = Fastify();
  applications.push(app);
  app.addHook("onRoute", assertRouteContract);
  const complete = {
    summary: "Example",
    params: z.object({}),
    querystring: z.object({}),
    response: { 200: z.string() },
  };
  for (const response of [
    {},
    { 200: { type: "string" } },
    { 200: { content: {} } },
    { 200: { content: { "application/json": { schema: {} } } } },
  ]) {
    expect(() =>
      app.get(
        "/api/v1/invalid",
        { schema: { ...complete, response } },
        () => "bad",
      ),
    ).toThrow("complete Zod schemas");
  }
  expect(() => app.get("/api/unversioned", () => "bad")).toThrow(
    "complete Zod schemas",
  );
  expect(() =>
    app.get("/api/docs/assets/native.js", () => "native"),
  ).not.toThrow();
  app.get("/api/v1/valid", { schema: complete }, () => "ok");
  expect(() =>
    app.post("/api/v1/no-body", { schema: complete }, () => "bad"),
  ).toThrow("complete Zod schemas");
  expect(() => app.get("/bad", { schema: { body: {} } }, () => "bad")).toThrow(
    "Body validation schema for GET",
  );
});

it("translates standard deepObject query encoding without changing string filters or shared service schemas", () => {
  const query = qs.parse(
    "filters[repo_name][]=example.test%2Forg%2Frepo&filters[repo_name][]=other&limit=3&order=asc",
    { allowPrototypes: false },
  );
  const validate = queryValidatorCompiler({
    schema: sessionsInputSchema,
    method: "GET",
    url: "/sessions",
    httpPart: "querystring",
  });
  expect(validate(query)).toMatchObject({
    value: {
      filters: { repo_name: ["example.test/org/repo", "other"] },
      limit: 3,
      order: "asc",
    },
  });
  const get = queryValidatorCompiler({
    schema: getQuerySchema,
    method: "GET",
    url: "/session",
    httpPart: "querystring",
  });
  expect(get(qs.parse("cursor[seq]=2&cursor[offset]=40"))).toMatchObject({
    value: { cursor: { seq: 2, offset: 40 } },
  });
  expect(get({ cursor: JSON.stringify({ seq: 2, offset: 40 }) })).toMatchObject(
    { value: { cursor: { seq: 2, offset: 40 } } },
  );
  const audit = queryValidatorCompiler({
    schema: auditListInputSchema,
    method: "GET",
    url: "/audit",
    httpPart: "querystring",
  });
  expect(audit(qs.parse("filters[status_code]=403&limit=2"))).toMatchObject({
    value: { filters: { status_code: 403 }, limit: 2 },
  });
});

// @req R-SEC-07
it("enforces both compressed and inflated byte limits while decoding gzip and rejects invalid encodings", async () => {
  const app = Fastify({ bodyLimit: INFLATED_LIMIT });
  applications.push(app);
  registerRequestDecompression(app);
  app.post("/ingest", (request) => ({
    bytes: JSON.stringify(request.body).length,
  }));
  const valid = await app.inject({
    method: "POST",
    url: "/ingest",
    headers: { "content-type": "application/json", "content-encoding": "gzip" },
    payload: gzipSync(JSON.stringify({ value: "hello" })),
  });
  expect(valid.statusCode).toBe(200);
  const bomb = gzipSync(
    JSON.stringify({ value: "x".repeat(INFLATED_LIMIT + 1) }),
  );
  expect(bomb.byteLength).toBeLessThan(10 * 1024 * 1024);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
        payload: bomb,
      })
    ).statusCode,
  ).toBe(413);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/ingest",
        headers: { "content-type": "application/json" },
        payload: randomBytes(10 * 1024 * 1024 + 1),
      })
    ).statusCode,
  ).toBe(413);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          "content-encoding": "br",
        },
        payload: "{}",
      })
    ).statusCode,
  ).toBe(415);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
        payload: "broken gzip",
      })
    ).statusCode,
  ).toBe(400);
});
