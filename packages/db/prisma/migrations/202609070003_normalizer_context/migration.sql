ALTER TABLE public.agent_session ADD COLUMN normalizer_context jsonb NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.agent_session.normalizer_context IS 'Redacted adapter context for deterministic projection and rescan; not exposed through api_ro.';
