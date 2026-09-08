import {
  startTraceDatabase,
  traceEnvironment,
} from "../../../packages/traces/test/support.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { cleanup } from "../../../scripts/cleanup.js";
import { createApp } from "../src/app.js";
import { createRuntime } from "../src/main.js";
import { environment } from "../src/env.js";
import { testAuthConfiguration } from "./support.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let runtime: Awaited<ReturnType<typeof createRuntime>>;
let app: Awaited<ReturnType<typeof createApp>>;
let address: string;
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  await promisify(execFile)("pnpm", [
    "--filter",
    "@agentcommons/api",
    "build:reference",
  ]);
  db = await startTraceDatabase();
  release.unshift(() => db.close());
  const env = environment({
    PUBLIC_URL: testAuthConfiguration.publicUrl,
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    DATABASE_URL: db.urls.app,
    ...traceEnvironment(db.traceConfig),
    LOG_LEVEL: "silent",
    EMBEDDINGS_ENABLED: "false",
  });
  runtime = await createRuntime(env);
  release.unshift(() => runtime.close());
  app = await createApp({ env, services: runtime.services, static: false });
  release.unshift(() => app.close());
  address = await app.listen({ host: "127.0.0.1", port: 0 });
});
afterAll(async () => {
  expect(await cleanup(release.splice(0))).toEqual([]);
});

// @req R-ARCH-07
it("serves the exact live Zod-generated OpenAPI and native local Scalar bundle without granting corpus access", async () => {
  const before = await db.prisma.auditEvent.count();
  const response = await fetch(`${address}/api/docs/json`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(app.swagger());
  const spec = z
    .object({
      openapi: z.literal("3.1.0"),
      paths: z.record(z.string(), z.unknown()),
    })
    .parse(app.swagger());
  expect(spec.paths).toHaveProperty("/api/v1/search");
  expect(spec.paths).not.toHaveProperty("/api/v1/sessions/{id}/similar");
  const bundle = await fetch(`${address}/api/docs/js/scalar.js`);
  expect(bundle.status).toBe(200);
  expect(bundle.headers.get("content-type")).toContain(
    "application/javascript",
  );
  expect((await bundle.text()).length).toBeGreaterThan(100_000);
  const first = await fetch(`${address}/api/docs/`, {
    headers: { "Accept-Encoding": "gzip" },
  });
  expect(first.headers.get("content-encoding")).toBeNull();
  const firstHtml = await first.text();
  const csp = first.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("script-src 'self' 'nonce-");
  expect(csp).not.toContain("unsafe-eval");
  expect(first.headers.get("x-robots-tag")).toContain("noindex");
  expect(first.headers.get("x-content-type-options")).toBe("nosniff");
  const nonce = z.string().parse(/'nonce-([^']+)'/.exec(csp)?.[1]);
  expect(
    [...firstHtml.matchAll(/<script nonce="([^"]+)"/g)].map(
      (match) => match[1],
    ),
  ).toEqual([nonce, nonce, nonce]);
  const second = await fetch(`${address}/api/docs/`);
  expect(second.headers.get("content-security-policy")).not.toBe(csp);
  expect(await db.prisma.auditEvent.count()).toBe(before);
  expect((await fetch(`${address}/api/v1/sessions`)).status).toBe(401);
});

// @req R-ARCH-07
it("renders searchable operations and their schemas in an actual browser under CSP with no external requests", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const external: string[] = [];
    const errors: string[] = [];
    page.on("request", (request) => {
      if (
        !request.url().startsWith(address) &&
        !request.url().startsWith("data:")
      )
        external.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, "referenceViolations", {
        value: [],
        configurable: true,
      });
      document.addEventListener("securitypolicyviolation", (event) => {
        const values: unknown = Reflect.get(window, "referenceViolations");
        if (Array.isArray(values))
          values.push(`${event.violatedDirective}:${event.blockedURI}`);
      });
    });
    await page.goto(`${address}/api/docs/`);
    await page
      .getByRole("heading", { name: "AgentCommons API", exact: true })
      .waitFor();
    await page.screenshot({
      path: "/tmp/agentcommons-scalar-initial.png",
      fullPage: false,
    });
    await page.keyboard.press("Control+k");
    const search = page.getByRole("combobox", {
      name: "Enter search query",
      exact: true,
    });
    await search.fill("Search previous session messages");
    const result = page.getByRole("option", {
      name: /Operation: Search previous session messages/,
    });
    await result.waitFor();
    await result.click();
    const heading = page.getByRole("heading", {
      name: "Search previous session messages",
      exact: true,
    });
    await heading.waitFor();
    const operation = page.getByRole("region", {
      name: "Search previous session messages",
      exact: true,
    });
    const body = operation.getByRole("group", {
      name: "Request Body",
      exact: true,
    });
    expect((await body.innerText()).replaceAll(/\s+/g, " ")).toContain(
      "max: 50",
    );
    await body
      .getByRole("button", {
        name: "Show Child Attributes for filters",
        exact: true,
      })
      .click();
    expect(await body.innerText()).toContain("where");
    await operation.getByText("Show Schema", { exact: true }).click();
    expect(
      await operation
        .getByRole("checkbox", { name: "Show Schema", exact: true })
        .isChecked(),
    ).toBe(true);
    expect(await operation.innerText()).toContain("truncated_response");
    expect(await operation.innerText()).toContain("blocks");
    await operation
      .getByRole("tab", { name: "Status: 4XX", exact: true })
      .click();
    const errorSchema = z
      .object({
        required: z.array(z.string()),
        additionalProperties: z.literal(false),
      })
      .parse(JSON.parse(await operation.locator("code").last().innerText()));
    expect(errorSchema.required).toEqual(["code", "message"]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.keyboard.press("Control+k");
    await search.fill("Search previous session messages");
    await result.click();
    await heading.scrollIntoViewIfNeeded();
    expect(await heading.isVisible()).toBe(true);
    await page.screenshot({
      path: "/tmp/agentcommons-scalar-mobile.png",
      fullPage: false,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    expect(
      await page.evaluate(() => {
        const values: unknown = Reflect.get(window, "referenceViolations");
        return values;
      }),
    ).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60_000);
