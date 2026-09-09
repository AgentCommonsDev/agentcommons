-- Which tool call spawned a child session is recorded only in the parent transcript
-- (Claude Code: the `Agent` result's `toolUseResult.agentId`; Codex: the
-- `SubAgentActivity` `started` item). The child keeps the projected identity of that
-- call, and a spawn row waits for a child that has not been ingested yet, so the link
-- resolves in either arrival order exactly like parent_session_id.
ALTER TABLE public.trace_session_control ADD COLUMN parent_tool_use_id character varying(73);

CREATE TABLE public.trace_spawn_control (
    organization_id text NOT NULL,
    parent_session_id uuid NOT NULL,
    child_native_identity character varying(73) NOT NULL,
    tool_use_id character varying(73) NOT NULL,
    CONSTRAINT trace_spawn_control_pkey PRIMARY KEY (organization_id, parent_session_id, child_native_identity)
);
ALTER TABLE ONLY public.trace_spawn_control
    ADD CONSTRAINT trace_spawn_control_organization_id_parent_session_id_fkey FOREIGN KEY (organization_id, parent_session_id) REFERENCES public.trace_session_control(organization_id, id) ON UPDATE CASCADE ON DELETE CASCADE;
CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.trace_spawn_control FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.trace_spawn_control TO ac_app;

-- The control dictionary view gains the column at the end; ClickHouse reads it by name.
CREATE OR REPLACE VIEW trace_control.session_scope WITH (security_barrier='true') AS
 SELECT c.organization_id,
    c.id AS session_id,
    c.published_revision,
    c.redaction_generation,
    (((c.visibility = 'PUBLIC'::public."Visibility") AND (c.purged_at IS NULL)))::integer AS visible,
    ((c.purged_at IS NOT NULL))::integer AS purged,
    COALESCE(c.embedding_revision, (0)::bigint) AS embedding_revision,
    COALESCE(c.embedding_source_revision, (0)::bigint) AS embedding_source_revision,
    COALESCE(s.embeddings_enabled, 0) AS embeddings_enabled,
    COALESCE(s.paid_embeddings, 0) AS paid_embeddings,
    c.parent_session_id,
    (c.parent_relation)::text AS parent_relation,
    c.parent_native_ref,
    (c.status)::text AS status,
    c.ended_at,
    c.last_activity_at,
    (c.visibility)::text AS visibility,
    c.purged_at,
    c.user_id,
    (c.harness)::text AS harness,
    c.harness_session_id,
    c.ingest_api_key_id,
    c.installation_id,
    c.started_at,
    (c.parent_tool_use_id)::text AS parent_tool_use_id
   FROM (public.trace_session_control c
     LEFT JOIN trace_control.organization_settings s ON ((s.organization_id = c.organization_id)));
