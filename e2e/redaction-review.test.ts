import { describe, expect, it } from "vitest";
import {
  PolicyCache,
  policyDefinitionSchema,
  Redactor,
} from "../packages/core/redaction/index.js";
import type { RedactionPolicy } from "../packages/core/redaction/policy.js";

const escapedPolicy: RedactionPolicy = {
  id: "review-escaped",
  name: "review",
  kind: "REGEX",
  pattern: "foo\\/bar",
  flags: "g",
  enabled: true,
  builtin: false,
};

describe("independent redaction regression review", () => {
  it.each([
    "// secretlint-disable",
    "# secretlint-disable",
    "<!-- secretlint-disable -->",
    "// secretlint-disable @secretlint/secretlint-rule-github",
  ])(
    "does not execute transcript suppression directive %s",
    async (directive) => {
      const value = "ghp_" + "a".repeat(36);
      const result = await new Redactor().text(`${directive}\n${value}`);
      expect(result.value).not.toContain(value);
      expect(result.counts.reduce((count, item) => count + item.count, 0)).toBe(
        1,
      );
    },
  );

  it("excludes the suppression filter from the selectable scanner allowlist", () => {
    expect(
      policyDefinitionSchema.safeParse({
        name: "suppression",
        kind: "SECRETLINT_RULE",
        ruleId: "@secretlint/secretlint-rule-filter-comments",
      }).success,
    ).toBe(false);
  });

  it("preserves already-escaped regex delimiters when passing expressions to secretlint", async () => {
    const result = await new Redactor([escapedPolicy]).text(
      "before foo/bar after",
    );
    expect(result.value).toBe("before [REDACTED:review] after");
    expect(result.counts).toEqual([
      { policyId: "review-escaped", name: "review", count: 1 },
    ]);
  });

  it.each(["(?=secret)", "(?<=secret)", "(a|aa)+$", "(a+)+$"])(
    "rejects unsafe or zero-width expression %s before scanning",
    (pattern) => {
      expect(
        policyDefinitionSchema.safeParse({
          name: "unsafe",
          kind: "REGEX",
          pattern,
        }).success,
      ).toBe(false);
      expect(
        policyDefinitionSchema.safeParse({
          name: "unsafe",
          kind: "SECRETLINT_RULE",
          ruleId: "@secretlint/secretlint-rule-github",
          options: { allows: [`/${pattern}/g`] },
        }).success,
      ).toBe(false);
    },
  );

  it("does not evict a fresh policy cache entry when an older invalidated load rejects", async () => {
    let rejectOld: ((reason: Error) => void) | undefined;
    const oldLoad = new Promise<RedactionPolicy[]>((_resolve, reject) => {
      rejectOld = reject;
    });
    let loads = 0;
    const cache = new PolicyCache(() => {
      loads++;
      return loads === 1 ? oldLoad : Promise.resolve([]);
    });
    const old = cache.get("review-org");
    cache.invalidate("review-org");
    const fresh = await cache.get("review-org");
    if (!rejectOld) throw new Error("Deferred load was not initialized");
    rejectOld(new Error("Obsolete load failed"));
    await expect(old).rejects.toThrow("Obsolete load failed");
    expect(await cache.get("review-org")).toBe(fresh);
    expect(loads).toBe(2);
  });
});
