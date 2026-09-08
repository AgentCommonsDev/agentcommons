import { expect, it } from "vitest";
import { Redactor, policyDefinitionSchema } from "./index.js";
import { storageText } from "./storage-text.js";

// @req R-ING-11 @req R-RED-02
it("normalizes only PostgreSQL-incompatible text after scanning, preserving Unicode and idempotency", async () => {
  const input =
    "NUL:\u0000 high:\ud800 low:\udfff valid:😀漢字\n\t literal:\\u0000";
  const expected = "NUL:\\u0000 high:� low:� valid:😀漢字\n\t literal:\\u0000";
  expect(storageText(input)).toBe(expected);
  expect(storageText(expected)).toBe(expected);
  const redactor = new Redactor();
  const scanned = await redactor.text(input);
  expect(scanned.value).toBe(expected);
  expect(
    (await redactor.json({ "\u0000": input, "\\u0000": "unchanged" })).value,
  ).toEqual({ "\\u0000": expected, "\\u0000#1": "unchanged" });
  for (const bad of ["\u0000", "\ud800", "\udfff"])
    for (const field of ["pattern", "replacement"])
      expect(
        policyDefinitionSchema.safeParse({
          name: "unsafe-text",
          kind: "REGEX",
          pattern: "secret",
          [field]: bad,
        }).success,
      ).toBe(false);
  expect(
    policyDefinitionSchema.safeParse({
      name: "escaped-nul",
      kind: "REGEX",
      pattern: "\\x00",
    }).success,
  ).toBe(true);
  const match = await new Redactor([
    {
      id: "nul",
      name: "nul",
      kind: "REGEX",
      pattern: "\\x00",
      flags: "g",
      enabled: true,
      builtin: false,
    },
  ]).text("a\u0000b");
  expect(match.value).toBe("a[REDACTED:nul]b");
  expect(match.counts).toEqual([{ policyId: "nul", name: "nul", count: 1 }]);
});
