import { postgresSourceSql } from "./postgres.js";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  CLICKHOUSE_PASSWORD_SUFFIX,
  createTraceClient,
  sqlIdentifier,
  sqlString,
} from "./client.js";
import { EMBEDDING_DIMENSIONS, traceTables, auditColumns } from "./schema.js";
import { securityStatements } from "./security.js";
import { analyticsViews } from "./views/analytics.js";
import { baseViews } from "./views/base.js";
import { searchTermsSql, searchViews } from "./views/search.js";
import { catalogViews } from "./views/catalog.js";
import type { TraceMigrationConfig } from "./config.js";

export const CLICKHOUSE_IMAGE = "clickhouse/clickhouse-server:26.8.2.7";
/**
 * PostgreSQL `trace_control` views mirrored into ClickHouse as `control_<name>` tables.
 * Narrow operational metadata only; no native identity credentials reach ClickHouse.
 */
const controlTables = {
  installations: {
    organization_id: "String",
    id: "UUID",
    hostname: "String",
    os_user: "String",
    platform: "String",
    arch: "String",
    hook_sha256: "Nullable(String)",
    tools_enabled: "Int32",
    first_seen_at: "DateTime64(6,'UTC')",
    last_seen_at: "DateTime64(6,'UTC')",
  },
  organization_settings: {
    organization_id: "String",
    embeddings_enabled: "Int32",
    paid_embeddings: "Int32",
  },
  metrics_health: {
    organization_id: "String",
    session_id: "UUID",
    authorization_blocked: "Int32",
  },
  metrics_members: { organization_id: "String", member_count: "Int64" },
} as const;
/** Control tables earlier migrations created and nothing reads; dropped so deployments converge. */
const retiredControlTables = ["control_users", "control_audit_retention"];
const columns = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([name, type]) => `${sqlIdentifier(name)} ${type}`)
    .join(",");
export async function migrateTraces(
  config: TraceMigrationConfig,
): Promise<void> {
  z.string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .parse(config.database);
  const client = createTraceClient({
    url: config.url,
    username: config.username,
    password: config.password,
    request_timeout: 30000,
    clickhouse_settings: { join_use_nulls: 1 },
  });
  const db = sqlIdentifier(config.database);
  const owner = sqlIdentifier(`${config.database}_view_owner`);
  const reader = sqlIdentifier(`${config.database}_reader`);
  const vectorReader = sqlIdentifier(`${config.database}_reader_vector`);
  const command = (query: string) => client.command({ query });
  try {
    await command(`CREATE DATABASE IF NOT EXISTS ${db}`);
    await command("CREATE DATABASE IF NOT EXISTS api_ro");
    await command(
      `CREATE USER IF NOT EXISTS ${owner} IDENTIFIED WITH sha256_password BY ${sqlString(randomBytes(32).toString("hex") + CLICKHOUSE_PASSWORD_SUFFIX)} HOST NONE`,
    );
    await command(
      `CREATE USER IF NOT EXISTS ${sqlIdentifier(config.writerUsername)} IDENTIFIED WITH sha256_password BY ${sqlString(config.writerPassword)}`,
    );
    await command(
      `CREATE USER IF NOT EXISTS ${sqlIdentifier(config.accessUsername)} IDENTIFIED WITH sha256_password BY ${sqlString(config.accessPassword)}`,
    );
    await command(
      `ALTER USER ${sqlIdentifier(config.writerUsername)} IDENTIFIED WITH sha256_password BY ${sqlString(config.writerPassword)}`,
    );
    await command(
      `ALTER USER ${sqlIdentifier(config.accessUsername)} IDENTIFIED WITH sha256_password BY ${sqlString(config.accessPassword)}`,
    );
    await command(`CREATE ROLE IF NOT EXISTS ${reader}`);
    await command(`CREATE ROLE IF NOT EXISTS ${vectorReader}`);
    await command(`GRANT ${reader} TO ${vectorReader}`);
    for (const [name, table] of Object.entries(traceTables)) {
      await command(
        `CREATE TABLE IF NOT EXISTS ${db}.${sqlIdentifier(name)} (${columns(table.columns)},revision Int64,generation Int64,deleted UInt8,fingerprint FixedString(64)) ENGINE=ReplacingMergeTree ORDER BY (${table.keys.map(sqlIdentifier).join(",")})`,
      );
    }
    await command(
      `CREATE TABLE IF NOT EXISTS ${db}.session_identities (organization_id String,session_id UUID) ENGINE=ReplacingMergeTree ORDER BY(organization_id,session_id)`,
    );
    await command(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.capture_session_identity TO ${db}.session_identities AS SELECT organization_id,session_id FROM ${db}.sessions`,
    );
    await command(
      `ALTER TABLE ${db}.messages ADD INDEX IF NOT EXISTS message_terms ${searchTermsSql("search_text")} TYPE text(tokenizer=splitByNonAlpha)`,
    );
    for (const [name, table] of Object.entries(traceTables))
      if (table.vector)
        await command(
          `ALTER TABLE ${db}.${sqlIdentifier(name)} ADD INDEX IF NOT EXISTS embedding_hnsw embedding TYPE vector_similarity('hnsw','cosineDistance',${String(EMBEDDING_DIMENSIONS)})`,
        );
    await command(
      `CREATE TABLE IF NOT EXISTS ${db}.audit_events (${columns(auditColumns)}) ENGINE=ReplacingMergeTree ORDER BY(organization_id,audit_id)`,
    );
    for (const [name, fields] of Object.entries(controlTables))
      await command(
        `CREATE OR REPLACE TABLE ${db}.${sqlIdentifier(`control_${name}`)} (${columns(fields)}) ${postgresSourceSql(config.postgresControlUrl, name, "engine")}`,
      );
    for (const table of retiredControlTables) {
      // Row policies outlive their table; drop them so SHOW ROW POLICIES stays truthful.
      for (const policy of ["trace_scope", "trace_internal"])
        await command(`DROP ROW POLICY IF EXISTS ${policy} ON ${db}.${table}`);
      await command(`DROP TABLE IF EXISTS ${db}.${table}`);
    }
    await command(`GRANT SELECT ON ${db}.* TO ${owner}`);
    await command(
      `GRANT SELECT,INSERT ON ${db}.session_identities TO ${sqlIdentifier(config.writerUsername)}`,
    );
    await command(`GRANT SELECT ON api_ro.* TO ${owner}`);
    await command(`GRANT SELECT ON system.columns TO ${owner}`);
    for (const table of [...Object.keys(traceTables), "audit_events"])
      await command(
        `GRANT SELECT,INSERT,ALTER DELETE ON ${db}.${sqlIdentifier(table)} TO ${sqlIdentifier(config.writerUsername)}`,
      );
    await command(
      `GRANT CREATE USER, ALTER USER ON *.* TO ${sqlIdentifier(config.accessUsername)}`,
    );
    await command(
      `GRANT ${reader},${vectorReader} TO ${sqlIdentifier(config.accessUsername)} WITH ADMIN OPTION`,
    );
    for (const query of securityStatements(config)) await command(query);
    for (const { name, sql, grant } of [
      ...baseViews(config.database),
      ...analyticsViews(config.database),
      ...searchViews(config.database),
      ...catalogViews(config.database),
    ]) {
      const view = `api_ro.${sqlIdentifier(name)}`;
      await command(
        `CREATE OR REPLACE VIEW ${view} DEFINER=${owner} SQL SECURITY DEFINER AS ${sql}`,
      );
      if (grant === "reader")
        await command(`GRANT SELECT ON ${view} TO ${reader}`);
      else if (grant === "vector") {
        // Earlier migrations granted vector views to every reader; converge before granting.
        await command(`REVOKE SELECT ON ${view} FROM ${reader}`);
        await command(`GRANT SELECT ON ${view} TO ${vectorReader}`);
      }
    }
  } finally {
    await client.close();
  }
}
