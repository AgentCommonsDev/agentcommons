-- The People page derives each member's "last seen" from the audit log: the newest event
-- the member made through a dashboard (cookie) principal in the organization. The list
-- probes this index once per member, newest first, so the answer does not depend on how
-- many hook uploads or agent reads the member's keys have written since.
CREATE INDEX audit_event_organization_id_auth_method_user_id_ts_idx ON public.audit_event USING btree (organization_id, auth_method, user_id, ts DESC);
