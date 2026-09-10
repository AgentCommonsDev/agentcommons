import { describe, expect, it } from "vitest";
import {
  CompiledRedactors,
  Redactor,
  PolicyCache,
  policyDefinitionSchema,
  policyFingerprint,
  sanitizeRecord,
} from "./index.js";
import { jsonByteLength } from "../schemas/common.js";
import type { RedactionPolicy } from "./policy.js";

const custom: RedactionPolicy = {
  id: "policy-a",
  name: "internal",
  kind: "REGEX",
  pattern: "confidential-[a-z]+",
  flags: "g",
  enabled: true,
  builtin: false,
};

describe("redaction before persistence", () => {
  // @req R-RED-01
  it.each([
    ["anthropic", "sk-ant-" + "a".repeat(32)],
    ["openai", "sk-proj-" + "b".repeat(32)],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJlZmFrZQ"],
    ["connection", "postgres://user:example-pass@localhost:5432/test"],
    ["token", "token=" + "a".repeat(30)],
    ["agentcommons", "ac_" + "b".repeat(32)],
  ])(
    "redacts %s credentials without returning their value",
    async (_, secret) => {
      const result = await new Redactor().text(`before ${secret} after`);
      expect(result.value).toMatch(/^before \[REDACTED:[^\]]+\] after$/);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(result.counts.reduce((sum, count) => sum + count.count, 0)).toBe(
        1,
      );
      expect((await new Redactor().text(result.value)).value).toBe(
        result.value,
      );
    },
  );

  it("keeps ordinary identifiers and short examples", async () => {
    const text = "token=bucket ac_example src/tokens.ts HTTP 401 read_file";
    expect(await new Redactor().text(text)).toEqual({
      value: text,
      counts: [],
    });
  });

  it("does not let transcript comments disable shipped scanners", async () => {
    const secret = "ghp_" + "a".repeat(36);
    const result = await new Redactor().text(
      `// secretlint-disable\n${secret}\n// secretlint-enable`,
    );
    expect(result.value).not.toContain(secret);
    expect(result.counts.length).toBeGreaterThan(0);
  });

  // @req R-RED-02
  it("composes custom policies and respects disabled built-ins", async () => {
    const redactor = new Redactor([
      custom,
      {
        id: "disabled",
        name: "agentcommons",
        kind: "REGEX",
        pattern: "ac_[A-Za-z0-9_]+",
        flags: "g",
        enabled: false,
        builtin: true,
      },
    ]);
    const original = "ac_" + "z".repeat(30);
    const result = await redactor.text(`confidential-blue ${original}`);
    expect(result.value).toBe(`[REDACTED:internal] ${original}`);
    expect(result.counts).toEqual([
      { policyId: "policy-a", name: "internal", count: 1 },
    ]);
  });

  it("rejects malformed, empty, oversized, or backtracking expressions and uninstalled rules", () => {
    for (const pattern of ["(", "a*", "(a+)+$", "x".repeat(1025)]) {
      expect(
        policyDefinitionSchema.safeParse({
          name: "test",
          kind: "REGEX",
          pattern,
        }).success,
      ).toBe(false);
    }
    expect(
      policyDefinitionSchema.safeParse({
        name: "test",
        kind: "SECRETLINT_RULE",
        ruleId: "file:///tmp/untrusted.js",
      }).success,
    ).toBe(false);
    expect(
      policyDefinitionSchema.safeParse({
        name: "test",
        kind: "REGEX",
        pattern: "needle",
        flags: "gg",
      }).success,
    ).toBe(false);
  });

  it("redacts nested values and keys while preserving unknown fields and key collisions", async () => {
    const result = await new Redactor([custom]).json({
      unknown: ["confidential-blue", { other: 4 }],
      "confidential-red": 1,
      "confidential-green": 2,
    });
    expect(result.value).toEqual({
      unknown: ["[REDACTED:internal]", { other: 4 }],
      "[REDACTED:internal]": 1,
      "[REDACTED:internal]#1": 2,
    });
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value);
  });

  // @req R-RED-02
  it("keeps policy caches separate by organization, reloads rows after 30 seconds and recompiles only changed rows", async () => {
    let now = 0;
    const calls: string[] = [];
    const rows = new Map<string, RedactionPolicy[]>([
      ["one", [custom]],
      ["two", []],
    ]);
    const cache = new PolicyCache(
      (organizationId) => {
        calls.push(organizationId);
        return Promise.resolve(rows.get(organizationId) ?? []);
      },
      () => now,
      new CompiledRedactors(),
    );
    const first = await cache.get("one");
    expect(await cache.get("one")).toBe(first);
    expect(
      (await (await cache.get("two")).text("confidential-blue")).value,
    ).toBe("confidential-blue");
    now = 30_000;
    // Unchanged rows reload into the same compiled engine.
    expect(await cache.get("one")).toBe(first);
    expect(calls).toEqual(["one", "two", "one"]);
    rows.set("one", [{ ...custom, enabled: false }]);
    now = 60_000;
    const disabled = await cache.get("one");
    expect(disabled).not.toBe(first);
    expect((await disabled.text("confidential-blue")).value).toBe(
      "confidential-blue",
    );
  });

  // @req R-RED-02
  it("shares one compiled engine per organization and policy set, isolates organizations and bounds its size", () => {
    const compiled = new CompiledRedactors(2);
    const first = compiled.get("one", [custom]);
    expect(compiled.get("one", [custom])).toBe(first);
    const reordered = [
      { ...custom, id: "policy-b", name: "second", pattern: "second-[a-z]+" },
      custom,
    ];
    const ordered = compiled.get("one", [...reordered].reverse());
    expect(compiled.get("one", reordered)).toBe(ordered);
    // Same rows, other organization: its own engine.
    expect(compiled.get("two", [custom])).not.toBe(first);
    // A changed definition compiles anew.
    expect(
      compiled.get("one", [{ ...custom, replacement: "[HIDDEN]" }]),
    ).not.toBe(first);
    // Bounded: the two least recently used engines were evicted.
    expect(compiled.size).toBe(2);
    expect(compiled.get("one", [custom])).not.toBe(first);
  });

  // @req R-RED-02
  it("fingerprints the composed policy set independent of row order and sensitive to every change", () => {
    const other: RedactionPolicy = {
      ...custom,
      id: "policy-b",
      name: "other",
      pattern: "other-[a-z]+",
    };
    const base = policyFingerprint([custom, other]);
    expect(policyFingerprint([other, custom])).toBe(base);
    expect(policyFingerprint([custom])).not.toBe(base);
    expect(policyFingerprint([custom, { ...other, enabled: false }])).not.toBe(
      base,
    );
    expect(
      policyFingerprint([custom, { ...other, pattern: "other-[0-9]+" }]),
    ).not.toBe(base);
    expect(policyFingerprint([custom, { ...other, id: "policy-c" }])).not.toBe(
      base,
    );
    expect(policyFingerprint([])).toBe(policyFingerprint([]));
  });

  // @req R-RED-01 @req R-RED-02
  it("memoizes repeated scans per engine without sharing count objects", async () => {
    const redactor = new Redactor([custom]);
    const first = await redactor.text("confidential-red", "note=");
    const again = await redactor.text("confidential-red", "note=");
    expect(again).toEqual(first);
    const [hit] = first.counts;
    expect(hit).toEqual({ policyId: "policy-a", name: "internal", count: 1 });
    expect(again.counts[0]).not.toBe(hit);
    if (hit) hit.count = 99;
    expect((await redactor.text("confidential-red", "note=")).counts).toEqual([
      { policyId: "policy-a", name: "internal", count: 1 },
    ]);
    // The prefix is part of the identity: the same value scanned bare is a different scan.
    expect((await redactor.text("confidential-red")).value).toBe(
      "[REDACTED:internal]",
    );
    expect(await redactor.text("")).toEqual({ value: "", counts: [] });
    expect(await redactor.text("", "key=")).toEqual({ value: "", counts: [] });
  });

  it("redacts before hashing and omitting oversized leaves, without mutating its input", async () => {
    const secret = "ac_" + "b".repeat(32);
    const input = {
      type: "tool",
      nested: { output: "ü".repeat(700_000) + secret },
      unknown: [1, true, null],
    };
    const redacted = await new Redactor().json(input);
    const sanitized = sanitizeRecord(redacted.value);
    expect(jsonByteLength(sanitized)).toBeLessThan(1024 * 1024);
    expect(JSON.stringify(sanitized)).toMatch(
      /bytes omitted, sha256 [a-f0-9]{64}/,
    );
    expect(JSON.stringify(sanitized)).not.toContain(secret);
    expect(JSON.parse(JSON.stringify(sanitized))).toMatchObject({
      type: "tool",
      unknown: [1, true, null],
    });
    expect(input.nested.output).toContain(secret);
  });

  it("replaces inline image data and retains valid JSON", () => {
    expect(sanitizeRecord({ image: "data:image/png;base64,YWJj" })).toEqual({
      image: "[image: image/png, 3 bytes]",
    });
  });
});

// @req R-RED-01 @req R-RED-02
it("applies anchored regexes to object values without losing assignment context or counting overlaps twice", async () => {
  const redactor = new Redactor([
    { ...custom, pattern: "^needle🙂$", flags: "gu" },
  ]);
  const standalone = await redactor.text("needle🙂");
  const nested = await redactor.json({
    x: "needle🙂",
    items: ["needle🙂"],
    nested: { value: "needle🙂" },
    near: "prefixneedle🙂",
  });
  expect(standalone.value).toBe("[REDACTED:internal]");
  expect(nested.value).toEqual({
    x: standalone.value,
    items: [standalone.value],
    nested: { value: standalone.value },
    near: "prefixneedle🙂",
  });
  expect(nested.counts).toEqual([
    { policyId: custom.id, name: custom.name, count: 3 },
  ]);
  expect(await redactor.json(nested.value)).toEqual({
    value: nested.value,
    counts: [],
  });
  const overlapping = await new Redactor([
    { ...custom, pattern: "needle🙂", flags: "gu" },
  ]).json({ x: "needle🙂" });
  expect(overlapping.counts).toEqual([
    { policyId: custom.id, name: custom.name, count: 1 },
  ]);
  const assignment = await redactor.json({
    token: "a".repeat(30),
    x: "unrelated",
  });
  expect(assignment.value).toEqual({
    token: "[REDACTED:token]",
    x: "unrelated",
  });
  expect(
    assignment.counts.reduce((total, count) => total + count.count, 0),
  ).toBe(1);
});
