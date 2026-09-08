ALTER TABLE public.raw_record ADD COLUMN redaction_context jsonb NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.raw_record.redaction_context IS 'Server-generated tool call digests, sensitivity classification, and redacted identity mappings. Never accepted from ingest JSON.';
ALTER TABLE public.ingest_batch DROP CONSTRAINT ingest_batch_pkey;
ALTER TABLE public.ingest_batch ADD PRIMARY KEY (organization_id, id);
