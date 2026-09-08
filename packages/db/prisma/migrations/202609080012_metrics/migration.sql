ALTER VIEW api_ro.sessions RENAME TO session_base;
CREATE VIEW api_ro.sessions WITH(security_barrier=true) AS SELECT * FROM api_ro.session_base;
GRANT SELECT ON api_ro.sessions TO ac_reader_user,ac_reader_admin;
-- Public metrics derive both source and target identities from the visible set.
-- No request text or private audit detail is exposed by these views.
CREATE VIEW api_ro.metrics_active_windows WITH (security_barrier=true) AS
WITH lifecycle AS MATERIALIZED (
 SELECT b.* FROM public.ingest_batch b JOIN api_ro.session_base s ON s.session_id=b.session_id
 WHERE b.behavior IN ('start','end') AND NOT EXISTS (
  SELECT 1 FROM public.ingest_batch earlier
  WHERE earlier.session_id=b.session_id AND earlier.behavior IN ('start','end')
   AND (earlier.received_at,earlier.id)<(b.received_at,b.id)
   AND (earlier.source_pos,earlier.sent_at)>=(b.source_pos,b.sent_at)
 )
), observations AS (
 SELECT s.session_id,s.installation_id,s.started_at AS observed_at,'start'::text AS behavior
 FROM api_ro.session_base s WHERE s.purged_at IS NULL
 UNION ALL
 SELECT s.session_id,s.installation_id,b.sent_at,coalesce((
  SELECT l.behavior FROM lifecycle l WHERE l.session_id=b.session_id AND l.sent_at<=b.sent_at
  ORDER BY l.source_pos DESC,l.sent_at DESC,l.id DESC LIMIT 1
 ),'start')
 FROM public.ingest_batch b JOIN api_ro.session_base s ON s.session_id=b.session_id
 WHERE s.purged_at IS NULL AND (b.behavior NOT IN ('start','end') OR EXISTS(SELECT 1 FROM lifecycle l WHERE l.id=b.id AND l.organization_id=b.organization_id))
)
SELECT o.session_id,o.installation_id,o.observed_at AS active_from,
 least(o.observed_at+interval '6 hours',coalesce((SELECT min(l.sent_at) FROM lifecycle l
 WHERE l.session_id=o.session_id AND l.behavior='end' AND l.sent_at>=o.observed_at),o.observed_at+interval '6 hours')) AS active_to
FROM observations o WHERE o.behavior='start';

CREATE VIEW api_ro.metrics_reads WITH (security_barrier=true) AS
SELECT a.id,a.ts,a.user_id,a.installation_id,a.transport,a.auth_method,a.action,
 target.session_id AS target_session_id,target.user_id AS target_user_id,target.repo_name,
 ARRAY(SELECT s.session_id FROM api_ro.session_base s WHERE s.purged_at IS NULL
   AND (s.session_id::text=ANY(a.resource_ids) OR (cardinality(a.resource_ids)=0 AND (a.detail->'result'->'session_ids') ? s.session_id::text)) ORDER BY s.session_id) AS result_session_ids,
 top_result.session_id AS top_session_id,top_result.user_id AS top_user_id,
 CASE WHEN jsonb_typeof(a.detail->'result'->'hits')='number' THEN (a.detail->'result'->>'hits')::numeric END AS hits
FROM public.audit_event a
LEFT JOIN api_ro.session_base target ON a.action='get' AND target.session_id::text=coalesce(a.resource_ids[1],a.detail->'result'->>'session_id') AND target.purged_at IS NULL
LEFT JOIN api_ro.session_base top_result ON top_result.session_id::text=coalesce(a.resource_ids[1],a.detail->'result'->>'top_session_id') AND top_result.purged_at IS NULL
WHERE a.organization_id=current_setting('agentcommons.organization_id',true)
 AND a.status_code BETWEEN 200 AND 299 AND a.action IN ('search','get','sql')
 AND (a.action<>'get' OR target.session_id IS NOT NULL)
 AND (current_user='ac_reader_admin' OR a.action='get');

CREATE VIEW api_ro.reuse_edges WITH(security_barrier=true) AS
SELECT DISTINCT s.session_id AS source_session_id,a.target_session_id,a.ts AS read_at,
 a.user_id AS reader_user_id,u.email AS reader_email,s.harness AS reader_harness,a.id AS audit_id
FROM api_ro.session_base s JOIN api_ro.metrics_reads a ON a.installation_id=s.installation_id
JOIN public."user" u ON u.id=a.user_id
WHERE s.purged_at IS NULL AND a.action='get' AND a.auth_method='key' AND a.transport IN ('mcp','rest')
 AND a.target_session_id<>s.session_id AND EXISTS(SELECT 1 FROM api_ro.metrics_active_windows w
 WHERE w.session_id=s.session_id AND a.ts>=w.active_from AND a.ts<w.active_to);

CREATE VIEW api_ro.session_reuse WITH(security_barrier=true) AS
SELECT s.session_id,count(DISTINCT e.source_session_id) AS reuse_count,
 count(DISTINCT e.reader_user_id) AS unique_readers,
 count(DISTINCT e.source_session_id) FILTER(WHERE e.reader_user_id<>s.user_id) AS cross_user_reuse_count,
 max(e.read_at) AS last_reused_at
FROM api_ro.session_base s LEFT JOIN api_ro.reuse_edges e ON e.target_session_id=s.session_id
WHERE s.purged_at IS NULL GROUP BY s.session_id;

CREATE VIEW api_ro.member_impact WITH(security_barrier=true) AS
SELECT s.user_id,count(DISTINCT s.session_id) FILTER(WHERE incoming.source_session_id IS NOT NULL) AS sessions_reused_by_others,
 count(DISTINCT incoming.reader_user_id) AS distinct_readers,
 count(DISTINCT (outgoing.source_session_id,outgoing.target_session_id)) FILTER(WHERE outgoing.source_session_id IS NOT NULL) AS reuses_made
FROM api_ro.session_base s
LEFT JOIN api_ro.reuse_edges incoming ON incoming.target_session_id=s.session_id
LEFT JOIN api_ro.reuse_edges outgoing ON outgoing.source_session_id=s.session_id
WHERE s.purged_at IS NULL GROUP BY s.user_id;

CREATE VIEW api_ro.metrics_reuse_sessions WITH (security_barrier=true) AS
SELECT s.session_id,s.organization_id,s.started_at,s.repo_name,s.user_id,s.installation_id,
 EXISTS(SELECT 1 FROM api_ro.reuse_edges e WHERE e.source_session_id=s.session_id) AS reused,
 EXISTS(SELECT 1 FROM api_ro.reuse_edges e JOIN api_ro.session_base target ON target.session_id=e.target_session_id
 WHERE e.source_session_id=s.session_id AND target.user_id<>e.reader_user_id) AS cross_user_reused,
 CASE WHEN current_user='ac_reader_admin' THEN EXISTS(SELECT 1 FROM api_ro.metrics_reads a JOIN api_ro.metrics_active_windows w ON w.session_id=s.session_id
  WHERE a.installation_id=s.installation_id AND a.auth_method='key' AND a.transport IN ('mcp','rest')
   AND a.ts>=w.active_from AND a.ts<w.active_to) ELSE NULL END AS memory_assisted
FROM api_ro.session_base s WHERE s.purged_at IS NULL;

CREATE VIEW api_ro.metrics_reuse_weekly WITH (security_barrier=true) AS
SELECT date_trunc('week',started_at AT TIME ZONE 'UTC')::date AS week,count(*) AS sessions,
 count(*) FILTER(WHERE reused) AS reuse_sessions,count(*) FILTER(WHERE cross_user_reused) AS cross_user_reuse_sessions,
 count(*) FILTER(WHERE reused)::double precision/nullif(count(*),0) AS reuse_rate,
 count(*) FILTER(WHERE cross_user_reused)::double precision/nullif(count(*),0) AS cross_user_reuse_rate
FROM api_ro.metrics_reuse_sessions GROUP BY 1;

CREATE VIEW api_ro.metrics_health WITH (security_barrier=true) AS
SELECT s.session_id,s.started_at,s.last_activity_at,s.repo_name,s.harness,s.user_id,s.installation_id,
 (k.id IS NULL OR k.enabled IS NOT TRUE OR (k."expiresAt" IS NOT NULL AND k."expiresAt"<=now())
  OR NOT coalesce(k.permissions::jsonb->'sessions' ? 'ingest',false)
  OR m.id IS NULL OR m.suspended IS TRUE OR u.banned IS TRUE) AS authorization_blocked
FROM api_ro.session_base s LEFT JOIN public.apikey k ON k.id=s.ingest_api_key_id
LEFT JOIN public.member m ON m."organizationId"=s.organization_id AND m."userId"=s.user_id
LEFT JOIN public."user" u ON u.id=s.user_id
WHERE current_user='ac_reader_admin' AND s.purged_at IS NULL;

CREATE VIEW api_ro.metrics_capture WITH (security_barrier=true) AS
SELECT DISTINCT m.raw_record_id,s.session_id,s.started_at,s.repo_name,m.timestamp,m.received_at,
 extract(epoch FROM m.received_at-m.timestamp)::double precision AS latency_seconds
FROM api_ro.messages m JOIN api_ro.session_base s ON s.session_id=m.session_id
WHERE current_user='ac_reader_admin' AND s.purged_at IS NULL AND m.raw_record_id IS NOT NULL AND m.timestamp IS NOT NULL;

CREATE VIEW api_ro.metrics_activity WITH (security_barrier=true) AS
SELECT b.session_id,b.installation_id,b.received_at,s.repo_name
FROM public.ingest_batch b JOIN api_ro.session_base s ON s.session_id=b.session_id
WHERE current_user='ac_reader_admin' AND s.purged_at IS NULL;

CREATE VIEW api_ro.metrics_redaction WITH (security_barrier=true) AS
SELECT e.policy_id,e.count,b.received_at AS created_at,s.repo_name
FROM public.redaction_event e JOIN api_ro.session_base s ON s.session_id=e.session_id
JOIN public.ingest_batch b ON b.organization_id=e.organization_id AND b.id=e.ingest_batch_id
WHERE current_user='ac_reader_admin';

CREATE VIEW api_ro.metrics_members WITH (security_barrier=true) AS
SELECT count(*) AS member_count FROM public.member
WHERE "organizationId"=current_setting('agentcommons.organization_id',true) AND current_user='ac_reader_admin';

CREATE VIEW api_ro.metrics_usage WITH (security_barrier=true) AS
SELECT a.id,a.ts,a.user_id,a.installation_id,a.transport,a.auth_method,a.action,
 coalesce(source.repo_name,a.repo_name,top_result.repo_name) AS repo_name,a.hits,
 (a.top_user_id IS NOT NULL AND a.top_user_id<>a.user_id) AS cross_user_hit,
 EXISTS(SELECT 1 FROM api_ro.metrics_reads g WHERE g.action='get' AND g.user_id=a.user_id
  AND g.installation_id IS NOT DISTINCT FROM a.installation_id AND g.ts>a.ts AND g.ts<=a.ts+interval '10 minutes'
  AND g.target_session_id=ANY(a.result_session_ids)) AS followed_through
FROM api_ro.metrics_reads a
LEFT JOIN LATERAL (SELECT s.repo_name FROM api_ro.session_base s JOIN api_ro.metrics_active_windows w ON w.session_id=s.session_id
 WHERE s.installation_id=a.installation_id AND a.ts>=w.active_from AND a.ts<w.active_to ORDER BY w.active_from DESC,s.session_id LIMIT 1) source ON true
LEFT JOIN api_ro.session_base top_result ON top_result.session_id=a.top_session_id
WHERE current_user='ac_reader_admin';

CREATE VIEW api_ro.metrics_mcp_calls WITH (security_barrier=true) AS
SELECT a.id,a.ts,CASE a.action WHEN 'sessions.visibility' THEN 'set_visibility' WHEN 'sessions.purge' THEN 'purge'
 WHEN 'audit.list' THEN 'audit' WHEN 'mcp.call' THEN a.detail->'input'->>'name' ELSE a.action END AS action,source.repo_name FROM public.audit_event a
LEFT JOIN LATERAL (SELECT s.repo_name FROM api_ro.session_base s JOIN api_ro.metrics_active_windows w ON w.session_id=s.session_id
 WHERE s.installation_id=a.installation_id AND a.ts>=w.active_from AND a.ts<w.active_to ORDER BY w.active_from DESC,s.session_id LIMIT 1) source ON true
WHERE a.organization_id=current_setting('agentcommons.organization_id',true) AND current_user='ac_reader_admin'
 AND a.transport='mcp' AND (a.action IN ('search','get','sql','sessions.visibility','sessions.purge','audit.list','status')
 OR (a.action='mcp.call' AND a.detail->'input'->>'name' IN ('search','get','sql','set_visibility','purge','audit','status')));

CREATE VIEW api_ro.metrics_dashboard WITH(security_barrier=true) AS
SELECT a.id,a.ts,a.user_id,a.action,coalesce(target.repo_name,source.repo_name) AS repo_name
FROM public.audit_event a LEFT JOIN api_ro.session_base target ON target.session_id::text=coalesce(a.resource_ids[1],a.detail->'result'->>'session_id',a.detail->'result'->>'top_session_id') AND target.purged_at IS NULL
LEFT JOIN LATERAL (SELECT s.repo_name FROM api_ro.session_base s JOIN api_ro.metrics_active_windows w ON w.session_id=s.session_id
 WHERE s.installation_id=a.installation_id AND a.ts>=w.active_from AND a.ts<w.active_to ORDER BY w.active_from DESC,s.session_id LIMIT 1) source ON true
WHERE a.organization_id=current_setting('agentcommons.organization_id',true) AND current_user='ac_reader_admin'
 AND a.auth_method='cookie' AND a.transport IN ('rest','web') AND a.status_code BETWEEN 200 AND 299;

CREATE VIEW api_ro.metrics_outcomes WITH (security_barrier=true) AS
SELECT s.session_id,s.started_at,s.repo_name,i.tools_enabled,s.tool_call_count,
 s.input_tokens::numeric+s.output_tokens::numeric AS tokens,greatest(0,s.duration_seconds) AS duration_seconds,
 (s.ended_at IS NOT NULL AND s.observed_commit_count>0) AS observed_commit,
 EXISTS(SELECT 1 FROM api_ro.session_base other WHERE other.purged_at IS NULL AND other.session_id<>s.session_id
  AND other.repo_name=s.repo_name AND other.user_id<>s.user_id AND abs(extract(epoch FROM other.started_at-s.started_at))<=2592000
  AND ((s.first_prompt IS NOT NULL AND other.first_prompt IS NOT NULL AND public.similarity(s.first_prompt,other.first_prompt)>0.6::real)
   OR (current_setting('agentcommons.embeddings_enabled',true)='true' AND EXISTS(
    SELECT 1 FROM api_vector.session_embeddings a JOIN api_vector.session_embeddings b ON b.session_id=other.session_id
    WHERE a.session_id=s.session_id AND 1-api_vector.cosine(a.embedding,b.embedding)>0.6)))) AS near_duplicate,
 EXISTS(SELECT 1 FROM api_ro.messages call JOIN LATERAL (
  SELECT result.content FROM api_ro.messages result WHERE result.session_id=call.session_id
   AND result.tool_use_id=call.tool_use_id AND result.kind='TOOL_RESULT' AND result.seq>call.seq ORDER BY result.seq LIMIT 1
 ) result ON true
  WHERE call.session_id=s.session_id AND call.kind='TOOL_USE'
   AND coalesce(call.tool_input->>'command',call.tool_input->>'cmd','') ~* '(^|[[:space:];&|])(test|build|pytest|vitest|jest|tsc|make)([[:space:];&|]|$)'
   AND result.content ~* '(^|[^a-z])(failed|failure|error|exit code[ :]+[1-9][0-9]*)([^a-z]|$)'
  GROUP BY coalesce(call.tool_input->>'command',call.tool_input->>'cmd','') HAVING count(DISTINCT call.message_id)>=2) AS rerun_loop
FROM api_ro.session_base s JOIN api_ro.installations i ON i.installation_id=s.installation_id
WHERE current_user='ac_reader_admin' AND s.purged_at IS NULL;

GRANT SELECT ON api_ro.reuse_edges,api_ro.session_reuse,api_ro.member_impact,api_ro.metrics_active_windows,api_ro.metrics_reads,api_ro.metrics_reuse_sessions,
 api_ro.metrics_reuse_weekly,api_ro.metrics_health,api_ro.metrics_capture,api_ro.metrics_activity,api_ro.metrics_redaction,
 api_ro.metrics_members,api_ro.metrics_usage,api_ro.metrics_mcp_calls,api_ro.metrics_dashboard,api_ro.metrics_outcomes TO ac_reader_user,ac_reader_admin;
COMMENT ON VIEW api_ro.metrics_reuse_weekly IS 'UTC ISO-week reuse among caller-visible nonpurged sessions. Source and target must both be visible; repeated reads count once per source session.';
COMMENT ON VIEW api_ro.metrics_outcomes IS 'Current tools_enabled cohorts; comparisons are observational, not causal. Re-run loops require repeated test/build commands with paired failing text evidence.';
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT view_name,column_name FROM api_ro.schema_columns WHERE description IS NULL LOOP
  EXECUTE format('COMMENT ON COLUMN api_ro.%I.%I IS %L',c.view_name,c.column_name,coalesce(CASE WHEN c.view_name='sessions' THEN (SELECT pg_catalog.col_description('api_ro.session_base'::regclass,a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid='api_ro.session_base'::regclass AND a.attname=c.column_name) END,replace(c.column_name,'_',' ')||' in caller-visible organization metrics.'));
 END LOOP;
END $$;

CREATE OR REPLACE VIEW api_ro.schema_columns WITH(security_barrier=true) AS
SELECT c.relname::text AS view_name,a.attname::text AS column_name,pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
 a.attnum::integer AS ordinal_position,pg_catalog.col_description(c.oid,a.attnum) AS description
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
WHERE n.nspname='api_ro' AND c.relkind='v' AND c.relname<>'session_base' AND a.attnum>0 AND NOT a.attisdropped;
