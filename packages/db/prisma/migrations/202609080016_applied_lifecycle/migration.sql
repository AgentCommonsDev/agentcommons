ALTER TABLE public.ingest_batch ADD COLUMN lifecycle_applied boolean;
COMMENT ON COLUMN public.ingest_batch.lifecycle_applied IS 'Server decision from the same transaction that applied lifecycle state; false includes sync and ignored lifecycle receipts, null marks legacy receipts.';

CREATE OR REPLACE VIEW api_ro.metrics_active_windows WITH (security_barrier=true) AS
WITH lifecycle AS MATERIALIZED (
 SELECT b.* FROM public.ingest_batch b JOIN api_ro.session_base s ON s.session_id=b.session_id
 WHERE b.behavior IN ('start','end') AND (
  b.lifecycle_applied IS TRUE OR (b.lifecycle_applied IS NULL AND NOT EXISTS (
   SELECT 1 FROM public.ingest_batch earlier
   WHERE earlier.session_id=b.session_id AND earlier.behavior IN ('start','end')
    AND (earlier.received_at,earlier.id)<(b.received_at,b.id)
    AND (earlier.source_pos,earlier.sent_at)>=(b.source_pos,b.sent_at)
  ))
 )
), observations AS (
 SELECT s.session_id,s.installation_id,s.started_at AS observed_at,'start'::text AS behavior,
  -1::bigint AS lifecycle_pos,s.started_at AS lifecycle_at
 FROM api_ro.session_base s WHERE s.purged_at IS NULL
 UNION ALL
 SELECT s.session_id,s.installation_id,b.sent_at,
  CASE WHEN b.behavior IN ('start','end') THEN b.behavior ELSE coalesce(state.behavior,'start') END,
  CASE WHEN b.behavior IN ('start','end') THEN coalesce(b.source_pos,-1) ELSE coalesce(state.source_pos,-1) END,
  CASE WHEN b.behavior IN ('start','end') THEN b.sent_at ELSE coalesce(state.sent_at,s.started_at) END
 FROM public.ingest_batch b JOIN api_ro.session_base s ON s.session_id=b.session_id
 LEFT JOIN LATERAL (
  SELECT l.behavior,l.source_pos,l.sent_at FROM lifecycle l WHERE l.session_id=b.session_id AND l.sent_at<=b.sent_at
  ORDER BY l.source_pos DESC,l.sent_at DESC,l.id DESC LIMIT 1
 ) state ON true
 WHERE s.purged_at IS NULL AND (b.behavior NOT IN ('start','end') OR EXISTS(SELECT 1 FROM lifecycle l WHERE l.id=b.id AND l.organization_id=b.organization_id))
)
SELECT o.session_id,o.installation_id,o.observed_at AS active_from,
 least(o.observed_at+interval '6 hours',coalesce((SELECT l.sent_at FROM lifecycle l
 WHERE l.session_id=o.session_id AND (coalesce(l.source_pos,-1),l.sent_at)>(o.lifecycle_pos,o.lifecycle_at)
 ORDER BY l.source_pos,l.sent_at,l.id LIMIT 1),o.observed_at+interval '6 hours')) AS active_to
FROM observations o WHERE o.behavior='start';
