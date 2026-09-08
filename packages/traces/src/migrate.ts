import { postgresTlsSql } from "./postgres.js";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createTraceClient, sqlIdentifier, sqlString } from "./client.js";
import { traceTables, auditColumns } from "./schema.js";
import { controlAnalyticsTables } from "./views/control-analytics.js";
import { securityStatements } from "./security.js";
import { analyticsViews } from "./views/analytics.js";
import { baseViews } from "./views/base.js";
import { searchTermsSql, searchViews } from "./views/search.js";
import { catalogViews } from "./views/catalog.js";
import type { TraceMigrationConfig } from "./config.js";

export const CLICKHOUSE_IMAGE = "clickhouse/clickhouse-server:26.8.2.7";
const controlTables = {
  users: {
    id: "String",
    email: "String",
    name: "String",
    organization_id: "String",
  },
  installations: {
    organization_id: "String",
    id: "UUID",
    hostname: "String",
    os_user: "String",
    platform: "String",
    arch: "String",
    tools_enabled: "Int32",
    first_seen_at: "DateTime64(6,'UTC')",
    last_seen_at: "DateTime64(6,'UTC')",
  },
  organization_settings: {
    organization_id: "String",
    embeddings_enabled: "Int32",
    paid_embeddings: "Int32",
  },
} as const;
const columns = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([name, type]) => `${sqlIdentifier(name)} ${type}`)
    .join(",");
export async function migrateTraces(
  config: TraceMigrationConfig,
  additionalViews: readonly string[] = [],
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
  const owner = `${config.database}_view_owner`;
  const reader = `${config.database}_reader`;
  const command = (query: string) => client.command({ query });
  try {
    await command(`CREATE DATABASE IF NOT EXISTS ${db}`);
    await command("CREATE DATABASE IF NOT EXISTS api_ro");
    await command(
      `CREATE USER IF NOT EXISTS ${sqlIdentifier(owner)} IDENTIFIED WITH sha256_password BY ${sqlString(randomBytes(32).toString("hex"))} HOST NONE`,
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
    await command(`CREATE ROLE IF NOT EXISTS ${sqlIdentifier(reader)}`);
    await command(
      `CREATE ROLE IF NOT EXISTS ${sqlIdentifier(reader + "_vector")}`,
    );
    await command(
      `GRANT ${sqlIdentifier(reader)} TO ${sqlIdentifier(reader + "_vector")}`,
    );
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
    for (const table of ["message_chunks", "session_embeddings"])
      await command(
        `ALTER TABLE ${db}.${table} ADD INDEX IF NOT EXISTS embedding_hnsw embedding TYPE vector_similarity('hnsw','cosineDistance',1024)`,
      );
    await command(
      `CREATE TABLE IF NOT EXISTS ${db}.audit_events (${columns(auditColumns)}) ENGINE=ReplacingMergeTree ORDER BY(organization_id,audit_id)`,
    );
    const postgres = new URL(config.postgresControlUrl);
    const pgArguments = [
      `${postgres.hostname}:${postgres.port || "5432"}`,
      decodeURIComponent(postgres.pathname.slice(1)),
      null,
      decodeURIComponent(postgres.username),
      decodeURIComponent(postgres.password),
      "trace_control",
    ];
    for (const [name, fields] of Object.entries({
      ...controlTables,
      ...controlAnalyticsTables,
    })) {
      await command(
        `CREATE OR REPLACE TABLE ${db}.${sqlIdentifier(`control_${name}`)} (${columns(fields)}) ENGINE=PostgreSQL(${pgArguments.map((value, index) => sqlString(index === 2 ? name : (value ?? ""))).join(",")},${postgresTlsSql(config.postgresControlUrl, "engine")})`,
      );
    }
    await command(`GRANT SELECT ON ${db}.* TO ${sqlIdentifier(owner)}`);
    await command(
      `GRANT SELECT,INSERT ON ${db}.session_identities TO ${sqlIdentifier(config.writerUsername)}`,
    );
    await command(`GRANT SELECT ON api_ro.* TO ${sqlIdentifier(owner)}`);
    for (const table of [...Object.keys(traceTables), "audit_events"])
      await command(
        `GRANT SELECT,INSERT,ALTER DELETE ON ${db}.${sqlIdentifier(table)} TO ${sqlIdentifier(config.writerUsername)}`,
      );
    await command(
      `GRANT CREATE USER ON *.* TO ${sqlIdentifier(config.accessUsername)}`,
    );
    await command(
      `GRANT ${sqlIdentifier(reader)},${sqlIdentifier(reader + "_vector")} TO ${sqlIdentifier(config.accessUsername)} WITH ADMIN OPTION`,
    );
    for (const query of securityStatements(config)) await command(query);
    for (const query of [
      ...baseViews(config.database),
      ...analyticsViews(config.database),
      ...searchViews(config.database),
      ...additionalViews,
      ...catalogViews(config.database),
    ])
      await command(query);
    for (const name of [
      "sessions",
      "session_details",
      "session_state",
      "message_metadata",
      "messages",
      "raw_records",
      "session_files",
      "users",
      "repos",
      "installations",
      "session_tools",
      "session_observed_commits",
      "search_messages",
      "schema_columns",
      "schema_functions",
    ])
      await command(
        `GRANT SELECT ON api_ro.${sqlIdentifier(name)} TO ${sqlIdentifier(reader)}`,
      );
    for (const name of [
      "message_chunks",
      "session_embeddings",
      "similar_sessions",
    ])
      await command(
        `REVOKE SELECT ON api_ro.${sqlIdentifier(name)} FROM ${sqlIdentifier(reader)}`,
      );
    for (const name of [
      "message_chunks",
      "session_embeddings",
      "similar_sessions",
    ])
      await command(
        `GRANT SELECT ON api_ro.${sqlIdentifier(name)} TO ${sqlIdentifier(reader + "_vector")}`,
      );
  } finally {
    await client.close();
  }
}
