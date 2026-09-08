ALTER TABLE public.ingest_batch ADD COLUMN start_resume boolean NOT NULL DEFAULT false;
ALTER TABLE public.ingest_batch ADD CONSTRAINT ingest_batch_start_resume_check CHECK (NOT start_resume OR behavior='start');
ALTER TABLE public.message ALTER COLUMN raw_record_id DROP NOT NULL;
ALTER TABLE public.message ADD COLUMN ingest_batch_id uuid;
ALTER TABLE public.message ADD CONSTRAINT message_organization_id_session_id_ingest_batch_id_fkey
  FOREIGN KEY (organization_id,session_id,ingest_batch_id)
  REFERENCES public.ingest_batch(organization_id,session_id,id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE public.message ADD CONSTRAINT message_source_check CHECK (
  (raw_record_id IS NOT NULL AND ingest_batch_id IS NULL)
  OR (raw_record_id IS NULL AND ingest_batch_id IS NOT NULL AND role='SYSTEM' AND kind='META' AND NOT searchable AND block_index=0)
);
CREATE UNIQUE INDEX message_session_id_ingest_batch_id_key ON public.message(session_id,ingest_batch_id);
COMMENT ON COLUMN public.message.ingest_batch_id IS 'Receipt provenance for a server-derived lifecycle META message; exactly one of raw_record_id and ingest_batch_id is set.';
CREATE OR REPLACE VIEW api_ro.messages WITH (security_barrier = true) AS
SELECT m.id AS message_id, m.organization_id, m.session_id, m.raw_record_id, m.seq, m.block_index,
  m.role, m.kind, m.content, m.tool_name, m.tool_use_id, m.tool_input,
  m.model, m.timestamp, m.received_at, m.input_tokens, m.output_tokens,
  m.agent_id, m.searchable, m.search_text, m.search_tsv,
  s.title AS session_title, s.repo_name, s.branch, s.user_email, m.ingest_batch_id
FROM public.message m JOIN api_ro.sessions s ON s.session_id = m.session_id;
COMMENT ON COLUMN api_ro.messages.ingest_batch_id IS 'Accepted lifecycle receipt that generated this META message; null for native transcript messages.';
COMMENT ON COLUMN api_ro.messages.raw_record_id IS 'Redacted native source record; null only for receipt-backed lifecycle META messages.';
