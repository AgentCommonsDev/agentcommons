# Native delegation capture, 2026-09-08

Gemini CLI 0.35.3 was executed with `gemini-2.5-flash`, an isolated
`GEMINI_CLI_HOME`, `--approval-mode yolo`, and `--output-format stream-json`.
The prompt required one native `generalist` call whose task read `probe.txt` and
returned its contents, followed by a parent `read_file` call. The file contained
`NATIVE-GEMINI-DELEGATION-CONTRACT-20260908`. The CLI exited zero and returned both
observations. This was a real provider-backed invocation, not a fabricated tool event.

Every supported shell hook was configured to execute `scripts/capture-hook.mjs`,
which saved stdin and a contemporaneous copy of the referenced transcript. The
privately supplied Gemini key was injected through the environment; inherited
`OPENAI_API_KEY` was removed. The AgentCommons upload extension was disabled to keep
this contract capture separate from the live acceptance instance. Raw files remain
in the private temporary capture directory and are not committed.

All committed payloads passed through the production `Redactor.json` without
manual changes. The redactor reported zero matches. Evidence is:

- `fixtures/hooks/gemini-cli-0.35.3-delegation-events.jsonl`: thirty hook payloads.
- `fixtures/transcripts/gemini-cli/delegation/01-before.json` through `05-final.json`:
  five observed transcript snapshots.
- `fixtures/transcripts/gemini-cli/delegation/native-stream.jsonl`: native CLI output.

The hook counts were BeforeAgent 1, BeforeModel 5, BeforeToolSelection 5, AfterModel 12,
BeforeTool 3, AfterTool 3, and AfterAgent 1. SessionStart and SessionEnd were configured
but did not fire in this headless invocation. Tool hooks observed `generalist`, the
child's `read_file`, and the parent's `read_file`, in that order. All thirty hooks
reported the same session ID and transcript path. Only one chat file existed.

The child-completed snapshot has five messages. When the parent resumes, that same
file has two messages. The final snapshot has four messages and contains the parent's
`generalist` call/result and its own `read_file` call/result. The native generalist
result states that the subagent reached its goal. Intermediate child messages are
real evidence, but the final parent document no longer contains them.

Installed Gemini source corroborates the observation: built-in agent registration
precedes the experimental custom-agent gate; `generalist` is a built-in agent.
`LocalAgentExecutor` creates a subagent chat with the same configuration, while hook
payloads use the root configuration's session ID and transcript path. This capture
provides no distinct child-session identity. AgentCommons must preserve observed raw
versions and native delegation tools, without manufacturing a child session or link.
Current-document projection must exclude slots removed by a later shrink.

## pi capability boundary

Installed pi 0.73.1 documents no built-in subagents. Its bundled optional
`examples/extensions/subagent/index.ts` extension registers a `subagent` tool and
spawns a separate pi process with `--mode json -p --no-session`. That example is not
part of the AgentCommons extension and does not provide a persisted child transcript.
It is therefore not evidence of native child-session capture. Pi's separately captured
fork, resume, and active-tree behavior remains supported. This source inspection is
not claimed as a live execution of the optional subagent example.
