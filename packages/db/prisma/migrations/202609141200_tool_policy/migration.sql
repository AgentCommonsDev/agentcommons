-- Tool and command policy (ADR 0080). Each organization gets one policy row: an enabled flag
-- and the ordered rules as data, seeded with the shipped preset disabled. A revision counter
-- lets the shim cache the document and re-parse only when it changes.
CREATE TABLE public.tool_policy (
    organization_id text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    rules jsonb DEFAULT '[]'::jsonb NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT tool_policy_pkey PRIMARY KEY (organization_id)
);
ALTER TABLE ONLY public.tool_policy
    ADD CONSTRAINT tool_policy_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);
CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.tool_policy FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.tool_policy TO ac_app;

-- Where a tool-policy rule matched a captured session, mirroring the redaction ledger: one
-- row per matched tool call, with the message's projected position (null for a metadata or
-- unpositioned call), the matched rule, decision and severity, whether the policy was enabled
-- at the time, and a masked preview plus salted fingerprint of the command. The raw command
-- is never stored. Rows hang off the session and go with it on purge.
CREATE TABLE public.tool_policy_violation (
    organization_id text NOT NULL,
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    source text NOT NULL,
    seq integer,
    harness public."Harness" NOT NULL,
    tool text NOT NULL,
    rule_id text,
    decision text NOT NULL,
    severity text,
    enforced boolean NOT NULL,
    masked_command text,
    fingerprint text,
    matched_at timestamp with time zone NOT NULL,
    CONSTRAINT tool_policy_violation_pkey PRIMARY KEY (id)
);
CREATE INDEX tool_policy_violation_organization_id_matched_at_idx ON public.tool_policy_violation USING btree (organization_id, matched_at);
CREATE INDEX tool_policy_violation_organization_id_session_id_idx ON public.tool_policy_violation USING btree (organization_id, session_id);
CREATE INDEX tool_policy_violation_organization_id_rule_id_matched_at_idx ON public.tool_policy_violation USING btree (organization_id, rule_id, matched_at);
-- No foreign key to trace_session_control: the pre-tool gate reports a blocked deny before the
-- session's first transcript is published, so a violation can precede its session control row.
-- The session is referenced by id and cleaned by session id on purge. Organization scope is
-- enforced by the tenant key and the organization foreign key.
ALTER TABLE ONLY public.tool_policy_violation
    ADD CONSTRAINT tool_policy_violation_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);
CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.tool_policy_violation FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();
GRANT SELECT,INSERT,DELETE ON TABLE public.tool_policy_violation TO ac_app;
