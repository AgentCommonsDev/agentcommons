# Live opencode capture, 2026-11-27

These are contract captures for the opencode harness, made before the adapter was relied
on and repeated with the final plugin. Every payload and document below came from a
running opencode engine on macOS (arm64). Raw captures remain outside the repository.
Fixture files passed the production `Redactor` and `pnpm fixtures:check` with zero
matches.

## Two engines

opencode ships two engine lines with different plugin interfaces and stored shapes.

|                   | opencode 1.x                                       | opencode 2.x                                                                                                |
| ----------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Captured version  | 1.19.6 (npm `opencode-ai`, `latest` on 2026-11-27) | 2.4.1 (the desktop app's bundled `opencode-cli`; npm `@opencode/cli` is 2.4.2)                              |
| Where plugins run | in each `opencode` process                         | in the long-lived `serve --service` process the desktop app starts, or a private server with `--standalone` |
| Plugin interface  | `server(input)` returning hooks                    | default export `{ id, setup(context) }`; 1.x plugins are rejected                                           |
| Stored message    | `{ info, parts[] }`                                | flat message with `type`                                                                                    |

Both read `~/.config/opencode/` and share `~/.local/share/opencode/opencode.db`, and both
load every `.js` file in `~/.config/opencode/plugin/`.

## Reproduction

`scripts/capture-opencode.mjs <opencode executable> <plugin file> <capture directory>`
runs two scripted `run` invocations against one session: the first writes a file, runs a
shell command the cached policy denies, starts a subagent and waits for its report; the
second continues the session. Everything runs in private `XDG_*` directories under the
capture directory, with `AGENTCOMMONS_DIR` pointing at a stand-in `hook.js` that appends
each payload to `events.jsonl` and copies the documents it names. The model was
`openrouter/deepseek/deepseek-v4.1-flash-1017`; the OpenRouter key was passed in the
environment and never written anywhere. The plugin file is the bundle
`packages/hook/opencode-plugin-bundle.ts` produces.

## Observations

- **One file, both interfaces.** A default export carrying `id`, `setup` and `server`
  loads in both engines. 1.19.6 calls `server()` and also runs an early 2.x loader that
  calls `setup()` with a context holding only `options, agent, aisdk, catalog, command,
integration, plugin, reference, skill`; with no `event`, `session` or `tool` domain the
  plugin does nothing there, so a session is recorded once.
- **Events.** 1.x: `event` delivers `session.created` (with `info.parentID` for a child),
  `session.idle` per session, `session.deleted`; `chat.message` per prompt;
  `tool.execute.after` per call. 2.x: `ctx.event.subscribe()` delivers `session.created`
  for child sessions but not for a top-level session started by `run`, and
  `session.execution.succeeded/failed/interrupted` per turn; `ctx.session.hook("prompt")`
  and `ctx.tool.hook("execute.after")` fire per prompt and call. The plugin therefore
  sends `session.start` on the first event it sees for a session in a process, and
  `source: "resume"` when that session's document already exists.
- **Reading a session.** 1.x `client.session.messages` returns every message. 2.x
  `ctx.session.context` returns only the messages after the last compaction: after a
  forced compaction it went from 17 messages to 2, while `opencode-cli session export`
  still listed all 20. The plugin merges each read into the stored document by message id.
- **Messages change in place.** An assistant message gains content and its tool calls
  move from `running` to `completed` or `error` under the same id, so the
  `json-document` reader's per-position versions apply unchanged.
- **Blocking a call.** An error thrown from `tool.execute.before` (1.x) or
  `execute.before` (2.x) stops the call; the stored tool state is `error` with the
  thrown message, and the model sees it as the tool's result.
- **System prompt.** A string pushed in `experimental.chat.system.transform` (1.x) or a
  `{ type: "text", text }` part pushed in the `context` hook (2.x) reached the model.
- **Shutdown.** 1.19.6 `run` calls `dispose` but exits before a child process started in
  its last moments reads its stdin, and an exit handler alone did not help; the last
  turn's event and the end were lost. The plugin now waits for queued events in
  `dispose` and runs `hook.js` synchronously for the ends; both captures then show
  `session.end` and `subagent.end`.
- **Subagents.** A child session records `parentID`. The parent's call result metadata
  names the child: 1.x tool `task`, `state.metadata.sessionId`; 2.x tool `subagent`,
  `state.metadata.sessionID`.
- **Working directory.** opencode takes its directory from `PWD` when set, not from the
  process's working directory; the capture script sets both.

## Live canary findings

Running `scripts/live-canary.ts` with both opencode entries surfaced three behaviours the
captures above did not:

- **Plugin reload.** opencode 2.x reloads a plugin whose file changes, mid-session: it runs
  the old copy's cleanup and calls `setup()` on a new copy in the same process. The
  canary's self-update re-runs the installer, which rewrote the plugin. The plugin now keeps
  its recorded sessions per process and sends ends only from the process exit handler, and
  the installer leaves an unchanged plugin file alone.
- **Code mode.** For MCP tools, 2.x usually has the model write a script run by one
  `execute` call; the stored call lists the inner calls in `state.metadata.toolCalls`. The
  normalizer keeps them in the `TOOL_USE` input.
- **Cached catalog.** 1.19.6 lists the MCP catalog in its first process and later
  processes call tools without listing it again.

The canary also exposed a shim race independent of opencode: a child's intents published
while another uploader held the child were left unprocessed after the session ended (§6.2).

## Fixture sanitization

Capture paths were replaced with `/tmp/agentcommons-live-capture/opencode-<version>`.
opencode 2.x stores `time.firstToken`, a 13-digit millisecond timestamp; the text-level
`token` redaction rule reads `firstToken": 1795…` as a credential, so the 2.x fixture
documents leave out that one field. Ingestion is unaffected: the server redacts raw
records by structure, numbers are not scanned, and the normalizer's redaction structure
declares the key.
