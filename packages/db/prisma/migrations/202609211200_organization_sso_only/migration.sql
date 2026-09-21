-- Per-organization SSO-only (ADR 0093, refines ADR 0091). When sso_only is set, password
-- credentials are refused for any email whose domain is one of the organization's enrolled,
-- verified Google sign-in domains. sso_revision is a dedicated version counter for the
-- dashboard: the existing `revision` column is an embeddings epoch and must not move for an
-- SSO change.
ALTER TABLE public.organization_settings
    ADD COLUMN sso_only boolean DEFAULT false NOT NULL,
    ADD COLUMN sso_revision integer DEFAULT 0 NOT NULL,
    ADD CONSTRAINT organization_settings_sso_revision_check CHECK ((sso_revision >= 0));
