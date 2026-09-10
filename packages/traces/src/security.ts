import { postgresSourceSql } from "./postgres.js";
import { sqlIdentifier, sqlString } from "./client.js";
import { traceTables } from "./schema.js";
import { NO_TARGET_SESSION_ID, SESSION_READS_TABLE } from "./reads.js";
import { sessionScopeLookup, traceScopeSql } from "./control.js";
import type { TraceMigrationConfig } from "./config.js";

/**
 * The `trace_control.session_scope` columns ClickHouse reads, as ClickHouse types: the row
 * policies read publication, generation, purge and entitlement state, and the session views
 * read the compact metadata (parent link, lifecycle, ownership) for every visible session.
 * The migration mirrors them as the PostgreSQL-engine table `control_session_scope`, whose
 * reads push the caller's organization filter down to PostgreSQL (ADR 0062). Its own row
 * policy admits only the caller-visible sessions, so every policy and view that reads it
 * sees one set: published, unpurged public sessions for members, every published session
 * (including purged ones, for the skeleton) for admins.
 */
export const sessionScopeControlColumns = {
  organization_id: "String",
  session_id: "UUID",
  published_revision: "Int64",
  redaction_generation: "Int64",
  visible: "Int32",
  purged: "Int32",
  embedding_revision: "Int64",
  embedding_source_revision: "Int64",
  embeddings_enabled: "Int32",
  paid_embeddings: "Int32",
  parent_session_id: "Nullable(UUID)",
  parent_relation: "Nullable(String)",
  parent_native_ref: "Nullable(String)",
  parent_tool_use_id: "Nullable(String)",
  status: "String",
  ended_at: "Nullable(DateTime64(6,'UTC'))",
  last_activity_at: "DateTime64(6,'UTC')",
  visibility: "String",
  purged_at: "Nullable(DateTime64(6,'UTC'))",
  user_id: "String",
  harness: "String",
  harness_session_id: "String",
  ingest_api_key_id: "String",
  installation_id: "UUID",
  started_at: "DateTime64(6,'UTC')",
} as const;
/**
 * `trace_control.user_scope` and `trace_control.installation_scope`: the members and machines
 * with published sessions in an organization and whether any of those sessions is public.
 * Mirrored as `control_user_scope` and `control_installation_scope` so the session views
 * read member email/name and machine hostname once per query instead of once per row.
 */
export const userScopeControlColumns = {
  organization_id: "String",
  id: "String",
  present: "Int32",
  visible: "Int32",
  email: "String",
  name: "String",
} as const;
export const installationScopeControlColumns = {
  organization_id: "String",
  id: "UUID",
  present: "Int32",
  visible: "Int32",
  hostname: "String",
} as const;
export function securityStatements(config: TraceMigrationConfig): string[] {
  const db = sqlIdentifier(config.database);
  const owner = sqlIdentifier(`${config.database}_view_owner`);
  const writer = sqlIdentifier(config.writerUsername);
  const administrator = sqlIdentifier(config.username);
  const source = (table: string) =>
    postgresSourceSql(config.postgresControlUrl, table, "dictionary");
  const organization = `organization_id=${traceScopeSql.organization}`;
  const lookup = (key: string) => sessionScopeLookup(config.database, key);
  /** The session named by `key` is caller-visible and has a published revision. */
  const published = (key: string) =>
    `${lookup(key)("published_revision", "toInt64(0)")}>0`;
  /** The session named by `key` is caller-visible, published and not purged. */
  const live = (key: string) =>
    `${published(key)} AND ${lookup(key)("purged", "toInt64(1)")}=0`;
  const retained = (column: string) =>
    `${column}>=dictGet(${sqlString(`${config.database}.audit_retention`)},'retained_after',toUInt64(1))`;
  /** The caller-facing policy of one table plus the unconditional one of internal principals. */
  const policies = (table: string, predicate: string, internal: string[]) => [
    `CREATE ROW POLICY OR REPLACE trace_scope ON ${db}.${sqlIdentifier(table)} USING ${predicate} TO ${owner}`,
    `CREATE ROW POLICY OR REPLACE trace_internal ON ${db}.${sqlIdentifier(table)} USING 1 TO ${internal.join(",")}`,
  ];
  const statements = [
    `CREATE OR REPLACE DICTIONARY ${db}.session_scope (organization_id String,session_id UUID,published_revision Int64 DEFAULT 0,visible Int32 DEFAULT 0,purged Int32 DEFAULT 1,embedding_revision Int64 DEFAULT 0,embeddings_enabled Int32 DEFAULT 0,paid_embeddings Int32 DEFAULT 0,redaction_generation Int64 DEFAULT -1,embedding_source_revision Int64 DEFAULT 0,parent_session_id Nullable(UUID),parent_relation Nullable(String),parent_native_ref Nullable(String),parent_tool_use_id Nullable(String),status String,ended_at Nullable(DateTime64(6,'UTC')),last_activity_at DateTime64(6,'UTC'),visibility String,purged_at Nullable(DateTime64(6,'UTC')),user_id String,harness String,harness_session_id String,ingest_api_key_id String,installation_id UUID,started_at DateTime64(6,'UTC')) PRIMARY KEY organization_id,session_id ${source("session_scope")} LAYOUT(COMPLEX_KEY_DIRECT())`,
    `GRANT dictGet ON ${db}.session_scope TO ${owner}`,
    // Admins read the purge skeleton of published sessions from the identity relation.
    ...policies(
      "session_identities",
      `${organization} AND ${traceScopeSql.admin} AND ${published("session_id")} AND ${lookup("session_id")("purged", "toInt64(-1)")}=1`,
      [writer, administrator],
    ),
  ];
  for (const [table, { vector }] of Object.entries(traceTables)) {
    // Vector rows need the operator capability, organization opt-in (and the paid
    // entitlement in SaaS mode) and publish per embedding epoch: exactly the completed epoch
    // whose source is the published trace revision.
    const current = lookup("session_id");
    const revision = vector
      ? `${traceScopeSql.embeddings} AND revision=${current("embedding_revision", "toInt64(0)")} AND ${current("embedding_source_revision", "toInt64(-1)")}=${current("published_revision", "toInt64(0)")} AND ${current("embeddings_enabled", "toInt64(0)")}=1 AND (NOT ${traceScopeSql.saas} OR ${current("paid_embeddings", "toInt64(0)")}=1)`
      : `revision<=${current("published_revision", "toInt64(0)")}`;
    statements.push(
      ...policies(
        table,
        `${organization} AND revision>0 AND generation=${current("redaction_generation", "toInt64(-1)")} AND ${current("purged", "toInt64(1)")}=0 AND ${revision}`,
        [writer, administrator],
      ),
    );
  }
  // Member and installation metadata dictionaries; only installations also exist as a table.
  for (const [name, type, attributes] of [
    ["user", "String", "email String,name String"],
    ["installation", "UUID", "hostname String"],
  ] as const) {
    statements.push(
      `CREATE OR REPLACE DICTIONARY ${db}.${name}_scope (organization_id String,id ${type},present Int32 DEFAULT 0,visible Int32 DEFAULT 0,${attributes}) PRIMARY KEY organization_id,id ${source(`${name}_scope`)} LAYOUT(COMPLEX_KEY_DIRECT())`,
    );
    statements.push(`GRANT dictGet ON ${db}.${name}_scope TO ${owner}`);
  }
  // Installations are few, so their keyed lookup costs one round trip per query block.
  const installation = `dictGet(${sqlString(`${config.database}.installation_scope`)},('present','visible'),(organization_id,id))`;
  // Members and machines are visible once one of their sessions is; admins see them all.
  const memberVisible = `${organization} AND present=1 AND (${traceScopeSql.admin} OR visible=1)`;
  const controls = {
    control_installations: `${organization} AND tupleElement(${installation},1)=1 AND (${traceScopeSql.admin} OR tupleElement(${installation},2)=1)`,
    control_organization_settings: organization,
    control_metrics_members: `${organization} AND ${traceScopeSql.admin}`,
    control_metrics_health: `${organization} AND ${traceScopeSql.admin} AND ${published("session_id")}`,
    // The one definition of the caller-visible session set: every policy scalar and every
    // session view reads control through this policy, so a pushed-down caller predicate
    // never meets a hidden session's metadata.
    control_session_scope: `${organization} AND published_revision>0 AND (${traceScopeSql.admin} OR visible=1)`,
    control_user_scope: memberVisible,
    control_installation_scope: memberVisible,
  };
  for (const [table, condition] of Object.entries(controls))
    statements.push(...policies(table, condition, [administrator]));
  statements.push(
    `CREATE OR REPLACE DICTIONARY ${db}.audit_retention (id UInt64,retained_after DateTime64(6,'UTC') DEFAULT '2299-01-01 00:00:00') PRIMARY KEY id ${source("audit_retention")} LAYOUT(DIRECT())`,
    `GRANT dictGet ON ${db}.audit_retention TO ${owner}`,
    // Members see their own audit rows and successful reads of sessions visible to them.
    ...policies(
      "audit_events",
      `${organization} AND ${retained("ts")} AND (${traceScopeSql.admin} OR user_id=${traceScopeSql.user} OR (action='get' AND status_code<400 AND ${live("toUUIDOrZero(arrayElement(resource_ids,1))")}))`,
      [writer, administrator],
    ),
    // Attributed reads (ADR 0060) are fenced like the join they replace: the caller's
    // organization, audit retention, and a published, unpurged, caller-visible source
    // session and (unless the call named none) target session.
    ...policies(
      SESSION_READS_TABLE,
      `${organization} AND ${retained("read_at")} AND ${live("session_id")} AND (target_session_id=toUUID(${sqlString(NO_TARGET_SESSION_ID)}) OR ${live("target_session_id")})`,
      [writer, administrator],
    ),
  );
  return statements;
}
