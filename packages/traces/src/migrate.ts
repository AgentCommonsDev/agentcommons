import { postgresSourceSql } from "./postgres.js";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  CLICKHOUSE_PASSWORD_SUFFIX,
  createTraceClient,
  sqlIdentifier,
  sqlString,
} from "./client.js";
import {
  EMBEDDING_DIMENSIONS,
  traceTables,
  auditColumns,
  sessionReadColumns,
  messagesCurrentColumns,
  messagesCurrentMetadataColumns,
  MESSAGES_CURRENT_TABLE,
  MESSAGES_CURRENT_INDEX,
} from "./schema.js";
import { SESSION_READS_TABLE } from "./reads.js";
import {
  installationScopeControlColumns,
  securityStatements,
  sessionScopeControlColumns,
  userScopeControlColumns,
} from "./security.js";
import { currentBackfillSql } from "./repository.js";
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
  // Row policies and the session views read session control through this table (ADR 0062);
  // member and machine metadata come from the two scope tables once per query.
  session_scope: sessionScopeControlColumns,
  user_scope: userScopeControlColumns,
  installation_scope: installationScopeControlColumns,
} as const;
/** Control tables earlier migrations created and nothing reads; dropped so deployments converge. */
const retiredControlTables = ["control_users", "control_audit_retention"];
/**
 * `api_ro` views earlier migrations created and no view reads any more: the audit-derived
 * reuse graph (ADR 0060) and the internal reuse helpers every consumer now inlines so a
 * query reads control once per context.
 */
const retiredViews = [
  "get_reads",
  "session_reads_base",
  "reuse_edge_rows",
  "reuse_by_target",
  "reuse_source_flags",
  "memory_assisted_sessions",
];
const columns = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([name, type]) => `${sqlIdentifier(name)} ${type}`)
    .join(",");
/** Column of `messages` holding the inflection-normalized search tokens, computed once per row at write time. */
const SEARCH_TERMS_COLUMN = "search_terms";
/** Name of the text index over that column. */
const SEARCH_TERMS_INDEX = "message_terms";
/** Ledger name of the one-time rebuild of the published-only search corpus (ADR 0092). */
const MESSAGES_CURRENT_BACKFILL = "messages_current_v1";
const MESSAGE_PAYLOAD_BYTES_BACKFILL = "message_payload_bytes_v1";
const countSchema = z.array(z.object({ n: z.coerce.number() }));
/**
 * The normalized search terms of every message as a stored column plus its text index.
 * The normalizer (`searchTermsSql`, eight regex replacements per token) used to be the
 * indexed expression and the predicate `search_messages` evaluated per row on every
 * search: 27-31 s of work for 5.7 M tokens on two threads behind the 5 s reader limit.
 * As a MATERIALIZED column it runs once per inserted row; `search_messages` reads the
 * column and the index covers it. Backfills (`MATERIALIZE COLUMN` / `MATERIALIZE INDEX`)
 * run only when this migration created the column or the index, so re-running it is free.
 */
async function searchTermsStatements(
  client: ReturnType<typeof createTraceClient>,
  database: string,
): Promise<void> {
  const db = sqlIdentifier(database);
  const count = async (sql: string) => {
    const result = await client.query({ query: sql, format: "JSONEachRow" });
    return countSchema.parse(await result.json())[0]?.n ?? 0;
  };
  const expression = searchTermsSql("search_text");
  const column = sqlIdentifier(SEARCH_TERMS_COLUMN);
  const hadColumn = await count(
    `SELECT count() AS n FROM system.columns WHERE database=${sqlString(database)} AND table='messages' AND name=${sqlString(SEARCH_TERMS_COLUMN)}`,
  );
  await client.command({
    query: `ALTER TABLE ${db}.messages ADD COLUMN IF NOT EXISTS ${column} String MATERIALIZED ${expression}`,
  });
  if (!hadColumn)
    await client.command({
      query: `ALTER TABLE ${db}.messages MATERIALIZE COLUMN ${column}`,
    });
  // An index over the old expression (earlier releases) is replaced by one over the column.
  const staleIndex = await count(
    `SELECT count() AS n FROM system.data_skipping_indices WHERE database=${sqlString(database)} AND table='messages' AND name=${sqlString(SEARCH_TERMS_INDEX)} AND expr!=${sqlString(SEARCH_TERMS_COLUMN)}`,
  );
  if (staleIndex)
    await client.command({
      query: `ALTER TABLE ${db}.messages DROP INDEX IF EXISTS ${SEARCH_TERMS_INDEX}`,
    });
  const hadIndex = await count(
    `SELECT count() AS n FROM system.data_skipping_indices WHERE database=${sqlString(database)} AND table='messages' AND name=${sqlString(SEARCH_TERMS_INDEX)}`,
  );
  await client.command({
    query: `ALTER TABLE ${db}.messages ADD INDEX IF NOT EXISTS ${SEARCH_TERMS_INDEX} ${column} TYPE text(tokenizer=splitByNonAlpha)`,
  });
  if (!hadIndex)
    await client.command({
      query: `ALTER TABLE ${db}.messages MATERIALIZE INDEX ${SEARCH_TERMS_INDEX}`,
    });
}
/**
 * Metadata reads must not decompress payloads just to measure them (ADR 0096). The
 * ledger is written only after every historical part has the materialized scalar;
 * a crash after ADD COLUMN or during the mutation therefore retries the backfill.
 */
async function messagePayloadBytesStatements(
  client: ReturnType<typeof createTraceClient>,
  database: string,
): Promise<void> {
  const db = sqlIdentifier(database);
  const result = await client.query({
    query: `SELECT count() AS n FROM ${db}.backfills WHERE name=${sqlString(MESSAGE_PAYLOAD_BYTES_BACKFILL)}`,
    format: "JSONEachRow",
  });
  if ((countSchema.parse(await result.json())[0]?.n ?? 0) > 0) return;
  await client.command({
    query: `ALTER TABLE ${db}.messages ADD COLUMN IF NOT EXISTS payload_bytes UInt64 MATERIALIZED length(content)+length(tool_input)`,
  });
  await client.command({
    query: `ALTER TABLE ${db}.messages MATERIALIZE COLUMN payload_bytes SETTINGS mutations_sync=1`,
  });
  await client.command({
    query: `INSERT INTO ${db}.backfills VALUES (${sqlString(MESSAGE_PAYLOAD_BYTES_BACKFILL)},now64(6))`,
  });
}
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
    // An awaited, one-time materialization can scan the complete historical corpus.
    // This migration-only timeout does not alter any reader's five-second budget.
    request_timeout: 300000,
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
    // Columns added to the schema after a table's first CREATE: the declarative CREATE above is
    // a no-op on an existing table, so add them idempotently. Existing rows get the default.
    await command(
      `ALTER TABLE ${db}.sessions ADD COLUMN IF NOT EXISTS observed_branches Array(String) AFTER branch`,
    );
    await command(
      `CREATE TABLE IF NOT EXISTS ${db}.session_identities (organization_id String,session_id UUID) ENGINE=ReplacingMergeTree ORDER BY(organization_id,session_id)`,
    );
    await command(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.capture_session_identity TO ${db}.session_identities AS SELECT organization_id,session_id FROM ${db}.sessions`,
    );
    await searchTermsStatements(client, config.database);
    // The published-only search corpus (ADR 0092): one row per message keyed by identity and
    // versioned by revision, so a single FINAL scan resolves the latest published content.
    // Search reads this, not `messages`; the repository writes it at publish and the backfill
    // below rebuilds it from `messages` and control.
    await command(
      `CREATE TABLE IF NOT EXISTS ${db}.${sqlIdentifier(MESSAGES_CURRENT_TABLE)} (${columns(messagesCurrentColumns)},revision Int64,deleted UInt8,INDEX ${sqlIdentifier(MESSAGES_CURRENT_INDEX)} search_terms TYPE text(tokenizer=splitByNonAlpha)) ENGINE=ReplacingMergeTree(revision,deleted) ORDER BY (organization_id,session_id,message_id)`,
    );
    // Add the text index idempotently for a corpus an earlier release created without it.
    await command(
      `ALTER TABLE ${db}.${sqlIdentifier(MESSAGES_CURRENT_TABLE)} ADD INDEX IF NOT EXISTS ${sqlIdentifier(MESSAGES_CURRENT_INDEX)} search_terms TYPE text(tokenizer=splitByNonAlpha)`,
    );
    // The metadata columns came after the corpus's first CREATE (ADR 0098). Existing rows read
    // null until the worker's corpus reconcile copies them, which also covers rows an older
    // release publishes while this migration runs.
    for (const [name, type] of Object.entries(messagesCurrentMetadataColumns))
      await command(
        `ALTER TABLE ${db}.${sqlIdentifier(MESSAGES_CURRENT_TABLE)} ADD COLUMN IF NOT EXISTS ${sqlIdentifier(name)} ${type}`,
      );
    for (const [name, table] of Object.entries(traceTables))
      if (table.vector)
        await command(
          `ALTER TABLE ${db}.${sqlIdentifier(name)} ADD INDEX IF NOT EXISTS embedding_hnsw embedding TYPE vector_similarity('hnsw','cosineDistance',${String(EMBEDDING_DIMENSIONS)})`,
        );
    await command(
      `CREATE TABLE IF NOT EXISTS ${db}.audit_events (${columns(auditColumns)}) ENGINE=ReplacingMergeTree ORDER BY(organization_id,audit_id)`,
    );
    await command(
      `CREATE TABLE IF NOT EXISTS ${db}.${sqlIdentifier(SESSION_READS_TABLE)} (${columns(sessionReadColumns)}) ENGINE=ReplacingMergeTree ORDER BY(organization_id,session_id,audit_id)`,
    );
    // One-time derivations the API worker performs; a row names a completed one.
    await command(
      `CREATE TABLE IF NOT EXISTS ${db}.backfills (name String,completed_at DateTime64(6,'UTC')) ENGINE=ReplacingMergeTree ORDER BY name`,
    );
    await messagePayloadBytesStatements(client, config.database);
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
    for (const table of [
      ...Object.keys(traceTables),
      "audit_events",
      SESSION_READS_TABLE,
    ])
      await command(
        `GRANT SELECT,INSERT,ALTER DELETE ON ${db}.${sqlIdentifier(table)} TO ${sqlIdentifier(config.writerUsername)}`,
      );
    await command(
      `GRANT SELECT,INSERT ON ${db}.backfills TO ${sqlIdentifier(config.writerUsername)}`,
    );
    await command(
      `GRANT SELECT,INSERT,ALTER DELETE ON ${db}.${sqlIdentifier(MESSAGES_CURRENT_TABLE)} TO ${sqlIdentifier(config.writerUsername)}`,
    );
    await command(
      `GRANT CREATE USER, ALTER USER ON *.* TO ${sqlIdentifier(config.accessUsername)}`,
    );
    await command(
      `GRANT ${reader},${vectorReader} TO ${sqlIdentifier(config.accessUsername)} WITH ADMIN OPTION`,
    );
    for (const query of securityStatements(config)) await command(query);
    // Rebuild the published-only search corpus once (ADR 0092) before the search views point at
    // it, so search never reads an empty corpus. Guarded by the backfills ledger so a redeploy
    // does not rescan; the rebuild itself is idempotent, so an interrupted run retries safely.
    const backfilled = await client.query({
      query: `SELECT count() AS n FROM ${db}.backfills FINAL WHERE name=${sqlString(MESSAGES_CURRENT_BACKFILL)}`,
      format: "JSONEachRow",
    });
    if ((countSchema.parse(await backfilled.json())[0]?.n ?? 0) === 0) {
      await command(currentBackfillSql(config.database, false));
      await command(
        `INSERT INTO ${db}.backfills (name,completed_at) VALUES (${sqlString(MESSAGES_CURRENT_BACKFILL)},now64(6))`,
      );
    }
    for (const view of retiredViews)
      await command(`DROP VIEW IF EXISTS api_ro.${sqlIdentifier(view)}`);
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
