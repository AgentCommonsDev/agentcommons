// Diagnostic extension: record native events and read-only session context before
// implementing the ingestion adapter. Load explicitly with pi -e this-file.
import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export default function capture(pi) {
  const directory = process.env.AGENTCOMMONS_CAPTURE_DIR;
  if (!directory) throw new Error("AGENTCOMMONS_CAPTURE_DIR is required");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const name of [
    "session_start",
    "input",
    "before_agent_start",
    "agent_start",
    "turn_start",
    "message_start",
    "message_end",
    "tool_call",
    "tool_result",
    "tool_execution_start",
    "tool_execution_end",
    "turn_end",
    "agent_end",
    "session_before_switch",
    "session_before_fork",
    "session_before_tree",
    "session_tree",
    "session_before_compact",
    "session_compact",
    "session_shutdown",
  ]) {
    pi.on(name, (event, context) => {
      const transcriptPath = context.sessionManager.getSessionFile();
      const observation = {
        event,
        sessionId: context.sessionManager.getSessionId(),
        transcriptPath,
        activeLeafId: context.sessionManager.getLeafId(),
        cwd: context.cwd,
      };
      appendFileSync(
        join(directory, "events.jsonl"),
        `${JSON.stringify(observation)}\n`,
        { mode: 0o600 },
      );
      if (transcriptPath) {
        try {
          copyFileSync(
            transcriptPath,
            join(directory, `${Date.now()}-${name}.transcript`),
          );
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    });
  }
}
