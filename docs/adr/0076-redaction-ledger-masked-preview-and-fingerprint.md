# ADR 0076: The redaction ledger identifies a secret by a masked preview and a salted fingerprint, never by storing it

Date: 2026-09-12
Status: Accepted
Extends ADR 0016 (redaction counters), ADR 0066 (shared engines, batched rescan) and §5.3;
the `redaction_hit` ledger of R-RED-09/10/11 stands.

## Context

An admin who sees "secretlint fired 27 times across 7 sessions" cannot act on it. To rotate
a leaked credential they need to know which credential leaked. The request was literal: show
"the actual token that was removed."

Storing the token is the one thing redaction exists to prevent. The plaintext would be
written back into ClickHouse and PostgreSQL, the CSV export and the admin MCP tools — the
exact value the redactor deleted, re-persisted in the datastore, defeating the feature and
the rule that no secret is stored (§5.3, AGENTS.md). So the ledger must let an admin
recognize, triage and rotate a leaked secret without holding it.

The redactor already knows each matched value at the moment it replaces it
(`value.slice(range.start, range.end)` in the scan loop). That is the only place the value
is in hand, and the natural place to derive something safe from it.

## Decision

For each hit the redactor derives three fields from the matched value and nothing else, and
the ledger row stores them as typed columns (`masked_preview`, `fingerprint`,
`match_length` on `redaction_hit`), never the value:

1. **Masked preview.** The first `PREVIEW_HEAD` (4) and last `PREVIEW_TAIL` (4) characters
   around a fixed mask (`…`), and only when those are below `PREVIEW_REVEAL_MAX_RATIO`
   (0.25) of the value's length; otherwise the mask alone. Nothing is revealed until the
   value is longer than 32 characters, so a short secret (a 6-digit code, a 16-character
   key) reveals nothing, while `ghp_…AB12` is recognizable. Constants live in
   `packages/core/redaction/preview.ts`. Length is counted by code point.

2. **Fingerprint.** HMAC-SHA256 of the NFC-normalized value under the server secret
   (`BETTER_AUTH_SECRET`), the same construction the cursor codec uses. The same value
   fingerprints alike across sessions, so an admin sees one key recur ("this key leaked in
   7 sessions"); the digest is not reversible and, salted by a secret never shipped to a
   client, is not open to an offline dictionary. Computed in the API and injected into the
   pure core engine, so core never learns the secret.

3. **Match length**, the value's code-point count, kept for triage.

Sample capture is one process switch (`configureRedactionSamples`) the server sets once at
startup; a bare `new Redactor()` leaves it off, so the engine's unit contract is unchanged.
Differences are data one implementation reads, per AGENTS.md, not a second code path.

A ledger row holds one representative match — the longest, ties to the first — so when
several matches of one policy fold onto one message the more identifying one survives. `GET
/admin/redaction/summary` reports a per-policy distinct-secret count as `count(DISTINCT
fingerprint)` from a grouped, index-only scan (a new `(organization_id, policy_id,
fingerprint)` index). Rescan re-derives all three from raw records like every other field.

## Consequences

- An admin can find and rotate a leaked key from the ledger and the per-policy distinct
  count, without the secret ever being stored, exported or exposed to an agent.
- **Residual reveal, bounded and documented.** The masked preview is a slice of the value
  by construction: at most 8 of its characters, and only when that is under a quarter of its
  length, so anything up to 32 characters reveals nothing at all. The fingerprint is a
  one-way digest; recovering the value needs both the server secret and a guess of the value.
  The stored metadata is therefore itself safe at rest.
- **Distinct-secret count is a lower bound.** A message holding two different values of one
  policy keeps one representative, so its second value is not fingerprinted. Multiple
  distinct secrets of one policy in one message are rare; the count is honest as a floor.
- **Capture-time metadata remainder has no sample.** Metadata hits (git fields, context) at
  capture are computed by subtracting attributed record hits from the per-policy total, so
  they carry no single value and their preview and fingerprint are null. A rescan re-redacts
  metadata from its own text and does attach a sample.

## Alternatives rejected

- **Store the plaintext.** Refused: re-persists the secret redaction deletes.
- **Unsalted hash.** A plain SHA-256 of a low-entropy secret is open to an offline
  dictionary; the salt (server secret) closes that.
- **A row per distinct value.** More faithful for the multi-secret-per-message case, but it
  reshapes the ledger's key and the capture-time metadata remainder (a subtraction with no
  per-value provenance), for a case that is rare. Deferred; the representative captures the
  common case and the residual is documented.
