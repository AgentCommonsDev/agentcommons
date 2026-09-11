-- Redaction bookkeeping gains detail an admin can follow to the message: each receipt's
-- per-policy counter (redaction_event) is broken down into one row per message it touched,
-- with the message's projected position, or a null seq for hits on session metadata (git
-- fields, context, header text). run_id names the rescan that applied the hit, null at
-- capture. The rows hang off the counter so a policy deletion or purge removes them with
-- it. No redacted text is stored. Each rescan target also records how many redactions the
-- run applied to it, so a run lists the sessions it changed.
ALTER TABLE public.redaction_run_session ADD COLUMN redaction_count integer DEFAULT 0 NOT NULL;

CREATE TABLE public.redaction_hit (
    organization_id text NOT NULL,
    id uuid NOT NULL,
    ingest_batch_id uuid NOT NULL,
    session_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    run_id uuid,
    seq integer,
    count integer NOT NULL,
    redacted_at timestamp with time zone NOT NULL,
    CONSTRAINT redaction_hit_pkey PRIMARY KEY (id)
);
CREATE INDEX redaction_hit_organization_id_redacted_at_idx ON public.redaction_hit USING btree (organization_id, redacted_at);
CREATE INDEX redaction_hit_organization_id_run_id_session_id_idx ON public.redaction_hit USING btree (organization_id, run_id, session_id);
CREATE INDEX redaction_hit_ingest_batch_id_session_id_policy_id_idx ON public.redaction_hit USING btree (ingest_batch_id, session_id, policy_id);
ALTER TABLE ONLY public.redaction_hit
    ADD CONSTRAINT redaction_hit_ingest_batch_id_session_id_policy_id_fkey FOREIGN KEY (ingest_batch_id, session_id, policy_id) REFERENCES public.redaction_event(ingest_batch_id, session_id, policy_id) ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE ONLY public.redaction_hit
    ADD CONSTRAINT redaction_hit_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id);
CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.redaction_hit FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();
GRANT SELECT,INSERT,DELETE ON TABLE public.redaction_hit TO ac_app;

-- The summary windows sum receipts by arrival time and the run list orders by start time.
CREATE INDEX trace_receipt_organization_id_received_at_idx ON public.trace_receipt USING btree (organization_id, received_at);
CREATE INDEX redaction_run_organization_id_created_at_idx ON public.redaction_run USING btree (organization_id, created_at);
