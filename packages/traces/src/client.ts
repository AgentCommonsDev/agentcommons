import { createHmac } from "node:crypto";
import {
  createClient,
  ClickHouseLogLevel,
  type ClickHouseClient,
} from "@clickhouse/client";
import { z } from "zod";
export { ClickHouseError } from "@clickhouse/client";
import {
  lockTracePublication,
  type PrismaClient,
  type ReadAuthority,
  hasAdminAuthority,
} from "@agentcommons/db";
import type { ClickHouseConfig } from "./config.js";
import type {
  TraceParameters,
  TraceReadClient,
  TraceQueryResult,
} from "./types.js";

/** Driver error messages can contain SQL values; application services own safe error reporting. */
export function createTraceClient(
  config: Parameters<typeof createClient>[0],
): ClickHouseClient {
  return createClient({ ...config, log: { level: ClickHouseLogLevel.OFF } });
}
const compactSchema = z.object({
  meta: z.array(z.object({ name: z.string(), type: z.string() })),
  data: z.array(z.array(z.unknown())),
});
export function sqlIdentifier(value: string): string {
  return `\`${value.replaceAll("\\", "\\\\").replaceAll("`", "\\`")}\``;
}
export function sqlString(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
/**
 * ClickHouse Cloud accepts a password only with an uppercase letter and a special
 * character. Every generated ClickHouse password carries this fixed suffix after its
 * random or derived part, which keeps the entropy and satisfies the policy everywhere.
 */
export const CLICKHOUSE_PASSWORD_SUFFIX = "Aa!";
export function tracePrincipal(
  caller: ReadAuthority,
  embeddings: boolean,
  secret: string,
  saas = false,
) {
  if (!caller.userId)
    throw new Error("Trace readers require an authenticated issuing user.");
  // The generation names the password scheme too: changing it creates fresh principals
  // instead of colliding with users that hold an earlier password format.
  const generation = createHmac("sha256", secret)
    .update("trace-reader-generation:2")
    .digest("hex")
    .slice(0, 12);
  const username = `ac_${Buffer.from(caller.organizationId).toString("hex")}_${Buffer.from(caller.userId).toString("hex")}_${hasAdminAuthority(caller) ? "a" : "m"}_${embeddings ? "e" : "n"}_${saas ? "s" : "c"}_${generation}`;
  return {
    username,
    password:
      createHmac("sha256", secret).update(username).digest("hex") +
      CLICKHOUSE_PASSWORD_SUFFIX,
  };
}
export async function queryTrace<Row extends Record<string, unknown>>(
  client: ClickHouseClient,
  sql: string,
  parameters: TraceParameters = {},
  auth?: { username: string; password: string },
  signal: AbortSignal = AbortSignal.timeout(6000),
): Promise<TraceQueryResult<Row>> {
  const result = await client.query({
    query: sql,
    query_params: parameters,
    format: "JSONCompact",
    ...(auth ? { auth } : {}),
    abort_signal: signal,
  });
  const body = compactSchema.parse(await result.json());
  for (const row of body.data)
    if (row.length !== body.meta.length)
      throw new Error("ClickHouse returned an inconsistent row shape.");
  return {
    fields: body.meta,
    data: body.data,
    // Field value boundaries are validated by the consuming service's shared Zod schema.
    rows: body.data.map(
      (row) =>
        Object.fromEntries(
          body.meta.map((field, index) => [field.name, row[index]]),
        ) as Row,
    ),
  };
}
export class TraceReaders {
  private readonly client: ClickHouseClient;
  private readonly access: ClickHouseClient;
  private readonly provisioned = new Map<string, Promise<void>>();
  constructor(
    private readonly config: ClickHouseConfig,
    private readonly prisma: PrismaClient,
    private readonly features: { embeddings: boolean; saas?: boolean } = {
      embeddings: false,
    },
  ) {
    this.client = createTraceClient({
      url: config.url,
      database: "api_ro",
      username: "unconfigured_reader",
      request_timeout: 6000,
      max_open_connections: 16,
    });
    this.access = createTraceClient({
      url: config.url,
      username: config.accessUsername,
      password: config.accessPassword,
      request_timeout: 6000,
      max_open_connections: 3,
    });
  }
  private provision(identity: {
    username: string;
    password: string;
  }): Promise<void> {
    const existing = this.provisioned.get(identity.username);
    if (existing) return existing;
    const pending = (async () => {
      await this.access.command({
        query: `CREATE USER IF NOT EXISTS ${sqlIdentifier(identity.username)} IDENTIFIED WITH sha256_password BY ${sqlString(identity.password)} SETTINGS readonly=1, log_queries=0, cancel_http_readonly_queries_on_client_close=1, max_execution_time=5, max_threads=2, max_block_size=8192, enable_join_runtime_filters=0, enable_materialized_cte=1, max_memory_usage=268435456, max_result_bytes=33554432, result_overflow_mode='throw', date_time_output_format='iso', join_use_nulls=1, output_format_json_quote_64bit_integers=1, output_format_json_quote_decimals=1`,
      });
      await this.access.command({
        query: `GRANT ${sqlIdentifier(`${this.config.database}_reader${this.features.embeddings ? "_vector" : ""}`)} TO ${sqlIdentifier(identity.username)}`,
      });
    })();
    this.provisioned.set(identity.username, pending);
    void pending.catch(() => {
      this.provisioned.delete(identity.username);
    });
    return pending;
  }
  async read<T>(
    caller: ReadAuthority,
    operation: (client: TraceReadClient) => Promise<T>,
  ): Promise<T> {
    const identity = tracePrincipal(
      caller,
      this.features.embeddings,
      this.config.readerSecret,
      this.features.saas,
    );
    await this.provision(identity);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '6s'`;
        await lockTracePublication(tx, caller.organizationId, "read");
        const signal = AbortSignal.timeout(5000);
        return operation({
          control: tx,
          query: <Row extends Record<string, unknown>>(
            sql: string,
            parameters?: TraceParameters,
          ) => {
            signal.throwIfAborted();
            return queryTrace<Row>(
              this.client,
              sql,
              parameters,
              identity,
              signal,
            );
          },
        });
      },
      { timeout: 12000, maxWait: 10000 },
    );
  }
  async close(): Promise<void> {
    await Promise.all([this.client.close(), this.access.close()]);
  }
}
