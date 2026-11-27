// Run scripted opencode sessions through the AgentCommons plugin and record what the plugin
// hands the shim: every `hook.js opencode` payload, and each session document at that moment.
// A stand-in hook.js records instead of uploading, and a cached policy denies one command, so
// the capture covers a blocked call. Everything runs in private XDG directories under the
// capture directory; the caller's opencode configuration and database are not touched.
//
//   node scripts/capture-opencode.mjs <opencode executable> <plugin file> <capture directory>
//
// The executable is opencode 1.x (`opencode`) or 2.x (`opencode-cli`, which is given
// `--standalone`). OPENROUTER_API_KEY is supplied by the caller; OPENCODE_CAPTURE_MODEL picks
// the model (an inexpensive OpenRouter model by default).
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [executable, plugin, target] = process.argv.slice(2);
if (!executable || !plugin || !target)
  throw new Error(
    "opencode executable, plugin file and capture directory are required",
  );
if (!process.env.OPENROUTER_API_KEY)
  throw new Error("OPENROUTER_API_KEY is required");
const root = resolve(target);
const model =
  process.env.OPENCODE_CAPTURE_MODEL ??
  "openrouter/deepseek/deepseek-v4.1-flash-1017";
const xdg = Object.fromEntries(
  ["config", "data", "state", "cache"].map((name) => [
    name,
    join(root, "xdg", name),
  ]),
);
const shim = join(root, "agentcommons");
const project = join(root, "project");
for (const directory of [
  ...Object.values(xdg),
  shim,
  project,
  join(root, "documents"),
])
  mkdirSync(directory, { recursive: true, mode: 0o700 });
mkdirSync(join(xdg.config, "opencode", "plugin"), { recursive: true });
copyFileSync(plugin, join(xdg.config, "opencode", "plugin", "agentcommons.js"));
writeFileSync(
  join(xdg.config, "opencode", "opencode.json"),
  JSON.stringify({ model, autoupdate: false, share: "disabled" }),
);
writeFileSync(
  join(shim, "config.json"),
  JSON.stringify({ node: process.execPath }),
);
writeFileSync(
  join(shim, "tool-policy.json"),
  JSON.stringify({
    enabled: true,
    rules: [
      {
        id: "capture-deny",
        harnesses: ["OPENCODE"],
        tool: "*",
        command_patterns: [{ kind: "substring", value: "BLOCKME" }],
        action: "deny",
        severity: "high",
        description: "Capture: a denied command.",
      },
    ],
  }),
);
// The stand-in shim: one line per payload, and a copy of each document it names.
writeFileSync(
  join(shim, "hook.js"),
  `const fs = require("node:fs"), path = require("node:path");
const input = fs.readFileSync(0, "utf8");
const event = JSON.parse(input);
const root = ${JSON.stringify(root)};
fs.appendFileSync(path.join(root, "events.jsonl"), JSON.stringify({ argv: process.argv.slice(2), event }) + "\\n");
for (const file of [event.transcript_path, event.agent_transcript_path])
  if (file && fs.existsSync(file))
    fs.copyFileSync(file, path.join(root, "documents", Date.now() + "-" + process.pid + "-" + event.hook_event_name + "-" + path.basename(file)));
`,
);
const standalone = /opencode-cli$/.test(executable) ? ["--standalone"] : [];
function run(args) {
  const result = spawnSync(
    executable,
    ["run", ...standalone, "--auto", "--format", "json", ...args],
    {
      cwd: project,
      env: {
        ...process.env,
        // opencode takes its working directory from PWD when it is set.
        PWD: project,
        XDG_CONFIG_HOME: xdg.config,
        XDG_DATA_HOME: xdg.data,
        XDG_STATE_HOME: xdg.state,
        XDG_CACHE_HOME: xdg.cache,
        AGENTCOMMONS_DIR: shim,
      },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 300_000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `opencode run failed (${String(result.status)}): ${result.stderr.slice(-2000)}`,
    );
  return result.stdout;
}
const first = run([
  "--title",
  "agentcommons-capture",
  "Do these steps in order. 1) Use the write tool to create probe.txt containing the line 'probe content'. 2) Run the shell command: echo BLOCKME. If it is blocked, say so and continue. 3) Start a general subagent that reads probe.txt and reports its contents. 4) When the subagent has reported, reply DONE.",
]);
const sessionId = first.split("\n").flatMap((line) => {
  try {
    const value = JSON.parse(line);
    return typeof value.sessionID === "string" ? [value.sessionID] : [];
  } catch {
    return [];
  }
})[0];
if (!sessionId) throw new Error("The first run reported no session.");
// A second process continues the session, so the capture shows a resumed session.
run(["--session", sessionId, "Reply with the single word AGAIN."]);
writeFileSync(join(root, "session.txt"), `${sessionId}\n`);
console.log(
  `Captured ${readFileSync(join(root, "events.jsonl"), "utf8").split("\n").filter(Boolean).length} payloads for ${sessionId} in ${root}`,
);
