-- Search input is private to its author, including on an organization Home page.
CREATE VIEW api_ro.metrics_own_zero_results WITH (security_barrier=true) AS
SELECT a.id AS search_id,a.ts AS searched_at,a.detail#>>'{input,query}' AS query
FROM public.audit_event a
WHERE a.organization_id=current_setting('agentcommons.organization_id',true)
  AND a.user_id=current_setting('agentcommons.user_id',true)
  AND a.action='search' AND a.status_code=200
  AND a.detail#>>'{result,hits}'='0'
  AND jsonb_typeof(a.detail#>'{input,query}')='string';
GRANT SELECT ON api_ro.metrics_own_zero_results TO ac_reader_user,ac_reader_admin;
COMMENT ON VIEW api_ro.metrics_own_zero_results IS 'The authenticated user''s redacted zero-result searches in the active organization; a missing trusted user setting exposes no rows.';
COMMENT ON COLUMN api_ro.metrics_own_zero_results.search_id IS 'Audit identifier of this user''s successful zero-result search.';
COMMENT ON COLUMN api_ro.metrics_own_zero_results.searched_at IS 'Server timestamp of this user''s search.';
COMMENT ON COLUMN api_ro.metrics_own_zero_results.query IS 'Redacted search text visible only to its author.';
