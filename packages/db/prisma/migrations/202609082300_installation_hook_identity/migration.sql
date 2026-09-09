-- Every ingest envelope carries the shim's bundle digest; the server keeps the
-- current digest per installation so admins can see which devices run a stale hook.
ALTER TABLE public.installation ADD COLUMN hook_sha256 text;

-- CREATE OR REPLACE VIEW can only append columns, so the control view is recreated
-- to keep hook_sha256 next to the other installation attributes. Nothing in
-- PostgreSQL depends on the view; ClickHouse reads it through the PostgreSQL engine.
DROP VIEW trace_control.installations;
CREATE VIEW trace_control.installations WITH (security_barrier='true') AS
 SELECT organization_id,
    id,
    hostname,
    os_user,
    platform,
    arch,
    hook_sha256,
    (tools_enabled)::integer AS tools_enabled,
    first_seen_at,
    last_seen_at
   FROM public.installation;

GRANT SELECT ON TABLE trace_control.installations TO ac_trace_control;
