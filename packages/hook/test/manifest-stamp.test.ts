import { describe, expect, it } from "vitest";
import { hookManifestSchema } from "@agentcommons/core/schemas/ingest";
import { manifestStamp } from "../manifest-stamp.js";

const base = {
  version: "0.1.0-test",
  sha256: "a".repeat(64),
  url: "/hook/0.1.0-test/hook.js",
  extensionSha256: "b".repeat(64),
  extensionUrl: "/hook/0.1.0-test/pi-extension.mjs",
};

describe("every build stamps its manifest when it can", () => {
  // @req R-CAP-27
  it("takes builtAt and revision from the release build arguments", () => {
    const stamp = manifestStamp({
      AGENTCOMMONS_CREATED: "2026-09-12T00:00:00Z",
      AGENTCOMMONS_REVISION: "f".repeat(40),
    });
    expect(stamp).toEqual({
      builtAt: "2026-09-12T00:00:00.000Z",
      revision: "f".repeat(40),
    });
    expect(hookManifestSchema.parse({ ...base, ...stamp })).toMatchObject(
      stamp,
    );
  });
  // @req R-CAP-27
  it("falls back to the HEAD commit and its committer date in a checkout", () => {
    const local = manifestStamp({});
    expect(local.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(local.builtAt).toBeDefined();
    expect(hookManifestSchema.parse({ ...base, ...local }).builtAt).toBe(
      local.builtAt,
    );
  });
});
