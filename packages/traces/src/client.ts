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
/**
 * Layout of a reader principal name: `ac_<organization hex>_<user hex>_<authority>_
 * <embeddings>_<saas>_<generation>`. `tracePrincipal` writes the fields in this order and
 * the native policies and views read them back from `currentUser()` by position.
 */
export const principalFields = [
  "organization",
  "user",
  "authority",
  "embeddings",
  "saas",
  "generation",
] as const;
export type PrincipalField = (typeof principalFields)[number];
/** One-letter flag values: the first marks the positive case, the second its absence. */
export const principalFlags = {
  authority: ["a", "m"],
  embeddings: ["e", "n"],
  saas: ["s", "c"],
} as const;
/** SQL reading one field of the current principal's name; the `ac` prefix holds position 1. */
export function principalFieldSql(field: PrincipalField): string {
  return `arrayElement(splitByChar('_',currentUser()),${String(principalFields.indexOf(field) + 2)})`;
}
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
  const flag = (field: keyof typeof principalFlags, on: boolean) =>
    principalFlags[field][on ? 0 : 1];
  const values: Record<PrincipalField, string> = {
    organization: Buffer.from(caller.organizationId).toString("hex"),
    user: Buffer.from(caller.userId).toString("hex"),
    authority: flag("authority", hasAdminAuthority(caller)),
    embeddings: flag("embeddings", embeddings),
    saas: flag("saas", saas),
    generation,
  };
  const username = [
    "ac",
    ...principalFields.map((field) => values[field]),
  ].join("_");
  return {
    username,
    password:
      createHmac("sha256", secret).update(username).digest("hex") +
      CLICKHOUSE_PASSWORD_SUFFIX,
  };
}
/**
 * Per-query limits of every reader principal. `max_execution_time=5` is the agent-facing
 * five-second limit (§7.5); the settings are applied when a principal is created and
 * re-applied to principals an earlier release created, so a change here reaches them.
 */
const READER_SETTINGS =
  "readonly=1, log_queries=0, cancel_http_readonly_queries_on_client_close=1, max_execution_time=5, max_threads=2, max_block_size=8192, enable_join_runtime_filters=0, enable_materialized_cte=1, max_memory_usage=268435456, max_result_bytes=33554432, result_overflow_mode='throw', date_time_output_format='iso', join_use_nulls=1, output_format_json_quote_64bit_integers=1, output_format_json_quote_decimals=1";
/**
 * How long one reader callback may wait on ClickHouse. It exceeds the server's
 * `max_execution_time` so the server's own time-limit error (code 159) reaches the caller
 * instead of a client abort, which ClickHouse only sees as a closed socket.
 */
export const READ_BUDGET_MS = 6500;
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
      request_timeout: READ_BUDGET_MS,
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
      const user = sqlIdentifier(identity.username);
      await this.access.command({
        query: `CREATE USER IF NOT EXISTS ${user} IDENTIFIED WITH sha256_password BY ${sqlString(identity.password)} SETTINGS ${READER_SETTINGS}`,
      });
      // An existing principal keeps the limits of the release that created it until they
      // are re-applied; ALTER USER … SETTINGS replaces its whole settings list.
      await this.access.command({
        query: `ALTER USER ${user} SETTINGS ${READER_SETTINGS}`,
      });
      await this.access.command({
        query: `GRANT ${sqlIdentifier(`${this.config.database}_reader${this.features.embeddings ? "_vector" : ""}`)} TO ${user}`,
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
        const signal = AbortSignal.timeout(READ_BUDGET_MS);
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
