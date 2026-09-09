import { z } from "zod";
import { expect, it } from "vitest";
import { loggerOptions } from "../src/logger.js";

// @req R-RED-08
it("removes bodies and record lines at the native Pino boundary", () => {
  const value = z
    .object({ remove: z.boolean(), paths: z.array(z.string()) })
    .parse(loggerOptions("info").redact);
  expect(value.remove).toBe(true);
  for (const path of ["body", "records[*].line"])
    expect(value.paths).toContain(path);
});
