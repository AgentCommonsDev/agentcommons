-- Same reserved canonical namespace as core projectionIdentity. PostgreSQL's
-- built-in sha256(bytea) needs no extension and always hashes UTF-8 bytes here.
CREATE FUNCTION public.native_identity(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER PARALLEL SAFE
RETURN CASE WHEN value ~ '^redacted-[a-f0-9]{64}$' THEN value
  ELSE 'redacted-' || encode(sha256(convert_to(value, 'UTF8')), 'hex') END;
REVOKE ALL ON FUNCTION public.native_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.native_identity(text) TO ac_app;

-- Fail on pre-existing canonical identity collisions instead of deleting or
-- merging historical identities, receipts, or ownership implicitly.
CREATE UNIQUE INDEX session_native_identity
  ON agent_session(organization_id, harness, public.native_identity(harness_session_id));
CREATE INDEX session_pending_parent_identity
  ON agent_session(organization_id, harness, public.native_identity(parent_native_ref))
  WHERE parent_session_id IS NULL;
DROP INDEX raw_record_session_key;
CREATE UNIQUE INDEX raw_record_native_key
  ON raw_record(session_id, public.native_identity(key)) WHERE key IS NOT NULL;
