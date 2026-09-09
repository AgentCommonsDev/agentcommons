import { postgresTlsSql } from "./postgres.js";
import { sqlIdentifier, sqlString } from "./client.js";
import { traceTables } from "./schema.js";
import { traceScopeSql } from "./views/base.js";
import type { TraceMigrationConfig } from "./config.js";

export function securityStatements(config: TraceMigrationConfig): string[] {
  const db = sqlIdentifier(config.database);
  const owner = sqlIdentifier(`${config.database}_view_owner`);
  const pg = new URL(config.postgresControlUrl);
  const source = `POSTGRESQL(HOST ${sqlString(pg.hostname)} PORT ${String(Number(pg.port || 5432))} DB ${sqlString(decodeURIComponent(pg.pathname.slice(1)))} USER ${sqlString(decodeURIComponent(pg.username))} PASSWORD ${sqlString(decodeURIComponent(pg.password))} SCHEMA 'trace_control' TABLE 'session_scope' ${postgresTlsSql(config.postgresControlUrl, "dictionary")})`;
  const dictionary = `${config.database}.session_scope`;
  const lookup = `dictGet(${sqlString(dictionary)},('published_revision','visible','purged','embedding_revision','embeddings_enabled','paid_embeddings','redaction_generation','embedding_source_revision'),(organization_id,session_id))`;
  const statements = [
    `CREATE OR REPLACE DICTIONARY ${db}.session_scope (organization_id String,session_id UUID,published_revision Int64 DEFAULT 0,visible Int32 DEFAULT 0,purged Int32 DEFAULT 1,embedding_revision Int64 DEFAULT 0,embeddings_enabled Int32 DEFAULT 0,paid_embeddings Int32 DEFAULT 0,redaction_generation Int64 DEFAULT -1,embedding_source_revision Int64 DEFAULT 0,parent_session_id Nullable(UUID),parent_relation Nullable(String),parent_native_ref Nullable(String),parent_tool_use_id Nullable(String),status String,ended_at Nullable(DateTime64(6,'UTC')),last_activity_at DateTime64(6,'UTC'),visibility String,purged_at Nullable(DateTime64(6,'UTC')),user_id String,harness String,harness_session_id String,ingest_api_key_id String,installation_id UUID,started_at DateTime64(6,'UTC')) PRIMARY KEY organization_id,session_id SOURCE(${source}) LAYOUT(COMPLEX_KEY_DIRECT())`,
    `GRANT dictGet ON ${db}.session_scope TO ${owner}`,
  ];
  statements.push(
    `CREATE ROW POLICY OR REPLACE trace_scope ON ${db}.session_identities USING organization_id=${traceScopeSql.organization} AND ${traceScopeSql.admin} AND tupleElement(${lookup},1)>0 AND tupleElement(${lookup},3)=1 TO ${owner}`,
    `CREATE ROW POLICY OR REPLACE trace_internal ON ${db}.session_identities USING 1 TO ${sqlIdentifier(config.writerUsername)},${sqlIdentifier(config.username)}`,
  );
  for (const table of Object.keys(traceTables)) {
    const vector = table === "message_chunks" || table === "session_embeddings";
    const visible = `organization_id=${traceScopeSql.organization} AND generation=tupleElement(${lookup},7) AND revision>0 AND ${vector ? `revision=tupleElement(${lookup},4)` : `revision<=tupleElement(${lookup},1)`} AND (${traceScopeSql.admin} OR tupleElement(${lookup},2)=1) AND tupleElement(${lookup},3)=0${vector ? ` AND ${traceScopeSql.embeddings} AND tupleElement(${lookup},8)=tupleElement(${lookup},1) AND revision<=tupleElement(${lookup},4) AND tupleElement(${lookup},5)=1 AND (arrayElement(splitByChar('_',currentUser()),6)!='s' OR tupleElement(${lookup},6)=1)` : ""}`;
    statements.push(
      `CREATE ROW POLICY OR REPLACE trace_scope ON ${db}.${sqlIdentifier(table)} USING ${visible} TO ${owner}`,
    );
    statements.push(
      `CREATE ROW POLICY OR REPLACE trace_internal ON ${db}.${sqlIdentifier(table)} USING 1 TO ${sqlIdentifier(config.writerUsername)},${sqlIdentifier(config.username)}`,
    );
  }
  for (const [name, type] of [
    ["user", "String"],
    ["installation", "UUID"],
  ] as const) {
    const nameSql = sqlString(config.database + "." + name + "_scope");
    const metadataSource = source.replace(
      "TABLE 'session_scope'",
      `TABLE '${name}_scope'`,
    );
    statements.push(
      `CREATE OR REPLACE DICTIONARY ${db}.${name}_scope (organization_id String,id ${type},present Int32 DEFAULT 0,visible Int32 DEFAULT 0,${name === "user" ? "email String,name String" : "hostname String"}) PRIMARY KEY organization_id,id SOURCE(${metadataSource}) LAYOUT(COMPLEX_KEY_DIRECT())`,
    );
    statements.push(`GRANT dictGet ON ${db}.${name}_scope TO ${owner}`);
    const metadata = `dictGet(${nameSql},('present','visible'),(organization_id,id))`;
    const table = name === "user" ? "control_users" : "control_installations";
    statements.push(
      `CREATE ROW POLICY OR REPLACE trace_scope ON ${db}.${table} USING organization_id=${traceScopeSql.organization} AND tupleElement(${metadata},1)=1 AND (${traceScopeSql.admin} OR tupleElement(${metadata},2)=1) TO ${owner}`,
    );
    statements.push(
      `CREATE ROW POLICY OR REPLACE trace_internal ON ${db}.${table} USING 1 TO ${sqlIdentifier(config.username)}`,
    );
  }
  const controls = {
    control_organization_settings: `organization_id=${traceScopeSql.organization}`,
    control_metrics_members: `organization_id=${traceScopeSql.organization} AND ${traceScopeSql.admin}`,
    control_metrics_health: `organization_id=${traceScopeSql.organization} AND ${traceScopeSql.admin} AND tupleElement(${lookup},1)>0 AND (${traceScopeSql.admin} OR tupleElement(${lookup},2)=1)`,
  };
  for (const [table, condition] of Object.entries(controls)) {
    statements.push(
      `CREATE ROW POLICY OR REPLACE trace_scope ON ${db}.${table} USING ${condition} TO ${owner}`,
    );
    statements.push(
      `CREATE ROW POLICY OR REPLACE trace_internal ON ${db}.${table} USING 1 TO ${sqlIdentifier(config.username)}`,
    );
  }
  const retentionSource = `POSTGRESQL(HOST ${sqlString(pg.hostname)} PORT ${String(Number(pg.port || 5432))} DB ${sqlString(decodeURIComponent(pg.pathname.slice(1)))} USER ${sqlString(decodeURIComponent(pg.username))} PASSWORD ${sqlString(decodeURIComponent(pg.password))} SCHEMA 'trace_control' TABLE 'audit_retention' ${postgresTlsSql(config.postgresControlUrl, "dictionary")})`;
  statements.push(
    `CREATE OR REPLACE DICTIONARY ${db}.audit_retention (id UInt64,retained_after DateTime64(6,'UTC') DEFAULT '2299-01-01 00:00:00') PRIMARY KEY id SOURCE(${retentionSource}) LAYOUT(DIRECT())`,
  );
  statements.push(`GRANT dictGet ON ${db}.audit_retention TO ${owner}`);
  const target = `dictGet(${sqlString(dictionary)},('published_revision','visible'),(organization_id,toUUIDOrZero(arrayElement(resource_ids,1))))`;
  statements.push(
    `CREATE ROW POLICY OR REPLACE trace_scope ON ${db}.audit_events USING organization_id=${traceScopeSql.organization} AND ts>=dictGet(${sqlString(config.database + ".audit_retention")},'retained_after',toUInt64(1)) AND (${traceScopeSql.admin} OR user_id=${traceScopeSql.user} OR (action='get' AND status_code<400 AND tupleElement(${target},1)>0 AND tupleElement(${target},2)=1)) TO ${owner}`,
  );
  statements.push(
    `CREATE ROW POLICY OR REPLACE trace_internal ON ${db}.audit_events USING 1 TO ${sqlIdentifier(config.writerUsername)},${sqlIdentifier(config.username)}`,
  );
  return statements;
}
