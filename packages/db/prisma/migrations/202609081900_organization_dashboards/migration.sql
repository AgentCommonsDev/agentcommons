-- Dashboards belong to the organization and are visible to every member (ADR 0048).
-- Personal dashboard profiles (ADR 0045) are replaced; their rows are dropped.
DROP TABLE public.dashboard_profile;
DROP FUNCTION public.prevent_dashboard_owner_reassignment();

CREATE FUNCTION public.prevent_dashboard_author_reassignment() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
BEGIN
  IF OLD.created_by_user_id IS DISTINCT FROM NEW.created_by_user_id THEN
    RAISE EXCEPTION 'Dashboard authorship is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE public.dashboard (
    id uuid NOT NULL,
    organization_id text NOT NULL,
    created_by_user_id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    definition jsonb NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT dashboard_revision_check CHECK ((revision >= 0))
);
ALTER TABLE ONLY public.dashboard
    ADD CONSTRAINT dashboard_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dashboard
    ADD CONSTRAINT dashboard_organization_id_id_key UNIQUE (organization_id, id);
CREATE INDEX dashboard_organization_id_name_idx ON public.dashboard USING btree (organization_id, name);
-- At most one organization default; the built-in overview applies when no row is flagged.
CREATE UNIQUE INDEX dashboard_default_per_organization ON public.dashboard USING btree (organization_id) WHERE is_default;
ALTER TABLE ONLY public.dashboard
    ADD CONSTRAINT dashboard_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);
ALTER TABLE ONLY public.dashboard
    ADD CONSTRAINT dashboard_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public."user"(id);
CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.dashboard FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();
CREATE TRIGGER author_immutable BEFORE UPDATE OF created_by_user_id ON public.dashboard FOR EACH ROW EXECUTE FUNCTION public.prevent_dashboard_author_reassignment();
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dashboard TO ac_app;
