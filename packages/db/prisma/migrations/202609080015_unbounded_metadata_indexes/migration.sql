-- Full native metadata is retained. Hash indexes support equality without a
-- variable-width B-tree key; PostgreSQL rechecks equality on hash collisions.
DROP INDEX public.agent_session_repo_name_idx;
DROP INDEX public.agent_session_branch_idx;
DROP INDEX public.agent_session_repo_name_branch_started_at_idx;
CREATE INDEX agent_session_repo_name_idx ON public.agent_session USING hash(repo_name);
CREATE INDEX agent_session_branch_idx ON public.agent_session USING hash(branch);
-- Migration 010 already installed the authoritative canonical native-ID index.
-- The redundant plaintext unique index imposed an unrelated B-tree item limit.
DROP INDEX public.agent_session_organization_id_harness_harness_session_id_key;
-- Tool-name filters use normalized messages; a variable-width array GIN key
-- must not reject an otherwise valid native tool name.
DROP INDEX public.agent_session_tools_used_idx;
-- PostgreSQL marks convert_to STABLE because its general encoding argument may
-- vary. This wrapper fixes UTF-8, matching the existing canonical identity rule.
CREATE FUNCTION public.text_identity(value text) RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER PARALLEL SAFE
RETURN sha256(convert_to(value,'UTF8'));
REVOKE ALL ON FUNCTION public.text_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.text_identity(text) TO ac_app;
CREATE OR REPLACE FUNCTION public.native_identity(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER PARALLEL SAFE
RETURN CASE WHEN value ~ '^redacted-[a-f0-9]{64}$' THEN value
 ELSE 'redacted-'||encode(public.text_identity(value),'hex') END;
-- Prisma needs a representable row key. The UUID is internal; logical path
-- uniqueness remains (session, SHA-256 of the complete stored UTF-8 path).
ALTER TABLE public.session_file ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.session_file DROP CONSTRAINT session_file_pkey;
ALTER TABLE public.session_file ADD CONSTRAINT session_file_pkey PRIMARY KEY(id);
CREATE UNIQUE INDEX session_file_session_path_identity_key
 ON public.session_file(session_id,public.text_identity(path));
CREATE INDEX session_file_session_id_idx ON public.session_file(session_id);
