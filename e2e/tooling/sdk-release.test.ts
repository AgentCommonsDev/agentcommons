import { expect, it } from "vitest";
import { sdkReleaseVersion } from "../../scripts/sdk-release.js";

// @req R-SDK-04
it("accepts only a stable tag matching both registry package versions", () => {
  expect(sdkReleaseVersion("sdk-v0.1.0", "0.1.0", "0.1.0")).toBe("0.1.0");
  for (const tag of [
    "main",
    "v0.1.0",
    "sdk-v0.1.0rc1",
    "sdk-v0.1.0-beta.1",
    "sdk-v00.1.0",
    "sdk-v0.1.0\nextra",
  ])
    expect(() => sdkReleaseVersion(tag, "0.1.0", "0.1.0")).toThrow(
      "matching both",
    );
  expect(() => sdkReleaseVersion("sdk-v0.2.0", "0.1.0", "0.2.0")).toThrow(
    "matching both",
  );
  expect(() => sdkReleaseVersion("sdk-v0.2.0", "0.2.0", "0.1.0")).toThrow(
    "matching both",
  );
});
