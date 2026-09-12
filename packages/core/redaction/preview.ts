/**
 * Identifying metadata for a redacted value, derived at the moment of the match so an admin
 * can recognize and rotate a leaked secret without the secret ever being stored (§5.3, ADR
 * 0068). Three fields leave the redactor for every hit: a masked preview that reveals at
 * most a bounded, sub-secret slice, a salted fingerprint that is the same for the same
 * value across sessions but is not reversible, and the value's length. The raw matched text
 * never leaves the scan loop.
 */

/** Characters revealed from the start of a long value. */
export const PREVIEW_HEAD = 4;
/** Characters revealed from the end of a long value. */
export const PREVIEW_TAIL = 4;
/** The fixed marker standing in for the hidden middle; carries no length information. */
export const PREVIEW_MASK = "…";
/**
 * The revealed head and tail are shown only when together they are below this fraction of
 * the value's length. At 0.25 with a 4+4 reveal, nothing is revealed until the value is
 * longer than 32 characters, so a short secret (a 6-digit code, a 16-character key) reveals
 * nothing at all.
 */
export const PREVIEW_REVEAL_MAX_RATIO = 0.25;

/** Code-point length, so a surrogate pair counts once and the threshold is not fooled by UTF-16 units. */
export function valueLength(value: string): number {
  return Array.from(value).length;
}

/**
 * The first {@link PREVIEW_HEAD} and last {@link PREVIEW_TAIL} characters around a fixed
 * mask, but only when those characters are less than {@link PREVIEW_REVEAL_MAX_RATIO} of the
 * value; otherwise the mask alone. Operates on the matched value only, never on the text
 * around it, and reveals a bounded slice by construction: a value of length n reveals at
 * most PREVIEW_HEAD+PREVIEW_TAIL of its characters and only when that is < n/4.
 */
export function maskPreview(value: string): string {
  const chars = Array.from(value);
  const length = chars.length;
  if (PREVIEW_HEAD + PREVIEW_TAIL < length * PREVIEW_REVEAL_MAX_RATIO)
    return (
      chars.slice(0, PREVIEW_HEAD).join("") +
      PREVIEW_MASK +
      chars.slice(length - PREVIEW_TAIL).join("")
    );
  return PREVIEW_MASK;
}

/** Unicode NFC so the same value written with different code-point sequences fingerprints alike. */
export function normalizeForFingerprint(value: string): string {
  return value.normalize("NFC");
}

/** What a hit carries in place of the secret: a masked preview, a salted fingerprint, and the length. */
export interface RedactionSample {
  /** A bounded, sub-secret slice of the matched value; never the whole value. */
  preview: string;
  /** Salted HMAC of the normalized value, or null when no server secret is configured. */
  fingerprint: string | null;
  /** Code-point length of the matched value. */
  length: number;
}

/** How the redactor derives a sample: the salted fingerprint function, or null for preview only. */
export type RedactionSampleConfig = {
  fingerprint: ((normalized: string) => string) | null;
} | null;

/**
 * Process-wide sample capture. Off by default, so a bare `new Redactor()` reports plain
 * counts (the redaction engine's unit contract). The server turns it on once at startup
 * with a fingerprint function derived from its secret; from then on every redactor it builds
 * records samples. A single switch, read as data by the one redaction implementation.
 */
let defaultConfig: RedactionSampleConfig = null;
export function configureRedactionSamples(
  config: { fingerprint?: (normalized: string) => string } | null,
): void {
  defaultConfig = config ? { fingerprint: config.fingerprint ?? null } : null;
}
export function defaultSampleConfig(): RedactionSampleConfig {
  return defaultConfig;
}

/** Derive a sample from a matched value. The value is read here and nowhere retained. */
export function buildSample(
  value: string,
  config: NonNullable<RedactionSampleConfig>,
): RedactionSample {
  return {
    preview: maskPreview(value),
    fingerprint: config.fingerprint
      ? config.fingerprint(normalizeForFingerprint(value))
      : null,
    length: valueLength(value),
  };
}

/**
 * When two hits of one policy fold into a single ledger row, keep the more identifying
 * sample: the longer value, ties resolved to the one already held. Deterministic, so a
 * value's fingerprint is stable across runs of the same batch.
 */
export function preferSample(
  held: RedactionSample | undefined,
  incoming: RedactionSample | undefined,
): RedactionSample | undefined {
  if (!incoming) return held;
  if (!held) return incoming;
  return incoming.length > held.length ? incoming : held;
}
