-- Reuse edges and aggregates depend on session_base, never on this enriched view.
CREATE OR REPLACE VIEW api_ro.sessions WITH (security_barrier = true) AS
SELECT base.*,coalesce(reuse.reuse_count,0::bigint) AS reuse_count
FROM api_ro.session_base base
LEFT JOIN api_ro.session_reuse reuse USING(session_id);
COMMENT ON COLUMN api_ro.sessions.reuse_count IS
  'Distinct caller-visible active sessions that read this session through an attributed key get operation.';
