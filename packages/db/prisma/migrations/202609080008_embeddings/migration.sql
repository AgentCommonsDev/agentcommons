ALTER TABLE public.message_chunk ALTER COLUMN embedding DROP NOT NULL;
ALTER TABLE public.session_embedding ALTER COLUMN embedding DROP NOT NULL;
CREATE TABLE public.embedding_deployment (
  id integer PRIMARY KEY CHECK (id=1), provider text NOT NULL CHECK (provider IN ('openai','fake')),
  model text NOT NULL, dimensions integer NOT NULL CHECK (dimensions=1024)
);
CREATE TABLE public.embedding_state (
  organization_id text NOT NULL, session_id uuid NOT NULL, source_digest text NOT NULL,
  complete boolean NOT NULL DEFAULT false, lease_token uuid, lease_until timestamptz, updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id,session_id),
  CONSTRAINT embedding_state_organization_id_session_id_fkey FOREIGN KEY(organization_id,session_id)
    REFERENCES public.agent_session(organization_id,id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE public.embedding_budget (
  organization_id text NOT NULL REFERENCES public.organization(id), day date NOT NULL,
  reserved_tokens bigint NOT NULL DEFAULT 0 CHECK (reserved_tokens>=0),
  actual_tokens bigint NOT NULL DEFAULT 0 CHECK (actual_tokens>=0 AND actual_tokens<=reserved_tokens),
  cost_nano_dollars bigint NOT NULL DEFAULT 0 CHECK (cost_nano_dollars>=0),
  PRIMARY KEY(organization_id,day)
);
CREATE TABLE public.embedding_attempt (
  organization_id text NOT NULL, id uuid PRIMARY KEY, day date NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('index','query')),
  reserved_tokens integer NOT NULL CHECK (reserved_tokens>0), actual_tokens integer,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT embedding_attempt_organization_id_day_fkey FOREIGN KEY(organization_id,day)
    REFERENCES public.embedding_budget(organization_id,day) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX embedding_attempt_organization_id_day_idx ON public.embedding_attempt(organization_id,day);
CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.embedding_state FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();
CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.embedding_budget FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();
CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.embedding_attempt FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();
GRANT SELECT,INSERT,UPDATE,DELETE ON public.embedding_deployment, public.embedding_state, public.embedding_budget, public.embedding_attempt TO ac_app;
CREATE SCHEMA api_vector;
REVOKE ALL ON SCHEMA api_vector FROM PUBLIC;
CREATE VIEW api_vector.message_chunks WITH(security_barrier=true) AS
 SELECT c.* FROM public.message_chunk c JOIN api_ro.sessions s ON s.session_id=c.session_id
 WHERE current_setting('agentcommons.embeddings_enabled',true)='true' AND c.embedding IS NOT NULL;
CREATE VIEW api_vector.session_embeddings WITH(security_barrier=true) AS
 SELECT e.* FROM public.session_embedding e JOIN api_ro.sessions s ON s.session_id=e.session_id
 WHERE current_setting('agentcommons.embeddings_enabled',true)='true' AND e.embedding IS NOT NULL;
GRANT USAGE ON SCHEMA api_vector TO ac_reader_user,ac_reader_admin;
GRANT SELECT ON api_vector.message_chunks,api_vector.session_embeddings TO ac_reader_user,ac_reader_admin;
CREATE FUNCTION api_vector.input(value text) RETURNS public.vector
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER RETURN value::public.vector;
CREATE FUNCTION api_vector.cosine(left_vector public.vector,right_vector public.vector) RETURNS double precision
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER RETURN left_vector OPERATOR(public.<=>) right_vector;
REVOKE ALL ON FUNCTION api_vector.input(text),api_vector.cosine(public.vector,public.vector) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_vector.input(text),api_vector.cosine(public.vector,public.vector) TO ac_reader_user,ac_reader_admin;
CREATE FUNCTION api_ro.similar_sessions(source_session_id uuid,max_rows integer DEFAULT 5)
RETURNS TABLE(session_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=api_ro,pg_catalog AS $$
 SELECT candidate.session_id FROM api_vector.session_embeddings source
 JOIN api_vector.session_embeddings candidate ON candidate.session_id<>source.session_id
 WHERE source.session_id=source_session_id AND max_rows BETWEEN 1 AND 50
 ORDER BY api_vector.cosine(candidate.embedding,source.embedding),candidate.session_id LIMIT greatest(0,least(max_rows,50))
$$;
REVOKE ALL ON FUNCTION api_ro.similar_sessions(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_ro.similar_sessions(uuid,integer) TO ac_reader_user,ac_reader_admin;
COMMENT ON FUNCTION api_ro.similar_sessions(uuid,integer) IS 'Caller-visible similar sessions by cosine distance. max_rows is 1 to 50. Available only when enabled.';
CREATE OR REPLACE VIEW api_ro.schema_functions WITH(security_barrier=true) AS
SELECT p.proname::text AS function_name, pg_catalog.pg_get_function_arguments(p.oid) AS arguments,
 pg_catalog.pg_get_function_result(p.oid) AS result_type, pg_catalog.obj_description(p.oid,'pg_proc') AS description
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='api_ro' AND (p.proname<>'similar_sessions' OR current_setting('agentcommons.embeddings_enabled',true)='true');
