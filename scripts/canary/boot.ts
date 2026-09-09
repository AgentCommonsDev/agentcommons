import assert from "node:assert/strict";
import { cp, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { startApp, type StartedApp } from "../../apps/api/test/app.js";
import {
  adminToolNames,
  readToolNames,
} from "../../apps/api/src/services/mcp.js";
import type { startMailpit } from "../../apps/api/test/mailpit.js";
import type { TraceDatabase } from "./support.js";

/** The built dashboard in a private copy the API serves, module scope preserved for its SSR renderer. */
export async function snapshotDashboard(root: string, directory: string) {
  const assets = join(directory, "dashboard");
  await cp(join(root, "apps/dashboard/dist"), assets, { recursive: true });
  // Preserve the built renderer's workspace module scope in its private asset snapshot.
  await writeFile(
    join(assets, "package.json"),
    JSON.stringify({ type: "module" }) + "\n",
  );
  await symlink(
    join(root, "apps/dashboard/node_modules"),
    join(assets, "node_modules"),
    "dir",
  );
  return assets;
}

/** The disposable API on its own PostgreSQL and ClickHouse, jobs running, listening on loopback. */
export async function startApi(input: {
  database: TraceDatabase;
  publicUrl: string;
  port: number;
  assets: string;
  instanceMode: "customer" | "saas";
  mail: Awaited<ReturnType<typeof startMailpit>> | undefined;
}): Promise<Pick<StartedApp, "runtime" | "app">> {
  const { runtime, app } = await startApp(
    input.database,
    {
      PUBLIC_URL: input.publicUrl,
      TRUST_PROXY: "loopback",
      INSTANCE_MODE: input.instanceMode,
      ...(input.mail
        ? {
            EMAIL_TRANSPORT: "smtp",
            EMAIL_FROM: "no-reply@agentcommons.test",
            SMTP_URL: input.mail.smtpUrl,
          }
        : {}),
    },
    {
      jobs: true,
      listen: true,
      port: input.port,
      dashboardDirectory: input.assets,
    },
  );
  return { runtime, app };
}

/** An MCP client over streamable HTTP authenticated with one API key. */
export async function connectMcp(publicUrl: string, key: string) {
  const client = new Client({ name: "live-canary", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${publicUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${key}` } },
    }) as Transport,
  );
  return client;
}

/**
 * Catalog budget (R-MCP-09, ADR 0053): Claude Code defers every MCP tool behind
 * ToolSearch once deferrable definitions reach 10% of the context window, so the
 * advertised catalog must stay small. Measured up front and asserted by the caller after
 * the native stages, so a failing run still records how each harness behaved.
 */
export async function measureCatalog(userClient: Client, adminClient: Client) {
  const catalogBytes = async (client: Client) =>
    Buffer.byteLength(JSON.stringify((await client.listTools()).tools));
  const catalog = {
    read_bytes: await catalogBytes(userClient),
    admin_bytes: await catalogBytes(adminClient),
    read_budget_bytes: 20 * 1024,
    admin_budget_bytes: 25 * 1024,
  };
  const readTools = [...readToolNames];
  assert.deepEqual(
    (await userClient.listTools()).tools.map((tool) => tool.name),
    readTools,
  );
  assert.deepEqual(
    (await adminClient.listTools()).tools.map((tool) => tool.name),
    [...readTools, ...adminToolNames],
  );
  return catalog;
}
export function assertCatalogWithinBudget(
  catalog: Awaited<ReturnType<typeof measureCatalog>>,
) {
  assert.ok(
    catalog.read_bytes < catalog.read_budget_bytes &&
      catalog.admin_bytes < catalog.admin_budget_bytes,
    `The MCP catalog is over budget (read ${String(catalog.read_bytes)} B, admin ${String(catalog.admin_bytes)} B); Claude Code would defer it behind ToolSearch.`,
  );
}

/** A signed-in mobile page that records page errors, console errors and failed responses. */
export async function mobilePage(
  browser: Browser,
  publicUrl: string,
  cookie: string,
) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addCookies(
    cookie.split("; ").map((entry) => {
      const equal = entry.indexOf("=");
      return {
        name: entry.slice(0, equal),
        value: entry.slice(equal + 1),
        url: publicUrl,
      };
    }),
  );
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      browserErrors.push(
        `${String(response.status())} ${new URL(response.url()).pathname}`,
      );
  });
  return { page, browserErrors };
}
