import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSample,
  CompiledRedactors,
  configureRedactionSamples,
  defaultSampleConfig,
  maskPreview,
  normalizeForFingerprint,
  PREVIEW_HEAD,
  PREVIEW_MASK,
  PREVIEW_REVEAL_MAX_RATIO,
  PREVIEW_TAIL,
  preferSample,
  Redactor,
  valueLength,
} from "./index.js";

const hmac =
  (secret: string) =>
  (value: string): string =>
    createHmac("sha256", secret).update(value, "utf8").digest("hex");

afterEach(() => {
  configureRedactionSamples(null);
});

describe("masked preview", () => {
  // @req R-RED-12
  it("reveals nothing for a value where head and tail would be a quarter or more of it", () => {
    expect(maskPreview("a".repeat(6))).toBe(PREVIEW_MASK);
    expect(maskPreview("a".repeat(16))).toBe(PREVIEW_MASK);
    // Boundary: at 32, head+tail (8) is exactly a quarter, still suppressed; at 33 it drops
    // below a quarter and the ends show.
    expect(PREVIEW_HEAD + PREVIEW_TAIL).toBe(8);
    expect(PREVIEW_REVEAL_MAX_RATIO).toBe(0.25);
    expect(maskPreview("g".repeat(32))).toBe(PREVIEW_MASK);
    expect(maskPreview("g".repeat(33))).toBe("gggg" + PREVIEW_MASK + "gggg");
  });

  // @req R-RED-12
  it("reveals at most the first and last few characters of a long value and nothing between", () => {
    const secret = "ghp_" + "A".repeat(36); // 40 characters, a GitHub token shape
    const preview = maskPreview(secret);
    expect(preview).toBe("ghp_" + PREVIEW_MASK + "AAAA");
    expect(preview.startsWith("ghp_")).toBe(true);
    expect(preview.endsWith("AAAA")).toBe(true);
    // The revealed characters are a bounded, sub-secret slice: 8 of 40, never the whole key.
    expect(preview).not.toContain(secret);
    expect(valueLength(preview.replace(PREVIEW_MASK, ""))).toBe(
      PREVIEW_HEAD + PREVIEW_TAIL,
    );
  });

  // @req R-RED-12
  it("measures length and reveals by code point, never splitting a surrogate pair", () => {
    expect(valueLength("😀😀")).toBe(2);
    expect(maskPreview("😀".repeat(10))).toBe(PREVIEW_MASK); // 10 code points: suppressed
    const preview = maskPreview("😀".repeat(40));
    // The exact whole-emoji result proves no surrogate pair was split at a slice boundary.
    expect(preview).toBe("😀😀😀😀" + PREVIEW_MASK + "😀😀😀😀");
    expect(preview).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("fingerprint", () => {
  // @req R-RED-12
  it("is the same for one value across scans, changes with the value and the secret, and is not the secret", () => {
    const secret = "ghp_" + "Z".repeat(36);
    const config = { fingerprint: hmac("server-secret") };
    const first = buildSample(secret, config).fingerprint;
    const again = buildSample(secret, config).fingerprint;
    expect(first).toBe(again); // stable: the same leaked key shows one fingerprint everywhere
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain(secret);
    expect(buildSample(secret + "x", config).fingerprint).not.toBe(first);
    expect(
      buildSample(secret, { fingerprint: hmac("other-secret") }).fingerprint,
    ).not.toBe(first); // salted: a different server secret gives a different fingerprint
  });

  // @req R-RED-12
  it("normalizes to NFC so the same value written with different code points fingerprints alike", () => {
    const config = { fingerprint: hmac("server-secret") };
    const composed = "caf\u00e9-secret-token-value-abcdef"; // é as one code point
    const decomposed = "cafe\u0301-secret-token-value-abcdef"; // e + combining acute
    expect(composed).not.toBe(decomposed);
    expect(normalizeForFingerprint(composed)).toBe(
      normalizeForFingerprint(decomposed),
    );
    expect(buildSample(composed, config).fingerprint).toBe(
      buildSample(decomposed, config).fingerprint,
    );
  });

  // @req R-RED-12
  it("captures preview and length with a null fingerprint when no secret is configured", () => {
    const sample = buildSample("a".repeat(40), { fingerprint: null });
    expect(sample).toEqual({
      preview: "aaaa" + PREVIEW_MASK + "aaaa",
      fingerprint: null,
      length: 40,
    });
  });
});

describe("preferSample", () => {
  // @req R-RED-12
  it("keeps the longer, more identifying sample and leaves undefined alone", () => {
    const short = { preview: PREVIEW_MASK, fingerprint: "a", length: 10 };
    const long = { preview: "gggg…gggg", fingerprint: "b", length: 40 };
    expect(preferSample(short, long)).toBe(long);
    expect(preferSample(long, short)).toBe(long);
    expect(preferSample(undefined, short)).toBe(short);
    expect(preferSample(short, undefined)).toBe(short);
    expect(preferSample(undefined, undefined)).toBeUndefined();
  });
});

describe("Redactor sample capture", () => {
  const secret = "ac_" + "z".repeat(37); // 40 characters, matches the built-in agentcommons rule

  // @req R-RED-12
  it("attaches a sample to each count when capture is configured, and never the value", async () => {
    const redactor = new Redactor([], {
      sample: { fingerprint: hmac("server-secret") },
    });
    const result = await redactor.text(`see ${secret} now`);
    expect(result.value).not.toContain(secret);
    const [count] = result.counts;
    expect(count?.sample?.preview).toBe("ac_z" + PREVIEW_MASK + "zzzz");
    expect(count?.sample?.length).toBe(40);
    expect(count?.sample?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // The whole result, samples included, holds no trace of the secret.
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  // @req R-RED-12
  it("reports plain counts with no sample by default", async () => {
    const result = await new Redactor([]).text(`see ${secret} now`);
    expect(result.counts[0]?.sample).toBeUndefined();
  });

  // @req R-RED-12
  it("takes the process default set at startup for every redactor it then builds", async () => {
    expect(defaultSampleConfig()).toBeNull();
    configureRedactionSamples({ fingerprint: hmac("server-secret") });
    expect(defaultSampleConfig()).not.toBeNull();
    const redactor = new CompiledRedactors().get("org", []);
    const result = await redactor.text(`see ${secret} now`);
    expect(result.counts[0]?.sample?.length).toBe(40);
  });
});
