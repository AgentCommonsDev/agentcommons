import { sqlIdentifier, sqlString } from "../client.js";
import { controlTableSql } from "../control.js";
import {
  attributedReadSql,
  NO_TARGET_SESSION_ID,
  searchReadActions,
  SESSION_READS_TABLE,
} from "../reads.js";
import { sessionColumns, sessionReadColumns } from "../schema.js";
import {
  latestRowsSql,
  liveProjectionSql,
  sessionDetailColumns,
  sessionDetailsSql,
  sessionRelationSql,
  traceScopeSql,
  traceView,
  type TraceViewDefinition,
  type TraceViewGrant,
} from "./base.js";

/** Existing product metrics over the same native caller-visible trace relations. */
export function analyticsViews(database: string): TraceViewDefinition[] {
  const db = sqlIdentifier(database);
  const admin = traceScopeSql.admin;
  // The live caller-visible sessions. Views that read only projection columns take the
  // policy-filtered projection rows (no control join; the policy scalar is shared across the
  // query context); the two that need control-owned lifecycle columns take the full relation.
  const projection = `(${liveProjectionSql(database)})`;
  const control = `(${sessionRelationSql(database)})`;
  const definitions: TraceViewDefinition[] = [];
  const add = (name: string, query: string, grant?: TraceViewGrant) => {
    definitions.push(traceView(name, query, grant));
  };
  add("receipt_base", latestRowsSql(database, "ingest_receipts"), "internal");
  add(
    "receipt_redaction_base",
    latestRowsSql(database, "receipt_redactions"),
    "internal",
  );
  add("audit_base", `SELECT * FROM ${db}.audit_events FINAL`, "internal");
  add(
    "metrics_active_windows",
    `WITH lifecycle AS MATERIALIZED (SELECT * FROM api_ro.receipt_base WHERE behavior IN ('start','end') AND lifecycle_applied), states AS MATERIALIZED (
 SELECT b.session_id AS session_id,s.installation_id AS installation_id,b.receipt_id AS receipt_id,b.sent_at AS sent_at,b.behavior AS behavior,b.source_pos AS source_pos,s.started_at AS started_at,argMaxIf(tuple(l.behavior,l.source_pos,l.sent_at),tuple(l.source_pos,l.sent_at,l.receipt_id),l.receipt_id IS NOT NULL) AS lifecycle_state
 FROM api_ro.receipt_base b JOIN ${projection} s ON s.session_id=b.session_id LEFT JOIN lifecycle l ON l.session_id=b.session_id AND l.sent_at<=b.sent_at WHERE s.purged_at IS NULL AND (b.behavior NOT IN ('start','end') OR b.lifecycle_applied) GROUP BY b.session_id,s.installation_id,b.receipt_id,b.sent_at,b.behavior,b.source_pos,s.started_at
 ), observations AS (
 SELECT session_id,installation_id,started_at AS observed_at,'start' AS behavior,toInt64(-1) AS lifecycle_pos,started_at AS lifecycle_at FROM ${projection} WHERE purged_at IS NULL
 UNION ALL
 SELECT session_id,installation_id,sent_at AS observed_at,if(behavior IN ('start','end'),behavior,coalesce(tupleElement(lifecycle_state,1),'start')) AS behavior,if(behavior IN ('start','end'),source_pos,coalesce(tupleElement(lifecycle_state,2),toInt64(-1))) AS lifecycle_pos,if(behavior IN ('start','end'),sent_at,coalesce(tupleElement(lifecycle_state,3),started_at)) AS lifecycle_at FROM states
 ) SELECT o.session_id AS session_id,o.installation_id AS installation_id,o.observed_at AS active_from,least(o.observed_at+INTERVAL 6 HOUR,coalesce(tupleElement(argMinIf(tuple(l.sent_at),tuple(l.source_pos,l.sent_at,l.receipt_id),l.receipt_id IS NOT NULL),1),o.observed_at+INTERVAL 6 HOUR)) AS active_to FROM observations o LEFT JOIN lifecycle l ON l.session_id=o.session_id AND tuple(l.source_pos,l.sent_at)>tuple(o.lifecycle_pos,o.lifecycle_at) WHERE o.behavior='start' GROUP BY o.session_id,o.installation_id,o.observed_at,o.lifecycle_pos,o.lifecycle_at`,
  );
  // The audit row's actor and request columns as every audit-derived view projects them.
  const auditColumns = `a.audit_id AS id,a.ts AS ts,a.user_id AS user_id,a.user_email AS user_email,a.installation_id AS installation_id,a.transport AS transport,a.auth_method AS auth_method,a.action AS action`;
  // The session an audit row is about: its first resource id, else the named result field.
  const auditTarget = (field: string) =>
    `toUUIDOrZero(coalesce(nullIf(arrayElement(a.resource_ids,1),''),JSONExtractString(a.detail,'result',${sqlString(field)})))`;
  const resultIds = `if(notEmpty(a.resource_ids),arrayMap(x->toUUIDOrZero(x),a.resource_ids),arrayMap(x->toUUIDOrZero(JSONExtractString(x)),JSONExtractArrayRaw(a.detail,'result','session_ids')))`;
  add(
    "metrics_reads",
    `WITH visible_sessions AS MATERIALIZED (SELECT session_id,user_id,repo_name,purged_at FROM ${projection}) SELECT ${auditColumns},
 target.session_id AS target_session_id,target.user_id AS target_user_id,target.repo_name AS repo_name,
 arrayFilter(x->x IN (SELECT session_id FROM ${projection} WHERE purged_at IS NULL),${resultIds}) AS result_session_ids,
 top_result.session_id AS top_session_id,top_result.user_id AS top_user_id,
 if(JSONType(a.detail,'result','hits') IN ('Int64','UInt64','Float64'),toDecimal256OrNull(JSONExtractRaw(a.detail,'result','hits'),0),NULL) AS hits
 FROM api_ro.audit_base a
 LEFT ANY JOIN visible_sessions target ON a.action='get' AND target.session_id=${auditTarget("session_id")} AND target.purged_at IS NULL
 LEFT ANY JOIN visible_sessions top_result ON top_result.session_id=${auditTarget("top_session_id")} AND top_result.purged_at IS NULL
 WHERE a.status_code BETWEEN 200 AND 299 AND a.action IN ('search','get','sql') AND (a.action!='get' OR target.session_id IS NOT NULL) AND (${admin} OR a.action='get')`,
  );
  // An audit read credited to the session active on the calling installation (ADR 0060).
  // This is the one definition of an attribution: the audit projection worker reads it for
  // the rows it just projected and copies them into `session_reads`; every caller-facing
  // reuse relation aggregates that table instead of re-deriving the graph.
  const noTarget = `toUUID(${sqlString(NO_TARGET_SESSION_ID)})`;
  add(
    "attributed_reads",
    `SELECT DISTINCT a.audit_id AS audit_id,w.session_id AS session_id,a.ts AS read_at,a.action AS action,if(a.action='get',${auditTarget("session_id")},${noTarget}) AS target_session_id,a.user_id AS reader_user_id,a.user_email AS reader_email,s.harness AS reader_harness
 FROM api_ro.audit_base a JOIN api_ro.metrics_active_windows w ON w.installation_id=a.installation_id AND a.ts>=w.active_from AND a.ts<w.active_to JOIN ${projection} s ON s.session_id=w.session_id
 WHERE ${attributedReadSql("a")}`,
  );
  // Native row policies fence organization, retention and source/target visibility; the
  // organization predicate only narrows the scan to the caller's primary-key range.
  const reads = `SELECT ${Object.keys(sessionReadColumns).map(sqlIdentifier).join(",")} FROM ${db}.${sqlIdentifier(SESSION_READS_TABLE)} FINAL WHERE organization_id=${traceScopeSql.organization}`;
  // The target's owner comes from its latest projection row, two columns wide, under the same
  // policy scalar as every other read of this query; only the cross-user aggregates ask for it.
  const owners = latestRowsSql(database, "sessions", {
    organization_id: sessionColumns.organization_id,
    session_id: sessionColumns.session_id,
    user_id: sessionColumns.user_id,
  });
  const edgeCondition = (alias: string) =>
    `${alias}.action='get' AND ${alias}.target_session_id!=${alias}.session_id AND ${alias}.target_session_id!=${noTarget}`;
  const edgeRows = (owner: boolean) =>
    `SELECT r.session_id AS source_session_id,r.target_session_id AS target_session_id,r.read_at AS read_at,r.reader_user_id AS reader_user_id,r.reader_email AS reader_email,r.reader_harness AS reader_harness,r.audit_id AS audit_id${owner ? ",coalesce(t.user_id,'') AS target_user_id" : ""} FROM (${reads}) r${owner ? ` LEFT ANY JOIN (${owners}) t ON t.session_id=r.target_session_id` : ""} WHERE ${edgeCondition("r")}`;
  add(
    "reuse_edges",
    `SELECT source_session_id,target_session_id,read_at,reader_user_id,reader_email,reader_harness,audit_id FROM (${edgeRows(false)})`,
  );
  // The single aggregate behind `session_reuse` and `sessions.reuse_count`: distinct reading
  // sessions per target, plus the reader columns when a consumer needs them (they cost the
  // owner lookup, which `sessions` does not pay for its count alone).
  const reuseByTarget = (readers: boolean) =>
    `SELECT target_session_id AS session_id,uniqExact(source_session_id) AS reuse_count${readers ? ",uniqExact(reader_user_id) AS unique_readers,uniqExactIf(source_session_id,reader_user_id!=target_user_id) AS cross_user_reuse_count,max(read_at) AS last_reused_at" : ""} FROM (${edgeRows(readers)}) GROUP BY target_session_id`;
  add(
    "session_reuse",
    `SELECT s.session_id AS session_id,coalesce(r.reuse_count,toUInt64(0)) AS reuse_count,coalesce(r.unique_readers,toUInt64(0)) AS unique_readers,coalesce(r.cross_user_reuse_count,toUInt64(0)) AS cross_user_reuse_count,r.last_reused_at AS last_reused_at FROM ${projection} s LEFT ANY JOIN (${reuseByTarget(true)}) r ON r.session_id=s.session_id WHERE s.purged_at IS NULL`,
  );
  // One pass over the edges: each edge is credited to its target as incoming and to its
  // source as outgoing, then aggregated per member.
  add(
    "member_impact",
    `SELECT s.user_id AS user_id,uniqExactIf(s.session_id,e.side='in') AS sessions_reused_by_others,uniqExactIf(e.reader_user_id,e.side='in') AS distinct_readers,uniqExactIf(tuple(e.source_session_id,e.target_session_id),e.side='out') AS reuses_made
 FROM ${projection} s LEFT JOIN (SELECT source_session_id,target_session_id,reader_user_id,tupleElement(credit,1) AS side,tupleElement(credit,2) AS session_id FROM (${edgeRows(false)}) ARRAY JOIN [('in',target_session_id),('out',source_session_id)] AS credit) e ON e.session_id=s.session_id WHERE s.purged_at IS NULL GROUP BY s.user_id`,
  );
  // One pass over the stored reads per session: any edge marks it reused, an edge to another
  // member's session marks it cross-user, and any stored read is a qualifying call (the
  // policy already drops gets of hidden targets).
  add(
    "metrics_reuse_sessions",
    `SELECT s.session_id AS session_id,s.organization_id AS organization_id,s.started_at AS started_at,s.repo_name AS repo_name,s.user_id AS user_id,s.installation_id AS installation_id,toUInt8(coalesce(f.reused,0)) AS reused,toUInt8(coalesce(f.cross_user_reused,0)) AS cross_user_reused,if(${admin},toUInt8(coalesce(f.memory_assisted,0)),NULL) AS memory_assisted FROM ${projection} s LEFT ANY JOIN (SELECT r.session_id AS session_id,max(${edgeCondition("r")}) AS reused,maxIf(coalesce(t.user_id,'')!=r.reader_user_id,${edgeCondition("r")}) AS cross_user_reused,toUInt8(1) AS memory_assisted FROM (${reads}) r LEFT ANY JOIN (${owners}) t ON t.session_id=r.target_session_id GROUP BY r.session_id) f ON f.session_id=s.session_id WHERE s.purged_at IS NULL`,
  );
  add(
    "metrics_reuse_weekly",
    `SELECT toDate(toStartOfWeek(started_at,1,'UTC')) AS week,count() AS sessions,countIf(reused) AS reuse_sessions,countIf(cross_user_reused) AS cross_user_reuse_sessions,toFloat64(countIf(reused))/nullIf(count(),0) AS reuse_rate,toFloat64(countIf(cross_user_reused))/nullIf(count(),0) AS cross_user_reuse_rate FROM api_ro.metrics_reuse_sessions GROUP BY week`,
  );
  add(
    "metrics_health",
    `SELECT s.session_id AS session_id,s.started_at AS started_at,s.last_activity_at AS last_activity_at,s.repo_name AS repo_name,s.harness AS harness,s.user_id AS user_id,s.installation_id AS installation_id,toBool(h.authorization_blocked) AS authorization_blocked FROM ${control} s JOIN ${controlTableSql(database, "metrics_health")} h ON h.organization_id=s.organization_id AND h.session_id=s.session_id WHERE ${admin} AND s.purged_at IS NULL`,
  );
  add(
    "metrics_capture",
    `SELECT DISTINCT m.raw_record_id AS raw_record_id,s.session_id AS session_id,s.started_at AS started_at,s.repo_name AS repo_name,m.timestamp AS timestamp,m.received_at AS received_at,dateDiff('microsecond',m.timestamp,m.received_at)/1000000.0 AS latency_seconds FROM api_ro.message_metadata m JOIN ${projection} s ON s.session_id=m.session_id WHERE ${admin} AND s.purged_at IS NULL AND m.raw_record_id IS NOT NULL AND m.timestamp IS NOT NULL`,
  );
  add(
    "metrics_activity",
    `SELECT b.session_id AS session_id,b.installation_id AS installation_id,b.received_at AS received_at,s.repo_name AS repo_name FROM api_ro.receipt_base b JOIN ${projection} s ON s.session_id=b.session_id WHERE ${admin} AND s.purged_at IS NULL`,
  );
  add(
    "metrics_redaction",
    `SELECT e.policy_id AS policy_id,e.count AS count,b.received_at AS created_at,s.repo_name AS repo_name FROM api_ro.receipt_redaction_base e JOIN ${projection} s ON s.session_id=e.session_id JOIN api_ro.receipt_base b ON b.organization_id=e.organization_id AND b.receipt_id=e.receipt_id WHERE ${admin}`,
  );
  add(
    "metrics_members",
    `SELECT member_count FROM ${controlTableSql(database, "metrics_members")} WHERE organization_id=${traceScopeSql.organization} AND ${admin}`,
  );
  add(
    "audit_sources",
    `SELECT a.audit_id AS audit_id,tupleElement(argMin(tuple(s.repo_name),tuple(-toUnixTimestamp64Micro(w.active_from),s.session_id)),1) AS repo_name
 FROM api_ro.audit_base a JOIN api_ro.metrics_active_windows w ON w.installation_id=a.installation_id AND a.ts>=w.active_from AND a.ts<w.active_to JOIN ${projection} s ON s.session_id=w.session_id GROUP BY a.audit_id`,
    "internal",
  );
  add(
    "metrics_usage",
    `WITH reads AS MATERIALIZED (SELECT * FROM api_ro.metrics_reads), followthrough AS (SELECT a.id AS id,count(g.id)>0 AS followed_through FROM reads a LEFT JOIN reads g ON g.action='get' AND g.user_id=a.user_id AND isNotDistinctFrom(g.installation_id,a.installation_id) AND g.ts>a.ts AND g.ts<=a.ts+INTERVAL 10 MINUTE AND has(a.result_session_ids,g.target_session_id) GROUP BY a.id) SELECT a.id AS id,a.ts AS ts,a.user_id AS user_id,a.installation_id AS installation_id,a.transport AS transport,a.auth_method AS auth_method,a.action AS action,coalesce(source.repo_name,a.repo_name,top_result.repo_name) AS repo_name,a.hits AS hits,
 (a.top_user_id IS NOT NULL AND a.top_user_id!=a.user_id) AS cross_user_hit,
 coalesce(f.followed_through,false) AS followed_through
 FROM reads a LEFT JOIN followthrough f ON f.id=a.id LEFT JOIN api_ro.audit_sources source ON source.audit_id=a.id LEFT ANY JOIN ${projection} top_result ON top_result.session_id=a.top_session_id WHERE ${admin}`,
  );
  add(
    "metrics_mcp_calls",
    `SELECT a.audit_id AS id,a.ts AS ts,multiIf(a.action='sessions.visibility','set_visibility',a.action='sessions.purge','purge',a.action='audit.list','audit',a.action='mcp.call',JSONExtractString(a.detail,'input','name'),a.action) AS action,source.repo_name AS repo_name FROM api_ro.audit_base a LEFT JOIN api_ro.audit_sources source ON source.audit_id=a.audit_id
 WHERE ${admin} AND a.transport='mcp' AND (a.action IN ('search','get','sql','sessions.visibility','sessions.purge','audit.list','status') OR (a.action='mcp.call' AND JSONExtractString(a.detail,'input','name') IN ('search','get','sql','set_visibility','purge','audit','status')))`,
  );
  add(
    "metrics_dashboard",
    `SELECT a.audit_id AS id,a.ts AS ts,a.user_id AS user_id,a.action AS action,coalesce(target.repo_name,source.repo_name) AS repo_name FROM api_ro.audit_base a LEFT ANY JOIN ${projection} target ON target.session_id=toUUIDOrZero(coalesce(nullIf(arrayElement(a.resource_ids,1),''),nullIf(JSONExtractString(a.detail,'result','session_id'),''),JSONExtractString(a.detail,'result','top_session_id'))) AND target.purged_at IS NULL LEFT JOIN api_ro.audit_sources source ON source.audit_id=a.audit_id WHERE ${admin} AND a.auth_method='cookie' AND a.transport IN ('rest','web') AND a.status_code BETWEEN 200 AND 299`,
  );
  add(
    "metrics_own_zero_results",
    `SELECT audit_id AS search_id,ts AS searched_at,JSONExtractString(detail,'input','query') AS query FROM api_ro.audit_base WHERE user_id=${traceScopeSql.user} AND action='search' AND status_code=200 AND JSONExtractRaw(detail,'result','hits')='0' AND JSONType(detail,'input','query')='String'`,
  );
  // Pairs of visible sessions by different members on one repository within thirty days.
  const pairJoin = `FROM ${projection} s JOIN ${projection} other ON other.purged_at IS NULL AND other.session_id!=s.session_id AND other.repo_name=s.repo_name AND other.user_id!=s.user_id AND abs(dateDiff('second',other.started_at,s.started_at))<=2592000`;
  add(
    "outcome_duplicates",
    `SELECT DISTINCT session_id FROM (SELECT s.session_id AS session_id ${pairJoin} WHERE s.purged_at IS NULL AND s.first_prompt IS NOT NULL AND other.first_prompt IS NOT NULL AND 1-ngramDistanceUTF8(s.first_prompt,other.first_prompt)>0.6 UNION ALL SELECT s.session_id AS session_id ${pairJoin} JOIN api_ro.session_embeddings a ON a.session_id=s.session_id JOIN api_ro.session_embeddings b ON b.session_id=other.session_id WHERE s.purged_at IS NULL AND 1-cosineDistance(a.embedding,b.embedding)>0.6)`,
    "internal",
  );
  const command = `coalesce(nullIf(JSONExtractString(call.tool_input,'command'),''),JSONExtractString(call.tool_input,'cmd'))`;
  const messages = `(${latestRowsSql(database, "messages")})`;
  add(
    "outcome_reruns",
    `SELECT DISTINCT session_id FROM (SELECT session_id,command FROM (SELECT call.session_id AS session_id,call.message_id AS message_id,${command} AS command,tupleElement(argMin(tuple(result.content),tuple(result.seq,result.message_id)),1) AS result_content FROM ${messages} call LEFT JOIN ${messages} result ON result.session_id=call.session_id AND result.tool_use_id=call.tool_use_id AND result.kind='TOOL_RESULT' AND result.seq>call.seq WHERE call.kind='TOOL_USE' GROUP BY call.session_id,call.message_id,command) WHERE match(command,'(?i)(^|[[:space:];&|])(test|build|pytest|vitest|jest|tsc|make)([[:space:];&|]|$)') AND match(coalesce(result_content,''),'(?i)(^|[^a-z])(failed|failure|error|exit code[ :]+[1-9][0-9]*)([^a-z]|$)') GROUP BY session_id,command HAVING uniqExact(message_id)>=2)`,
    "internal",
  );
  add(
    "metrics_outcomes",
    `SELECT s.session_id AS session_id,s.started_at AS started_at,s.repo_name AS repo_name,i.tools_enabled AS tools_enabled,s.tool_call_count AS tool_call_count,toDecimal256(s.input_tokens,0)+toDecimal256(s.output_tokens,0) AS tokens,greatest(0,dateDiff('microsecond',s.started_at,coalesce(s.ended_at,s.last_activity_at))/1000000.0) AS duration_seconds,(s.ended_at IS NOT NULL AND JSONLength(s.observed_commits)>0) AS observed_commit,d.session_id IS NOT NULL AS near_duplicate,r.session_id IS NOT NULL AS rerun_loop FROM ${control} s JOIN api_ro.installations i ON i.installation_id=s.installation_id LEFT JOIN api_ro.outcome_duplicates d ON d.session_id=s.session_id LEFT JOIN api_ro.outcome_reruns r ON r.session_id=s.session_id WHERE ${admin} AND s.purged_at IS NULL`,
  );
  // Search adoption (ADR 0067): the `search` and `sql` reads credited to a session while it
  // was active, from the same attributed reads as reuse. Transcript tool names play no
  // part, so the count does not depend on how a user aliased the MCP server.
  add(
    "metrics_search_sessions",
    `SELECT s.session_id AS session_id,s.started_at AS started_at,s.repo_name AS repo_name,s.harness AS harness,s.user_id AS user_id,coalesce(t.calls,toUInt64(0)) AS agentcommons_search_calls,greatest(toInt64(coalesce(t.calls,0))-1,0) AS repeat_agentcommons_search_calls FROM ${projection} s LEFT ANY JOIN (SELECT r.session_id AS session_id,count() AS calls FROM (${reads}) r WHERE r.action IN (${searchReadActions.map(sqlString).join(",")}) GROUP BY r.session_id) t ON t.session_id=s.session_id WHERE s.purged_at IS NULL`,
  );
  // One query context: session details, the file and child aggregates and the reuse
  // aggregate all read the caller's control once through the shared policy scalar.
  add(
    "sessions",
    `SELECT ${sessionDetailColumns.map((name) => `d.${sqlIdentifier(name)} AS ${sqlIdentifier(name)}`).join(",")},coalesce(r.reuse_count,toUInt64(0)) AS reuse_count FROM (${sessionDetailsSql(database)}) d LEFT ANY JOIN (${reuseByTarget(false)}) r ON r.session_id=d.session_id`,
  );
  return definitions;
}
