import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { z } from "zod";
import { chromium } from "@playwright/test";
import { getOutputSchema } from "../packages/core/schemas/get.js";
import { ingestOutputSchema } from "../packages/core/schemas/ingest.js";
import { searchOutputSchema } from "../packages/core/schemas/search.js";
import { organizationEmbeddingsOutputSchema } from "../packages/core/schemas/embeddings.js";
import { sqlOutputSchema } from "../packages/core/schemas/sql.js";
import { billingConfigSchema } from "../packages/core/schemas/billing.js";
import { cleanup } from "../scripts/cleanup.js";
import { waitForReady } from "../scripts/ready.js";
import { testEnvelope } from "../apps/api/test/envelopes.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const ready = (origin: string) =>
  waitForReady(origin, { subject: "The Compose API", timeoutMs: 90_000 });
/** The documented example, with Compose hostnames and this run's disposable secrets. */
async function composeEnvironment(overrides: Record<string, string>) {
  const example = Object.fromEntries(
    (await readFile(join(root, ".env.example"), "utf8"))
      .split("\n")
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => {
        const equal = line.indexOf("=");
        return [line.slice(0, equal), line.slice(equal + 1)] as const;
      }),
  );
  return (
    Object.entries({ ...example, ...overrides })
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n"
  );
}
/** Native Compose override: an unused loopback port, plus runtime-only values. */
const portsOverride = (environment: Record<string, string> = {}) =>
  [
    "services:",
    "  api:",
    "    ports: !override",
    '      - "127.0.0.1::3000"',
    ...(Object.keys(environment).length ? ["    environment:"] : []),
    ...Object.entries(environment).map(
      ([key, value]) => `      ${key}: ${JSON.stringify(value)}`,
    ),
  ].join("\n") + "\n";

// @req R-INF-01 @req R-SAAS-07
it(
  "builds and runs the self-host image through Compose, migrates, bootstraps native auth, and ingests/searches a captured transcript",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentcommons-compose-"));
    const project = `agentcommons-test-${randomUUID().slice(0, 8)}`;
    const imageTag = `verification-${randomUUID().slice(0, 8)}`;
    let built = false;
    let cleanupErrors: unknown[] = [];
    let commandIndex = 0;
    async function command(args: string[], cwd = directory) {
      const log = join(directory, `command-${String(++commandIndex)}.log`);
      try {
        return await promisify(execFile)("docker", args, {
          cwd,
          timeout: 10 * 60_000,
          maxBuffer: 8 * 1024 * 1024,
        });
      } catch (error) {
        const details = z
          .object({
            stdout: z.string().optional(),
            stderr: z.string().optional(),
          })
          .loose()
          .safeParse(error);
        await writeFile(
          log,
          details.success
            ? `${details.data.stdout ?? ""}\n${details.data.stderr ?? ""}`
            : "Docker command failed.",
          { mode: 0o600 },
        );
        throw new Error(
          `Docker verification failed; inspect private log ${log}`,
        );
      }
    }
    const compose = (args: string[]) =>
      command([
        "compose",
        "-p",
        project,
        "-f",
        "docker-compose.yml",
        "-f",
        "ports.yml",
        ...args,
      ]);
    await copyFile(
      join(root, "docker-compose.yml"),
      join(directory, "docker-compose.yml"),
    );
    await mkdir(join(directory, "packages/traces/config"), { recursive: true });
    await copyFile(
      join(root, "packages/traces/config/privacy.xml"),
      join(directory, "packages/traces/config/privacy.xml"),
    );
    await writeFile(join(directory, "ports.yml"), portsOverride());
    await writeFile(
      join(directory, ".env"),
      await composeEnvironment({
        IMAGE_TAG: imageTag,
        PUBLIC_URL: "http://localhost:3000",
        POSTGRES_PASSWORD: "compose-database-password",
        DATABASE_MIGRATION_URL:
          "postgres://agentcommons:compose-database-password@db:5432/agentcommons",
        DATABASE_URL:
          "postgres://ac_app:compose-app-password@db:5432/agentcommons",
        DATABASE_TRACE_CONTROL_URL:
          "postgres://ac_trace_control:compose-control-password@db:5432/agentcommons",
        CLICKHOUSE_POSTGRES_HOST: "db",
        CLICKHOUSE_MIGRATION_PASSWORD: "compose-clickhouse-admin-password",
        CLICKHOUSE_URL: "http://clickhouse:8123",
        CLICKHOUSE_WRITER_PASSWORD: "compose-clickhouse-writer-password",
        CLICKHOUSE_ACCESS_PASSWORD: "compose-clickhouse-access-password",
        CLICKHOUSE_READER_SECRET: `${randomUUID()}${randomUUID()}`,
        BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
        LOG_LEVEL: "silent",
        EMBEDDINGS_ENABLED: process.env.EMBEDDINGS_ENABLED ?? "false",
        EMBEDDINGS_PROVIDER: "fake",
      }),
      { mode: 0o600 },
    );
    try {
      await command(["build", "--tag", `agentcommons:${imageTag}`, "."], root);
      built = true;
      const offlineManager = await command([
        "run",
        "--rm",
        "--network",
        "none",
        `agentcommons:${imageTag}`,
        "pnpm",
        "--version",
      ]);
      const packageManifest = z
        .object({ packageManager: z.string() })
        .parse(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
      expect(`pnpm@${offlineManager.stdout.trim()}`).toBe(
        packageManifest.packageManager,
      );
      await compose(["up", "-d", "--no-build"]);
      const published = (await compose(["port", "api", "3000"])).stdout.trim();
      expect(published).toMatch(/^127\.0\.0\.1:\d+$/);
      const origin = `http://${published}`;
      await ready(origin);
      const seeded = await compose([
        "run",
        "--rm",
        "--no-deps",
        "api",
        "pnpm",
        "db:seed",
        "--admin",
        "compose@example.com",
      ]);
      const setup = seeded.stdout
        .split("\n")
        .flatMap((line) => {
          try {
            const parsed = z
              .object({ setup_url: z.url() })
              .safeParse(JSON.parse(line));
            return parsed.success ? [parsed.data] : [];
          } catch {
            return [];
          }
        })
        .at(-1);
      if (!setup)
        throw new Error(
          "Container bootstrap did not return a native setup URL.",
        );
      const token = z
        .string()
        .min(1)
        .parse(new URL(setup.setup_url).pathname.split("/").at(-1));
      const password = "Compose native login verification 1234!";
      const headers = {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      };
      const reset = await fetch(`${origin}/auth/reset-password`, {
        method: "POST",
        headers,
        body: JSON.stringify({ token, newPassword: password }),
      });
      expect(reset.status).toBe(200);
      const signed = await fetch(`${origin}/auth/sign-in/email`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: "compose@example.com", password }),
      });
      expect(signed.status).toBe(200);
      const cookie = signed.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      expect(cookie.length).toBeGreaterThan(0);
      const keyResponse = await fetch(`${origin}/api/v1/me/keys`, {
        method: "POST",
        headers: { ...headers, cookie },
        body: JSON.stringify({
          name: "Compose test",
          permissions: { sessions: ["read", "ingest"] },
        }),
      });
      expect(keyResponse.status).toBe(200);
      const { key } = z
        .object({ key: z.string().startsWith("ac_") })
        .parse(await keyResponse.json());
      const records = (
        await readFile(
          join(root, "fixtures/transcripts/claude-code/parent.jsonl"),
          "utf8",
        )
      )
        .split("\n")
        .filter(Boolean);
      const envelope = testEnvelope({
        behavior: "end",
        nativeEvent: "SessionEnd",
        sourcePos: records.length,
        cursor: `${String(records.length)}:0`,
        context: {
          cwd: "/compose/probe",
          installation: { hostname: "compose", osUser: "node" },
        },
        records: records.map((line, pos) => ({ pos, sourceVersion: 0, line })),
        end: {
          reason: "exit",
          head: null,
          observedCommits: [],
          observedDiffStat: null,
          dirtyFileCount: null,
        },
      });
      const apiHeaders = {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      };
      const ingested = await fetch(`${origin}/api/v1/ingest`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify(envelope),
      });
      expect(ingested.status).toBe(202);
      const receipt = ingestOutputSchema.parse(await ingested.json());
      await expect
        .poll(
          async () => {
            const replay = await fetch(`${origin}/api/v1/ingest`, {
              method: "POST",
              headers: apiHeaders,
              body: JSON.stringify(envelope),
            });
            expect(replay.status).toBe(202);
            return ingestOutputSchema.parse(await replay.json()).publication;
          },
          { timeout: 60_000, interval: 250 },
        )
        .toBe("published");
      const detail = await fetch(
        `${origin}/api/v1/sessions/${receipt.sessionId}`,
        { headers: apiHeaders },
      );
      expect(detail.status).toBe(200);
      const session = getOutputSchema.parse(await detail.json());
      expect(session.header.harness).toBe("CLAUDE_CODE");
      expect(session.header.message_count).toBeGreaterThan(0);
      const search = await fetch(`${origin}/api/v1/search`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({
          query: "",
          filters: { session_id: receipt.sessionId },
        }),
      });
      expect(search.status).toBe(200);
      expect(
        searchOutputSchema
          .parse(await search.json())
          .blocks.some((block) => block.session_id === receipt.sessionId),
      ).toBe(true);
      const embeddingSettings = async () => {
        const response = await fetch(
          `${origin}/api/v1/organization/embeddings`,
          { headers: apiHeaders },
        );
        expect(response.status).toBe(200);
        return organizationEmbeddingsOutputSchema.parse(await response.json());
      };
      const enabled = process.env.EMBEDDINGS_ENABLED === "true";
      expect(await embeddingSettings()).toMatchObject({
        available: enabled,
        enabled: false,
        effective: false,
      });
      if (enabled) {
        const optIn = await fetch(`${origin}/api/v1/organization/embeddings`, {
          method: "PATCH",
          headers: { ...headers, cookie },
          body: JSON.stringify({
            enabled: true,
            reason: "Verify the container's deterministic embedding worker",
          }),
        });
        expect(optIn.status).toBe(200);
        expect(
          organizationEmbeddingsOutputSchema.parse(await optIn.json()),
        ).toMatchObject({ effective: true, provider: "fake" });
        await expect
          .poll(async () => (await embeddingSettings()).sessions_indexed, {
            timeout: 60_000,
            interval: 250,
          })
          .toBe(1);
        const vectors = await fetch(`${origin}/api/v1/query`, {
          method: "POST",
          headers: apiHeaders,
          body: JSON.stringify({
            sql: "SELECT count() AS vectors,min(length(embedding)) AS dimensions FROM message_chunks",
          }),
        });
        expect(vectors.status).toBe(200);
        const result = sqlOutputSchema.parse(await vectors.json());
        expect(
          Number(
            result.rows[0]?.[
              result.columns.findIndex((column) => column.name === "vectors")
            ],
          ),
        ).toBeGreaterThan(0);
        expect(
          Number(
            result.rows[0]?.[
              result.columns.findIndex((column) => column.name === "dimensions")
            ],
          ),
        ).toBe(1024);
      }
      const landing = await fetch(origin);
      expect(landing.status).toBe(200);
      expect(landing.headers.get("x-robots-tag")).toContain("noindex");
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
        });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("response", (response) => {
          const path = new URL(response.url()).pathname;
          // The anonymous visit probes identity once before the sign-in redirect.
          if (response.status() === 401 && path === "/api/v1/me") return;
          if (response.status() >= 400)
            errors.push(`${String(response.status())} ${path}`);
        });
        // A customer instance sends the site root to the application, which asks an
        // anonymous visitor to sign in (R-DASH-24 companion in app-shell.spec.ts).
        await page.goto(origin);
        await page.waitForURL(/\/login$/);
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        expect(
          z
            .boolean()
            .parse(
              await page.evaluate(
                "document.documentElement.scrollWidth <= innerWidth",
              ),
            ),
        ).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
      const manifest = await fetch(`${origin}/hook/manifest.json`);
      expect(manifest.status).toBe(200);
      expect(
        z
          .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
          .parse(await manifest.json()).sha256,
      ).toHaveLength(64);
      // Runtime receives app and trace principals, never migration authority.
      const identity = await compose([
        "exec",
        "-T",
        "api",
        "node",
        "-e",
        "process.stdout.write(JSON.stringify({uid:process.getuid(),migration:process.env.DATABASE_MIGRATION_URL,traceControl:process.env.DATABASE_TRACE_CONTROL_URL,traceMigration:process.env.CLICKHOUSE_MIGRATION_PASSWORD,rootPassword:process.env.POSTGRES_PASSWORD}))",
      ]);
      expect(JSON.parse(identity.stdout)).toEqual({
        uid: 1000,
        migration: "",
        traceControl: "",
        traceMigration: "",
        rootPassword: "",
      });
      // Reuse the same built image with runtime-only SaaS values. This boot imports
      // the retained SSR renderer; customer mode alone does not exercise that artifact.
      await writeFile(
        join(directory, "ports.yml"),
        portsOverride({
          INSTANCE_MODE: "saas",
          FREE_MONTHLY_RECORDS: "7",
          PRO_INCLUDED_RECORDS: "13",
        }),
      );
      await compose([
        "up",
        "-d",
        "--no-build",
        "--no-deps",
        "--force-recreate",
        "api",
      ]);
      const saasPort = (await compose(["port", "api", "3000"])).stdout.trim();
      expect(saasPort).toMatch(/^127\.0\.0\.1:\d+$/);
      const saasOrigin = `http://${saasPort}`;
      await ready(saasOrigin);
      const pricingResponse = await fetch(
        `${saasOrigin}/api/v1/billing/config`,
      );
      expect(pricingResponse.status).toBe(200);
      expect(
        billingConfigSchema.parse(await pricingResponse.json()),
      ).toMatchObject({
        mode: "saas",
        enabled: true,
        plans: {
          free: { monthly_records: 7 },
          pro: { included_records: 13, monthly_price_usd: 100 },
        },
        checkout_enabled: false,
        cal_com_url: null,
      });
      const ssrBrowser = await chromium.launch();
      try {
        const context = await ssrBrowser.newContext({
          javaScriptEnabled: false,
          viewport: { width: 390, height: 844 },
        });
        const page = await context.newPage();
        const response = await page.goto(saasOrigin);
        expect(response?.status()).toBe(200);
        expect(await response?.headerValue("x-robots-tag")).toBeNull();
        expect(
          await page.locator(".pricing-free .plan-allowance").textContent(),
        ).toContain("7");
        expect(
          await page.locator(".pricing-pro .plan-allowance").textContent(),
        ).toContain("13");
        expect(
          await page
            .getByRole("link", { name: "Start free", exact: true })
            .first()
            .getAttribute("href"),
        ).toBe("/signup");
      } finally {
        await ssrBrowser.close();
      }
    } finally {
      cleanupErrors = await cleanup([
        () => compose(["down", "--volumes", "--remove-orphans"]),
        async () => {
          if (built) await command(["image", "rm", `agentcommons:${imageTag}`]);
        },
      ]);
    }
    if (cleanupErrors.length)
      throw new AggregateError(
        cleanupErrors,
        "Compose verification cleanup failed.",
      );
  },
  15 * 60_000,
);
