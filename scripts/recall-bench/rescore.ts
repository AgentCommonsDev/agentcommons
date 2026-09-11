/**
 * Re-derives a bench's records from what it left on disk (`tasks/*.stream.jsonl`, the
 * isolated transcripts, the run repositories and the results file's audit rows), so a
 * scoring change applies to an earlier run without re-running the models.
 *
 *   node --import tsx scripts/recall-bench/rescore.ts --out <dir> --label baseline
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  hintsSeen,
  parseStream,
  scoreRun,
  summarize,
  type RunRecord,
} from "./bench.js";
import { benchTasks, type History } from "./tasks.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return (index >= 0 ? process.argv[index + 1] : undefined) ?? fallback;
}
const out = argument("out", "");
const label = argument("label", "baseline");
const previousSchema = z.looseObject({
  label: z.string(),
  runId: z.string(),
  options: z.looseObject({ histories: z.array(z.string()) }),
  records: z.array(
    z.looseObject({
      task: z.string(),
      history: z.enum(["squashed", "available"]),
      run: z.number(),
      ticket: z.string(),
      exit_code: z.number().nullable(),
      duration_ms: z.number(),
      audit: z.array(
        z.looseObject({
          action: z.string(),
          input: z.unknown(),
          sessions: z.array(z.string()),
        }),
      ),
      first_result_has_seed: z.boolean(),
      any_result_has_seed: z.boolean(),
      any_result_has_task_run: z.boolean(),
    }),
  ),
});
async function main() {
  if (!out) throw new Error("--out is required.");
  const previous = previousSchema.parse(
    JSON.parse(await readFile(join(out, `results-${label}.json`), "utf8")),
  );
  const configDirectory = join(out, "config-home", ".claude");
  const records: RunRecord[] = [];
  for (const old of previous.records) {
    const task = benchTasks.find((candidate) => candidate.id === old.task);
    if (!task) continue;
    const name = `${old.task}-${old.history}-${String(old.run)}`;
    const lines = (
      await readFile(join(out, "tasks", `${name}.stream.jsonl`), "utf8")
    ).split("\n");
    const result = parseStream(lines);
    result.exitCode = old.exit_code;
    result.durationMs = old.duration_ms;
    const directory = join(out, "tasks", name);
    const files: Record<string, string | null> = Object.fromEntries(
      await Promise.all(
        task.outcomeFiles.map(
          async (file): Promise<[string, string | null]> => [
            file,
            await readFile(join(directory, file), "utf8").catch(() => null),
          ],
        ),
      ),
    );
    // Seed and task-run identities are only known to the original run; keep its verdicts.
    const seedIds = new Set<string>();
    const record = scoreRun({
      task,
      history: old.history,
      run: old.run,
      ticket: old.ticket,
      result,
      audit: old.audit.map((row) => ({
        action: row.action,
        input: row.input,
        sessions: row.sessions,
      })),
      seedIds,
      taskSessionIds: new Set(),
      hints: await hintsSeen(configDirectory, result.sessionId),
      files,
    });
    record.first_result_has_seed = old.first_result_has_seed;
    record.any_result_has_seed = old.any_result_has_seed;
    record.any_result_has_task_run = old.any_result_has_task_run;
    records.push(record);
  }
  const summary = summarize(records, previous.options.histories as History[]);
  console.log(summary);
  await writeFile(
    join(out, `results-${label}-rescored.json`),
    JSON.stringify({ ...previous, records }, null, 2),
  );
  await writeFile(join(out, `summary-${label}.md`), summary + "\n");
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
