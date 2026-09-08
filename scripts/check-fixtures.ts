import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Redactor } from "../packages/core/redaction/index.js";

const redactor = new Redactor();
let count = 0;
const failures: string[] = [];
async function check(directory: string): Promise<void> {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await check(path);
    else if (/\.(jsonl?|ya?ml|txt)$/.test(item.name)) {
      const source = await readFile(path, "utf8");
      const result = await redactor.text(source);
      count++;
      if (result.counts.length) {
        // Neither messages nor matched values may be logged by the fixture gate.
        console.error(
          `${path}: ${String(result.counts.reduce((total, rule) => total + rule.count, 0))} redaction matches`,
        );
        failures.push(path);
      }
    }
  }
}
await check(fileURLToPath(new URL("../fixtures/", import.meta.url)));
console.log(`Checked ${String(count)} fixture files.`);
if (failures.length) process.exitCode = 1;
