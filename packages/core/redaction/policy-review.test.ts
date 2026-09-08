import { afterEach, expect, it, vi } from "vitest";
import * as recheck from "recheck";
import { z } from "zod";
import {
  builtinPolicies,
  composePolicies,
  policyDefinitionSchema,
} from "./policy.js";
vi.mock("recheck", async (importOriginal) => {
  const original = await importOriginal<typeof recheck>();
  return { ...original, checkSync: vi.fn(original.checkSync) };
});

afterEach(() => {
  vi.clearAllMocks();
});
const definition = (pattern: string) => ({
  name: "safety_review",
  kind: "REGEX",
  pattern,
  flags: "g",
});

// @req R-RED-02
it("uses the native automaton analysis for the bounded UUID policy", () => {
  const checker = vi.mocked(recheck.checkSync);
  const pattern =
    "(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|result|hits|input|query|filters)";
  expect(policyDefinitionSchema.safeParse(definition(pattern)).success).toBe(
    true,
  );
  const result = z
    .object({ status: z.string(), checker: z.string() })
    .parse(checker.mock.results.at(-1)?.value);
  expect(result).toEqual({ status: "safe", checker: "automaton" });
});

it("rejects a transient timeout but retries the same expression instead of caching failure", () => {
  const pattern = "policy-review-transient-[a-z]+";
  vi.mocked(recheck.checkSync).mockReturnValueOnce({
    source: pattern,
    flags: "g",
    status: "unknown",
    checker: "automaton",
    error: { kind: "timeout" },
  });
  const first = policyDefinitionSchema.safeParse(definition(pattern));
  expect(first.success).toBe(false);
  if (!first.success)
    expect(first.error.issues[0]?.message).toMatch(/could not|retry/i);
  expect(policyDefinitionSchema.safeParse(definition(pattern)).success).toBe(
    true,
  );
});

it("validates every shipped definition with the same bounded checker", () => {
  expect(composePolicies(builtinPolicies).map((policy) => policy.name)).toEqual(
    builtinPolicies.map((policy) => policy.name),
  );
});

it.each([
  "(a+)+$",
  "(a|aa)+$",
  "a{1000000000}",
  "(?=review_secret)",
  "(?<=review_secret)",
])("continues rejecting unsafe or zero-width pattern %s", (pattern) => {
  expect(policyDefinitionSchema.safeParse(definition(pattern)).success).toBe(
    false,
  );
});

it("retains supported backreferences and lookbehind without an invented regex subset", () => {
  expect(policyDefinitionSchema.safeParse(definition("(abc)\\1")).success).toBe(
    true,
  );
  expect(
    policyDefinitionSchema.safeParse(definition("(?<=prefix)secret")).success,
  ).toBe(true);
});
