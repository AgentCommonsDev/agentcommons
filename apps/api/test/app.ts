import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  traceEnvironment,
  type startTraceDatabase,
} from "../../../packages/traces/test/support.js";
import { cleanup } from "../../../scripts/cleanup.js";
import { createApp } from "../src/app.js";
import { environment, type Env } from "../src/env.js";
import { createRuntime } from "../src/main.js";
import { testAuthConfiguration } from "./support.js";

/*
 * Lives apart from support.ts because packages/traces/test/support.ts imports that file:
 * the trace environment this module needs would otherwise form an import cycle.
 */

export type TraceDatabase = Awaited<ReturnType<typeof startTraceDatabase>>;

/** Captured pino output, for assertions about what the server logs. */
export function logCapture() {
  const logs: string[] = [];
  return {
    logs,
    stream: {
      write(chunk: string) {
        logs.push(chunk);
      },
    },
  };
}

interface StartAppOptions {
  /** Listen on loopback so fetch, MCP clients and the shim can reach the server. */
  listen?: boolean;
  /** Fixed port for `listen`; an ephemeral one by default. */
  port?: number;
  /** Start the pg-boss worker before serving. */
  jobs?: boolean;
  captureLogs?: boolean;
  /** Serve the built dashboard and public pages (off by default for API-only tests). */
  static?: boolean;
  dashboardDirectory?: string;
  /** Adjust the parsed environment before the runtime is built (e.g. a Stripe client). */
  configure?: (env: Env) => Env;
  /** Per-minute rate maxima replacing the product budgets (`createApp`'s `rateMaxima`). */
  rateMaxima?: Parameters<typeof createApp>[0]["rateMaxima"];
}
export interface StartedApp {
  env: Env;
  runtime: Awaited<ReturnType<typeof createRuntime>>;
  app: Awaited<ReturnType<typeof createApp>>;
  logs: string[];
  /** Closes the server, then the runtime; throws when either fails. */
  close: () => Promise<void>;
}

/**
 * The runtime and Fastify server every HTTP-level test boots: real PostgreSQL and
 * ClickHouse from `db`, silent logs, embeddings off, `overrides` on top.
 */
export function startApp(
  db: TraceDatabase,
  overrides: Record<string, string> | undefined,
  options: StartAppOptions & { listen: true },
): Promise<StartedApp & { address: string }>;
export function startApp(
  db: TraceDatabase,
  overrides?: Record<string, string>,
  options?: StartAppOptions,
): Promise<StartedApp & { address: null }>;
export async function startApp(
  db: TraceDatabase,
  overrides: Record<string, string> = {},
  options: StartAppOptions = {},
): Promise<StartedApp & { address: string | null }> {
  const parsed = environment({
    PUBLIC_URL: testAuthConfiguration.publicUrl,
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    DATABASE_URL: db.urls.app,
    ...traceEnvironment(db.traceConfig),
    LOG_LEVEL: "silent",
    EMBEDDINGS_ENABLED: "false",
    ...overrides,
  });
  const env = options.configure ? options.configure(parsed) : parsed;
  const runtime = await createRuntime(env);
  const release: Array<() => Promise<unknown>> = [() => runtime.close()];
  const { logs, stream } = logCapture();
  try {
    if (options.jobs) await runtime.jobs.start();
    const app = await createApp({
      env,
      services: runtime.services,
      static: options.static ?? Boolean(options.dashboardDirectory),
      ...(options.dashboardDirectory
        ? { dashboardDirectory: options.dashboardDirectory }
        : {}),
      ...(options.captureLogs ? { loggerStream: stream } : {}),
      ...(options.rateMaxima ? { rateMaxima: options.rateMaxima } : {}),
    });
    release.unshift(() => app.close());
    const address = options.listen
      ? await app.listen({ host: "127.0.0.1", port: options.port ?? 0 })
      : null;
    return {
      env,
      runtime,
      app,
      address,
      logs,
      close: async (): Promise<void> => {
        const errors = await cleanup(release.splice(0));
        if (errors.length)
          throw new AggregateError(
            errors,
            "The test application failed to close cleanly.",
          );
      },
    };
  } catch (error) {
    await cleanup(release.splice(0));
    throw error;
  }
}

/** An MCP client over streamable HTTP authenticated with one API key. */
export async function mcpClient(
  address: string,
  key: string,
  options: {
    name?: string;
    /** Registers `client.close()` on a release list. */
    defer?: (action: () => Promise<unknown>) => void;
  } = {},
): Promise<Client> {
  const client = new Client({
    name: options.name ?? "integration-test",
    version: "1",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${key}` } },
    }) as Transport,
  );
  options.defer?.(() => client.close());
  return client;
}
