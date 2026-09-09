import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Redactor } from "../../packages/core/redaction/index.js";

/** Writes the redacted report to `<output>/report.json` and returns that path. */
export async function writeReport(output: string, report: unknown) {
  const path = join(output, "report.json");
  await writeFile(
    path,
    `${JSON.stringify((await new Redactor().json(report)).value, null, 2)}\n`,
  );
  return path;
}
