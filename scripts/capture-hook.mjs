// Capture actual hook stdin unchanged. Raw captures stay outside the repository until
// the repository redactor has processed them.
import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const directory = process.env.AGENTCOMMONS_CAPTURE_DIR;
if (!directory) throw new Error("AGENTCOMMONS_CAPTURE_DIR is required");
mkdirSync(directory, { recursive: true, mode: 0o700 });
let input = "";
for await (const chunk of process.stdin) input += chunk;
const event = JSON.parse(input);
appendFileSync(join(directory, "hooks.jsonl"), `${JSON.stringify(event)}\n`, {
  mode: 0o600,
});
if (typeof event.transcript_path === "string") {
  try {
    const name = `${Date.now()}-${process.pid}-${event.hook_event_name}`;
    copyFileSync(event.transcript_path, join(directory, `${name}.transcript`));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
