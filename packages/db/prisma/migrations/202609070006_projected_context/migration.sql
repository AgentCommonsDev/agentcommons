ALTER TABLE public.agent_session ADD COLUMN projected_context jsonb NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.agent_session.projected_context IS 'Last successfully projected branch context; rescans rebuild it while a newer leaf is pending.';
