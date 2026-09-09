# ADR 0051: API keys can be copied again by their owner

Date: 2026-09-09
Status: Accepted. Extends the API key rules of §9.2 (R-AUTH-04); Better Auth keeps
owning key verification.

## Context

Better Auth stores API keys hashed, so the plaintext existed exactly once: in the
response to `POST /me/keys` and in the panel the dashboard showed right after. A
developer who set up a second machine, reinstalled an operating system, or lost the
terminal that ran `install.sh` had no way back to the key and created another one. Every
such key is one more credential that is live, named after a machine that may already hold
a different key, and never revoked because nobody is sure which machine uses it. The
Install page could only offer a `PASTE_YOUR_KEY` placeholder for an existing key, which
is a dead end for exactly the person the page is for.

The founder's direction was direct: let people copy the cleartext key in the dashboard so
they do not have to generate another one.

## Decision

The plaintext of every key is kept encrypted, and only its owner can read it back from a
signed-in browser session.

- **Storage.** `api_key_secret` (`ApiKeySecret` in `domain.prisma`) holds
  `api_key_id`, `organization_id`, `user_id`, `ciphertext`, `iv`, `tag`. The row is
  written in the same transaction that creates the key and its `api_key_owner` row, and
  a composite foreign key ties it to exactly that owner row. `ac_app` may select, insert
  and delete; nothing is granted to trace roles.
- **Cipher.** AES-256-GCM with a random 12-byte IV per row. The key is derived once per
  process with `hkdfSync("sha256", BETTER_AUTH_SECRET, "", "agentcommons/api-key-reveal/v1", 32)`;
  the API key id is authenticated as associated data, so a ciphertext cannot be moved to
  another key's row. There is no second secret to provision.
- **Route.** `POST /me/keys/:id/reveal` returns `{ key }`. The service requires a cookie
  session; a request authenticated with an API key receives 403
  `KEY_REVEAL_SESSION_REQUIRED`. The key must be owned by the caller, belong to the
  current organization and be enabled; anything else is 404, indistinguishable from a
  missing key. There is no admin variant and no MCP tool.
- **Audit.** Every reveal writes one `keys.reveal` AuditEvent with the key id as resource
  and no secret in detail, so an organization can see who copied which key and when.
- **Revocation.** Revoking a key, by its owner or by an admin, deletes the encrypted row
  in the same transaction. A revoked key can never be recovered.
- **Dashboard.** Each active key on Keys has a "Copy key" action that reveals and copies
  in one step; the value is never rendered in the page. The Install page lets a person
  pick one of their active ingest+read keys and fills the installer command with it.

Better Auth continues to verify presented keys against its hash. The encrypted copy is
never read on the authentication path.

## Alternatives considered

- **Keep keys unrecoverable and improve the one-time panel.** This is what existed. The
  cost is not the panel; it is the pile of unrevoked duplicate keys per person.
- **Reversible storage inside Better Auth.** The plugin hashes on purpose and offers no
  hook for a second representation; changing that means a fork. A separate table keeps
  the library untouched and the recovery path optional.
- **A dedicated encryption secret in the environment.** One more value to generate,
  rotate and back up, for an instance that already has one secret every deployment must
  protect. HKDF with a fixed info string gives an independent key from the existing
  secret; rotating `BETTER_AUTH_SECRET` makes stored copies unreadable, which is the same
  effect rotating a dedicated secret would have.
- **Letting admins reveal members' keys.** An admin who wants to act as a member should
  be added as a member and mint their own key. Owner-only keeps the audit trail honest.
- **Exposing reveal through MCP or to API-key callers.** An agent holding one key could
  then harvest every other key its user owns, including admin keys. Cookie-only bounds
  the reach of a leaked key to what that key was granted.

## Risk accepted and mitigations

A database dump together with `BETTER_AUTH_SECRET` now yields every active key in
plaintext, where before it yielded hashes. This is accepted because the same pair already
yields every session cookie and the ability to mint keys for any user, so the marginal
exposure is small. Mitigations: rows are deleted on revoke; the cipher is authenticated
and bound to the key id; access is owner-only, cookie-only and audited; keys keep their
optional expiry; and an organization that wants the old posture can revoke and recreate
keys, which removes the stored copies.

## Consequences

- New migration `202609090010_api_key_secret`; `pnpm db:diff` records its SQL-owned
  foreign key.
- `POST /me/keys/:id/reveal` appears in §7.6 and the generated OpenAPI and dashboard
  client; `apiKeyRevealOutputSchema` is the shared schema.
- Requirement R-AUTH-05 is added and cited by the keys integration suite, the cipher unit
  test and the Keys browser flow.
- The Install page no longer needs a placeholder for a key the person saved elsewhere.
