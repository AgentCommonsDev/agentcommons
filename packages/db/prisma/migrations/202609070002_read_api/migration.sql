-- Views deliberately use the owner's table privileges. CURRENT_USER still names
-- the caller; security_invoker views would require leaking base-table grants.
CREATE ROLE ac_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
CREATE ROLE ac_reader_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
CREATE ROLE ac_reader_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO ac_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ac_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ac_app;
REVOKE UPDATE ON public.audit_event FROM ac_app;
REVOKE UPDATE, DELETE ON public.api_key_owner FROM ac_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ac_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ac_app;
ALTER ROLE ac_reader_user SET search_path = api_ro;
ALTER ROLE ac_reader_admin SET search_path = api_ro;
ALTER ROLE ac_reader_user SET default_transaction_read_only = on;
ALTER ROLE ac_reader_admin SET default_transaction_read_only = on;
ALTER ROLE ac_reader_user SET statement_timeout = '5s';
ALTER ROLE ac_reader_admin SET statement_timeout = '5s';
ALTER ROLE ac_reader_user SET work_mem = '16MB';
ALTER ROLE ac_reader_admin SET work_mem = '16MB';
ALTER ROLE ac_reader_user SET temp_file_limit = '64MB';
ALTER ROLE ac_reader_admin SET temp_file_limit = '64MB';

CREATE SCHEMA api_ro;
REVOKE ALL ON SCHEMA api_ro FROM PUBLIC;
GRANT USAGE ON SCHEMA api_ro TO ac_reader_user, ac_reader_admin;

CREATE VIEW api_ro.sessions WITH (security_barrier = true) AS
WITH visible AS MATERIALIZED (
  SELECT * FROM public.agent_session
  WHERE organization_id = current_setting('agentcommons.organization_id', true)
    AND ((visibility = 'PUBLIC' AND purged_at IS NULL) OR current_user = 'ac_reader_admin')
)
SELECT s.id AS session_id, s.organization_id, s.harness, s.harness_session_id, s.harness_version,
  s.entrypoint, s.user_id, s.ingest_api_key_id, s.installation_id,
  s.cwd, s.repo_root, s.cwd_relative, s.repo_url, s.repo_name, s.branch,
  s.start_commit, s.end_commit, s.observed_commits, s.observed_diff_stat,
  s.dirty_file_count, s.model, s.models_used, s.started_at, s.ended_at,
  s.last_activity_at, s.status, s.end_reason, s.title, s.first_prompt,
  p.id AS parent_session_id,
  CASE WHEN p.id IS NOT NULL THEN s.parent_relation END AS parent_relation,
  CASE WHEN current_user = 'ac_reader_admin' THEN s.parent_native_ref END AS parent_native_ref,
  s.agent_type, s.visibility, s.purged_at, s.purged_by_user_id, s.purge_reason,
  s.message_count, s.tool_call_count, s.input_tokens, s.output_tokens, s.tools_used,
  u.email AS user_email, u.name AS user_name, i.hostname AS installation_hostname,
  p.title AS parent_title,
  (SELECT count(*) FROM visible c WHERE c.parent_session_id = s.id) AS child_count,
  extract(epoch FROM (coalesce(s.ended_at, s.last_activity_at) - s.started_at)) AS duration_seconds,
  (SELECT count(*) FROM public.session_file f WHERE f.session_id = s.id) AS file_count,
  CASE WHEN jsonb_typeof(s.observed_commits) = 'array' THEN jsonb_array_length(s.observed_commits) ELSE 0 END AS observed_commit_count
FROM visible s
JOIN public."user" u ON u.id = s.user_id
JOIN public.installation i ON i.organization_id = s.organization_id AND i.id = s.installation_id
LEFT JOIN visible p ON p.id = s.parent_session_id;

CREATE VIEW api_ro.messages WITH (security_barrier = true) AS
SELECT m.id AS message_id, m.organization_id, m.session_id, m.raw_record_id, m.seq, m.block_index,
  m.role, m.kind, m.content, m.tool_name, m.tool_use_id, m.tool_input,
  m.model, m.timestamp, m.received_at, m.input_tokens, m.output_tokens,
  m.agent_id, m.searchable, m.search_text, m.search_tsv,
  s.title AS session_title, s.repo_name, s.branch, s.user_email
FROM public.message m JOIN api_ro.sessions s ON s.session_id = m.session_id;

CREATE VIEW api_ro.session_files WITH (security_barrier = true) AS
SELECT f.organization_id, f.session_id, f.path, f.ops
FROM public.session_file f JOIN api_ro.sessions s ON s.session_id = f.session_id;

CREATE VIEW api_ro.session_observed_commits WITH (security_barrier = true) AS
SELECT s.organization_id, s.session_id, c.ordinality AS ordinal, c.value ->> 'sha' AS sha,
  c.value ->> 'subject' AS subject, c.value ->> 'author' AS author,
  c.value ->> 'timestamp' AS timestamp
FROM api_ro.sessions s CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(s.observed_commits) = 'array' THEN s.observed_commits ELSE '[]'::jsonb END
) WITH ORDINALITY c(value, ordinality);

CREATE VIEW api_ro.session_tools WITH (security_barrier = true) AS
SELECT s.organization_id, s.session_id, t.tool_name
FROM api_ro.sessions s CROSS JOIN LATERAL unnest(s.tools_used) t(tool_name);

CREATE VIEW api_ro.users WITH (security_barrier = true) AS
SELECT DISTINCT u.id, u.email, u.name
FROM public."user" u JOIN api_ro.sessions s ON s.user_id = u.id;

CREATE VIEW api_ro.installations WITH (security_barrier = true) AS
SELECT i.organization_id, i.id AS installation_id, i.hostname, i.os_user, i.platform, i.arch,
  min(s.started_at) AS first_seen_at, max(s.last_activity_at) AS last_seen_at,
  count(*) AS session_count
FROM public.installation i JOIN api_ro.sessions s ON s.organization_id = i.organization_id AND s.installation_id = i.id
GROUP BY i.organization_id, i.id;

CREATE VIEW api_ro.repos WITH (security_barrier = true) AS
SELECT organization_id, repo_name, min(repo_url) AS repo_url, count(*) AS session_count,
  count(DISTINCT user_id) AS user_count, min(started_at) AS first_seen_at,
  max(last_activity_at) AS last_activity_at
FROM api_ro.sessions WHERE repo_name IS NOT NULL GROUP BY organization_id, repo_name;

CREATE FUNCTION api_ro.search_messages(q text)
RETURNS TABLE(session_id uuid, seq integer, rank real)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = api_ro, pg_catalog AS $$
  SELECT m.session_id, m.seq, ts_rank_cd(m.search_tsv, query, 33) AS rank
  FROM api_ro.messages m CROSS JOIN LATERAL (
    SELECT websearch_to_tsquery('english', q) || websearch_to_tsquery('simple', q) AS query
  ) search
  WHERE m.searchable AND m.search_tsv @@ query
$$;
COMMENT ON FUNCTION api_ro.search_messages(text) IS
  'Uncapped lexical matches over visible searchable messages. Compose with session filters; order by rank DESC, session_id, seq.';

CREATE VIEW api_ro.schema_columns WITH (security_barrier = true) AS
SELECT c.relname::text AS view_name, a.attname::text AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnum::integer AS ordinal_position,
  pg_catalog.col_description(c.oid, a.attnum) AS description
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'api_ro' AND c.relkind = 'v' AND a.attnum > 0 AND NOT a.attisdropped;

CREATE VIEW api_ro.schema_functions WITH (security_barrier = true) AS
SELECT p.proname::text AS function_name,
  pg_catalog.pg_get_function_arguments(p.oid) AS arguments,
  pg_catalog.pg_get_function_result(p.oid) AS result_type,
  pg_catalog.obj_description(p.oid, 'pg_proc') AS description
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'api_ro';

DO $$
DECLARE col record;
BEGIN
  FOR col IN SELECT view_name, column_name FROM api_ro.schema_columns LOOP
    EXECUTE format('COMMENT ON COLUMN api_ro.%I.%I IS %L', col.view_name, col.column_name,
      replace(col.column_name, '_', ' ') || ' for caller-visible ' || replace(col.view_name, '_', ' ') || '.');
  END LOOP;
END $$;
COMMENT ON COLUMN api_ro.sessions.parent_session_id IS 'Immediate parent session ID when visible; NULL for a hidden or unresolved parent. Never reparented.';
COMMENT ON COLUMN api_ro.sessions.parent_title IS 'Title of the immediate caller-visible parent; NULL when hidden, unresolved, or untitled.';
COMMENT ON COLUMN api_ro.sessions.child_count IS 'Count of immediate caller-visible children.';
COMMENT ON COLUMN api_ro.sessions.observed_commits IS 'Commits observed between start and end; not attributed to the agent.';
COMMENT ON COLUMN api_ro.messages.seq IS 'Dense session ordinal in source position and block-index order, independent of arrival order.';
COMMENT ON COLUMN api_ro.messages.search_tsv IS 'Generated weighted English and exact-token vectors over search_text.';
COMMENT ON COLUMN api_ro.messages.timestamp IS 'Source timestamp, NULL when absent or invalid. Never record identity.';
COMMENT ON COLUMN api_ro.installations.first_seen_at IS 'Earliest caller-visible session start for this installation.';
COMMENT ON COLUMN api_ro.installations.last_seen_at IS 'Most recent caller-visible receipt for this installation.';

GRANT SELECT ON ALL TABLES IN SCHEMA api_ro TO ac_reader_user, ac_reader_admin;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api_ro FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA api_ro TO ac_reader_user, ac_reader_admin;
