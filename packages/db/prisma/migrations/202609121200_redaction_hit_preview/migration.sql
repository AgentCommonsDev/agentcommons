-- A redaction ledger row gains identifying metadata an admin can use to spot and rotate a
-- leaked secret, derived from the match at redaction and never the secret itself (ADR 0076):
-- a masked preview (a bounded, sub-secret slice), a salted HMAC fingerprint (the same value
-- fingerprints alike across sessions, so one key's spread is visible; not reversible), and
-- the matched value's length. All nullable: rows written before this migration have none,
-- and a capture-time metadata remainder hit carries no single value. The fingerprint index
-- answers the per-policy distinct-secret count from an index-only grouped scan.
ALTER TABLE public.redaction_hit ADD COLUMN masked_preview text;
ALTER TABLE public.redaction_hit ADD COLUMN fingerprint text;
ALTER TABLE public.redaction_hit ADD COLUMN match_length integer;

CREATE INDEX redaction_hit_organization_id_policy_id_fingerprint_idx ON public.redaction_hit USING btree (organization_id, policy_id, fingerprint);
