CREATE TABLE public.redaction_run (
  organization_id text NOT NULL REFERENCES public.organization(id),
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  total_sessions integer NOT NULL CHECK (total_sessions >= 0),
  processed_sessions integer NOT NULL DEFAULT 0 CHECK (processed_sessions BETWEEN 0 AND total_sessions),
  redaction_count integer NOT NULL DEFAULT 0 CHECK (redaction_count >= 0),
  error text,
  PRIMARY KEY (organization_id,id)
);
CREATE TABLE public.redaction_run_session (
  organization_id text NOT NULL,
  run_id uuid NOT NULL,
  session_id uuid NOT NULL,
  processed_at timestamptz,
  PRIMARY KEY (organization_id,run_id,session_id),
  CONSTRAINT redaction_run_session_run_fkey FOREIGN KEY (organization_id,run_id)
    REFERENCES public.redaction_run(organization_id,id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT redaction_run_session_session_fkey FOREIGN KEY (organization_id,session_id)
    REFERENCES public.agent_session(organization_id,id)
);
CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.redaction_run
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();
CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.redaction_run_session
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();
COMMENT ON TABLE public.redaction_run IS 'Organization-scoped rescan progress; pg-boss owns job delivery and retries.';
COMMENT ON TABLE public.redaction_run_session IS 'Snapshot of rescan targets with atomic completion checkpoints; no transcript contents.';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.redaction_run, public.redaction_run_session TO ac_app;
