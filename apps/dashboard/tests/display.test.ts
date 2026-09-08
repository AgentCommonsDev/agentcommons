import { expect, it } from "vitest";
import { z } from "zod";
import { errorMessage } from "../src/lib/display";
// @req R-DASH-07
it("presents validation messages without Zod's serialized internal issue objects", () => {
  const parsed = z
    .object({ name: z.string().min(1, { error: "Enter a dashboard name." }) })
    .safeParse({ name: "" });
  if (parsed.success) throw new Error("Expected invalid empty name");
  expect(errorMessage(parsed.error)).toBe("Enter a dashboard name.");
  expect(errorMessage(new Error("The request failed."))).toBe(
    "The request failed.",
  );
});
