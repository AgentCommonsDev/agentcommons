import { createHmac } from "node:crypto";

/**
 * The salted fingerprint a redaction ledger row stores in place of the secret: an HMAC-SHA256
 * of the already-normalized matched value under the server secret (§5.3, ADR 0076). The same
 * value fingerprints alike across sessions, so an admin sees one leaked key recur; the HMAC
 * is not reversible and, being salted by a secret never shipped to clients, is not open to an
 * offline dictionary. Mirrors the HMAC construction used for cursor signing.
 */
export function redactionFingerprint(
  secret: string,
): (normalized: string) => string {
  return (normalized) =>
    createHmac("sha256", secret).update(normalized, "utf8").digest("hex");
}
