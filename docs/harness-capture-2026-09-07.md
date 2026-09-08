# Live harness capture, 2026-09-07

These are contract captures, not dashboard or MCP canary results. Every transcript
and event below came from a running installed harness. No adapter was written before
these captures. Raw captures remain outside the repository under
`/tmp/agentcommons-live-capture/`. Fixture files passed `@secretlint/core` with
`@secretlint/secretlint-rule-preset-recommend` and `@secretlint/secretlint-rule-pattern`
(OpenAI/Anthropic, Google, GitHub, JWT, connection-string patterns). This corpus
produced zero matches. The production `Redactor.json` implementation subsequently
rechecked all 18 captured files and reported zero matches.

## Reproduction

`scripts/capture-hook.mjs` writes actual JSON hook stdin and copies the current
transcript on each hook. Set `AGENTCOMMONS_CAPTURE_DIR` to a private directory outside
the repository. Configure every event with `node /absolute/path/capture-hook.mjs`.
This diagnostic recorder is separate from the ingestion shim.

Gemini settings were local to `/tmp/agentcommons-live-capture/gemini/repo/.gemini/`.
The command was `gemini --prompt 'Use read_file to read probe.txt, then use
run_shell_command to run printf capture-second-tool. Reply with the file content and
command output.' --approval-mode yolo </dev/null`. An API credential supplied by the
user was passed privately in `GEMINI_API_KEY`. It was never written to the project,
hook config, command arguments, or fixture payloads.

Pi 0.73.1 was installed with npm under `/tmp/agentcommons-capture-tools/`, outside
the workspace. The CLI loaded `scripts/capture-pi.mjs` explicitly with `--extension`,
disabled discovered extensions/skills/context, used the Google provider and
`gemini-2.5-flash`, and was asked to read `probe.txt`. The same private provider
credential was supplied through the environment. `scripts/capture-pi-lifecycle.mjs`
then used the installed real SDK and provider to exercise tree navigation, fork,
resume, and shutdown. It calls the SDK's actual lifecycle operations; events and
session records are emitted by pi itself.

Claude used `claude --print --settings <capture-settings> --allowedTools Read,Agent
-- <prompt> </dev/null`. The prompt requested Read and an Explore subagent that read
the same file. Codex used `codex exec --dangerously-bypass-hook-trust --sandbox
read-only -C <capture-project> <read-file-prompt> </dev/null`.

## Gemini CLI 0.35.3

Session `e8c0026d-b5c8-49ec-af84-6eaf5fa5ced5`, 22:10:18–22:10:22 UTC, model
`gemini-3-flash-preview`. Fixture `hooks/gemini-cli-0.35.3-tool-events.jsonl` contains
the successful session's complete captured stream; the older session-only fixture
is retained unchanged.

All events have `session_id`, `transcript_path`, `cwd`, `hook_event_name`,
`timestamp`. Additional observed fields:

| Event                            | Additional fields                         |
| -------------------------------- | ----------------------------------------- |
| SessionStart                     | source                                    |
| BeforeAgent                      | prompt                                    |
| BeforeTool                       | tool_name, tool_input                     |
| AfterTool                        | tool_name, tool_input, tool_response      |
| AfterAgent                       | prompt, prompt_response, stop_hook_active |
| BeforeModel, BeforeToolSelection | llm_request                               |
| AfterModel                       | llm_request, llm_response                 |
| PreCompress                      | trigger                                   |
| SessionEnd                       | reason                                    |

`mcp_context` and `original_request_name` were absent for the built-in tools used
here; do not require them. Two `SessionEnd` events with `reason: exit` were emitted
for the same successful session. `AfterModel` fired more than once per response.

The numbered `transcripts/gemini-cli/*.json` files are full document snapshots in
capture order. Existing message `14d2470f-44b3-4117-b7e2-0570571cc072` has no
`toolCalls` in snapshot 02 or snapshot 03 (taken inside `AfterTool`). Snapshot 04,
taken at the following `PreCompress`, adds two completed tool calls and results to
the same message id and array index. Its original `timestamp` is unchanged. Snapshot
05 adds the final assistant response. An array-index cursor alone loses tool data;
the adapter requires message content hashes and a latest-version projection.
An `AfterTool` hook may precede persistence of that tool's result, so the later
`AfterAgent` and `SessionEnd` syncs must drain the final document.

User `content` is an array of `{text}` objects; assistant `content` is a string.
Tool input is `toolCalls[].args`; results are
`toolCalls[].result[].functionResponse.response`. Token fields observed are
`input`, `output`, `cached`, `thoughts`, `tool`, and `total`. The document also has
`kind: main`, which must survive raw parsing.

## Pi 0.73.1

CLI session `01a07deb-d8cc-7158-bdc6-d421ec5341f4`, 22:10:03–22:10:06 UTC, and SDK
session `01a07ded-e222-7379-90d5-02afba4902df`, 22:12:17–22:12:23 UTC. Fixtures are
`hooks/pi-0.73.1-cli-events.jsonl`, `hooks/pi-0.73.1-lifecycle-events.jsonl`, and
`transcripts/pi/`. Each event is stored in a diagnostic wrapper with the untouched
native `event` plus `sessionId`, `transcriptPath`, `activeLeafId`, and `cwd` read
from that event's real extension context.

| Event            | Observed native fields                               |
| ---------------- | ---------------------------------------------------- |
| session_start    | type, reason, previousSessionFile (fork/resume only) |
| input            | type, text, source                                   |
| tool_result      | type, toolName, toolCallId, input, content, isError  |
| agent_end        | type, messages                                       |
| session_tree     | type, newLeafId, oldLeafId                           |
| session_shutdown | type, reason, targetSessionFile (replacement only)   |

CLI `--print` input reports `source: interactive`; do not infer terminal mode from
that field. All six events are observational; the capture extension returns no
replacement or blocking result.

`session_tree` immediately changes `getLeafId()` without adding an entry to the
transcript. The ingestion extension must sync this event as well as input,
tool_result, and agent_end. The old branch's messages remain in the append-only file;
the alternate branch shares its ancestor via `parentId`.

Fork produces `session_shutdown {reason: fork, targetSessionFile}` on the old
session, then `session_start {reason: fork, previousSessionFile}` on the new session.
The new header has a fresh session id and `parentSession` containing the full source
session **file path**, not the source id. Entries copied to the fork retain their
native ids and parent ids. Resume produces the analogous shutdown/start pair with
`reason: resume`; the resumed source keeps its original session id. Final shutdown
has `reason: quit` and no destination path.

The observed record types are `session`, `model_change`, `thinking_level_change`,
and `message`. Messages include user, assistant (text/thinking/toolCall blocks), and
toolResult. The broader documented record types remain permissive raw inputs until
they are captured or covered by explicit synthetic edge fixtures.

## Claude Code 2.1.263 and Codex 0.153.4

Claude session `93db0511-4472-4f3b-90be-899be97a89d1` completed Read plus Explore
subagent `ab38e423152bb70b9`. The parent and child files are captured separately.
Subagent tool hooks still name the parent's `transcript_path`; `SubagentStop` names
the child via `agent_transcript_path`, matching the existing Appendix A contract.

Codex session `01a07dec-42d7-7f80-982a-ac0990a52831` completed a real shell read;
`transcripts/codex/tool.jsonl` is its actual rollout. A later session,
`01a07df5-0e59-77c1-8d3d-d649da83637e`, completed a shell read and native subagent
`01a07df5-3d12-7ea1-9f0d-a8f906f862b3`. The full event stream is
`hooks/codex-0.153.4-live-tool-events.jsonl`; parent and child transcripts are
`transcripts/codex/parent-with-subagent.jsonl` and `subagent.jsonl`.

Local hook config did not fire on 0.153.4 in this capture project, including with
explicit hook-trust bypass and project trust. Supplying the identical definitions
through command-line inline `-c 'hooks.EVENT=[{hooks=[{type="command",command="...",
timeout=3}]}]'` tables did fire all configured lifecycle/tool hooks. The
[official hook documentation](https://learn.chatgpt.com/docs/hooks) describes both
representations. Discovery of the project file remains an installer/canary issue
to resolve separately from the now-captured event contract.

For `SubagentStart`, `session_id` identifies the **parent**, but `transcript_path`
names the **child** rollout. For `SubagentStop`, `transcript_path` names the parent
and `agent_transcript_path` names the child. Both have `agent_id` and `agent_type`.
The child `session_meta.payload.id` is the child's id;
`source.subagent.thread_spawn.parent_thread_id` identifies its parent. Do not
overwrite the parent's transcript path with the `SubagentStart` field.

Codex 0.153.4 uses `custom_tool_call_output` with an array of `input_text` output
blocks. It also emits `token_usage_record` alongside cumulative `event_msg`
`token_count` records; counting both would duplicate usage. The normalizer uses
the latter and keeps the former raw-only. Claude repeats identical message usage
on separate records with one shared `message.id` and different `apiBlockIndex`;
usage is counted once per native message rather than once per record.

## Authentication observations

Before the user supplied the Gemini key, existing Gemini OAuth failed during Code
Assist onboarding with quota exhaustion. Both existing OpenAI environment keys
returned HTTP 401 when used by pi. These attempts did not produce successful
tool captures and are excluded from the new fixtures. Gemini API-key auth and pi's
Google provider completed the captures above; Claude and Codex used their existing
local credentials.

## Resume confirmation, 2026-09-08

Claude Code 2.1.263 resumed the captured session
`93db0511-4472-4f3b-90be-899be97a89d1` with `--print --resume <id>` and the original
capture settings. Gemini CLI 0.35.3 resumed
`e8c0026d-b5c8-49ec-af84-6eaf5fa5ced5` with `--resume <id> --prompt <prompt>` in the
original project. Both were asked to reply with `native-resume-confirmed` without
tools, and both exited zero. Their `SessionStart` payloads contain `source: resume`
and preserve the session ID. Claude supplies no hook timestamp; Gemini supplies an
ISO timestamp. Gemini again emitted two terminal `SessionEnd` events.

The untouched JSONL streams are
`fixtures/hooks/claude-code-2.1.263-resume-events.jsonl` (four records) and
`fixtures/hooks/gemini-cli-0.35.3-resume-events.jsonl` (ten records). The production
redactor found no secrets in either stream before they were copied into fixtures.
Private transcript snapshots remain under each tool's `resume/` capture directory.

## Codex 0.153.4 persisted installation and resume (2026-09-08)

A private unique `~/.codex/agentcommons-install-probe.config.toml` profile containing
inline hooks fired all four lifecycle callbacks under `codex exec --profile
agentcommons-install-probe --dangerously-bypass-hook-trust --sandbox read-only` with
Astra/high. A separate run temporarily appended the same inline definitions to the real
user config; it passed and the original config was restored byte-for-byte. These native
payloads are in `fixtures/hooks/codex-0.153.4-persisted-config-events.jsonl`.

Resuming the resulting session with the same exec options plus `resume <session-id>`
fired SessionStart with `source: "resume"`, then UserPromptSubmit, Stop and SessionEnd.
The unchanged native payloads are in `fixtures/hooks/codex-0.153.4-resume-events.jsonl`.
A duplicate-definition experiment fired each start/end twice: handler PIDs differed,
but all four had one owning Codex PID and Linux process birth tick. This diagnostic
process metadata was recorded separately; native stdin payloads were not modified.
All temporary profile/config changes were removed after each run.
