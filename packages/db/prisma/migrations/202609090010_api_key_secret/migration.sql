-- Recoverable API keys (ADR 0051): the plaintext of every key is kept encrypted
-- (AES-256-GCM under a key derived from the server secret) so its owner can copy it
-- again from a signed-in dashboard session. The row is written in the transaction that
-- creates the key and deleted when the key is revoked. Trace roles receive no access.
CREATE TABLE public.api_key_secret (
    api_key_id text NOT NULL,
    organization_id text NOT NULL,
    user_id text NOT NULL,
    ciphertext bytea NOT NULL,
    iv bytea NOT NULL,
    tag bytea NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
ALTER TABLE ONLY public.api_key_secret
    ADD CONSTRAINT api_key_secret_pkey PRIMARY KEY (api_key_id);
CREATE INDEX api_key_secret_organization_id_user_id_idx ON public.api_key_secret USING btree (organization_id, user_id);
-- The secret belongs to exactly the organization and user that own the key.
ALTER TABLE ONLY public.api_key_secret
    ADD CONSTRAINT api_key_secret_owner FOREIGN KEY (organization_id, api_key_id, user_id) REFERENCES public.api_key_owner(organization_id, key_id, user_id) ON DELETE CASCADE;
CREATE TRIGGER tenant_immutable BEFORE UPDATE OF organization_id ON public.api_key_secret FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reassignment();
GRANT SELECT,INSERT,DELETE ON TABLE public.api_key_secret TO ac_app;
