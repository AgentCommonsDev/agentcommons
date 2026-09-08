ALTER TABLE public.installation ADD COLUMN tools_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.audit_event ADD COLUMN installation_id uuid;
ALTER TABLE public.audit_event ADD CONSTRAINT audit_event_installation_scope
  CHECK (installation_id IS NULL OR organization_id IS NOT NULL);
ALTER TABLE public.audit_event ADD CONSTRAINT audit_event_organization_id_installation_id_fkey
  FOREIGN KEY (organization_id, installation_id)
  REFERENCES public.installation(organization_id,id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX ingest_batch_organization_id_api_key_id_received_at_id_idx
  ON public.ingest_batch(organization_id,api_key_id,received_at DESC,id DESC);
CREATE INDEX audit_event_organization_id_installation_id_ts_idx
  ON public.audit_event(organization_id,installation_id,ts DESC);

-- The visible-session join retains the existing tenancy and private-session boundary.
CREATE OR REPLACE VIEW api_ro.installations WITH (security_barrier = true) AS
SELECT i.organization_id, i.id AS installation_id, i.hostname, i.os_user, i.platform, i.arch,
  min(s.started_at) AS first_seen_at, max(s.last_activity_at) AS last_seen_at,
  count(*) AS session_count, i.tools_enabled
FROM public.installation i JOIN api_ro.sessions s
  ON s.organization_id=i.organization_id AND s.installation_id=i.id
GROUP BY i.organization_id,i.id;
COMMENT ON COLUMN api_ro.installations.tools_enabled IS
  'Whether MCP tools are enabled for keys whose latest organization ingest used this installation; capture remains enabled.';
