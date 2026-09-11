import { describe, expect, it } from "vitest";
import * as z from "zod";
import { hookManifestSchema } from "@agentcommons/core/schemas/ingest";
import { manifestStamp } from "../manifest-stamp.js";

// The manifest shape shipped before the stamp: strict, five fields. A deployed shim built
// from that schema parses the served manifest with exactly this, so a phase-1 (gate-off)
// manifest must still satisfy it or the shim stops self-updating (ADR 0075 rollout).
const strictLegacyManifest = z.strictObject({
  version: z.string().min(1).max(64),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  url: z.string().min(1),
  extensionSha256: z.string().regex(/^[a-f0-9]{64}$/),
  extensionUrl: z.string().min(1),
});
const base = {
  version: "0.1.0-test",
  sha256: "a".repeat(64),
  url: "/hook/0.1.0-test/hook.js",
  extensionSha256: "b".repeat(64),
  extensionUrl: "/hook/0.1.0-test/pi-extension.mjs",
};

describe("manifest stamp emission is gated off by default", () => {
  // @req R-CAP-27
  it("adds no fields unless the gate is on, so a strict legacy parser still accepts it", () => {
    // Unset, "0", and even an empty gate with the stamp inputs present: emission stays off.
    for (const env of [
      {},
      { AGENTCOMMONS_MANIFEST_STAMP: "0" },
      {
        AGENTCOMMONS_MANIFEST_STAMP: "",
        AGENTCOMMONS_CREATED: "2026-09-12T00:00:00Z",
        AGENTCOMMONS_REVISION: "f".repeat(40),
      },
    ]) {
      expect(manifestStamp(env)).toEqual({});
      const manifest = { ...base, ...manifestStamp(env) };
      expect(manifest).not.toHaveProperty("builtAt");
      expect(manifest).not.toHaveProperty("revision");
      expect(() => strictLegacyManifest.parse(manifest)).not.toThrow();
    }
  });
  // @req R-CAP-27
  it("adds builtAt and revision when the gate is on: the loose schema accepts them and the strict legacy one rejects them", () => {
    const stamp = manifestStamp({
      AGENTCOMMONS_MANIFEST_STAMP: "1",
      AGENTCOMMONS_CREATED: "2026-09-12T00:00:00Z",
      AGENTCOMMONS_REVISION: "f".repeat(40),
    });
    expect(stamp).toEqual({
      builtAt: "2026-09-12T00:00:00.000Z",
      revision: "f".repeat(40),
    });
    const manifest = { ...base, ...stamp };
    expect(hookManifestSchema.parse(manifest)).toMatchObject(stamp);
    // A deployed strict client rejects the stamped manifest: exactly why phase 2 waits.
    expect(() => strictLegacyManifest.parse(manifest)).toThrow();
  });
});
