# Pre-tool veto contract capture, 2026-09-14

Live proof, per supported harness, of how a hook or extension can stop a tool call before
it runs. Every fixture under `fixtures/hooks/*-tool-policy-*.jsonl` is a real capture:
`-events` files are the harness stdin (or pi extension event) bytes unchanged, `-decisions`
files are the records the capture hook wrote about its own stdout, stderr and exit code, and
`-outcomes` files are the native transcript records for the same calls, extracted by id. The
proof of a block is the working directory after the run: only the files whose `touch` the
hook allowed exist, and the model's transcript shows the denial where the tool result would
have been. Nothing here is built from documentation alone.

Versions: Claude Code 2.1.266, Codex 0.153.4, Gemini CLI 0.35.3, pi 0.73.1.

## Contract table

| Harness             | Event                                                                    | Block (verified)                                                                                                                                                                                        | Allow                                                                                                                                                                 | Timeout field and overrun                                                                                                                                          | What the model receives                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code 2.1.266 | `PreToolUse` (settings `hooks.PreToolUse`)                               | stdout `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":R}}` exit 0; or `{"decision":"block","reason":R}` exit 0; or exit 2 with R on stderr | exit 0 with no stdout, or `permissionDecision:"allow"` (stored as a `hook_success` attachment)                                                                        | `timeout` in seconds, default 60. Overrun: hook killed (`hook_cancelled`, 3046 ms at `timeout: 3`) and the tool runs. Exit 1: `hook_non_blocking_error`, tool runs | `tool_result` `is_error:true`, content is R verbatim for both JSON shapes; exit 2 gives `PreToolUse:Bash hook error: [<command>]: R`. No `PostToolUse` for a blocked call                   |
| Codex 0.153.4       | `PreToolUse` (`[[hooks.PreToolUse]]` in `config.toml`, hooks need trust) | Same three forms as Claude; `permissionDecision:"deny"` requires a non-empty `permissionDecisionReason` (binary validation)                                                                             | exit 0 with no stdout. `permissionDecision:"allow"`/`"ask"` and `decision:"approve"` are marked unsupported by the binary; the live allow run still executed silently | `timeout` in seconds. Overrun at 3 s: hook killed, tool runs 3.2 s after the call (no warning in `--json` or the rollout). Exit 1: tool runs, no warning           | `custom_tool_call_output` = `Script failed … Script error:\nCommand blocked by PreToolUse hook: R. Command: <cmd>` (shell) or `Tool call blocked by PreToolUse hook: R. Tool: <name>` (MCP) |
| Gemini CLI 0.35.3   | `BeforeTool` (settings `hooks.BeforeTool`)                               | stdout `{"decision":"deny","reason":R}` exit 0 (alias `"block"`); or exit 2 with R on stderr (logged as a failed hook, still blocks)                                                                    | exit 0 with no stdout, or `{"decision":"allow"}`                                                                                                                      | `timeout` in milliseconds, default 60000. Overrun: `Hook timed out after 3000ms`, tool runs. Exit 1: `Warning: hook crashed`, tool runs                            | toolCall `status:"error"`, `functionResponse.response.error = R`, `resultDisplay: "Tool execution blocked: R"`; no `AfterTool`                                                              |
| pi 0.73.1           | extension `tool_call` (after `tool_execution_start`, before execution)   | handler returns `{ block: true, reason: R }`                                                                                                                                                            | handler returns `undefined`                                                                                                                                           | none; the handler is awaited in-process. A throwing handler blocks the call with its message (fail closed)                                                         | `toolResult` `isError:true`, content text R; `tool_execution_end` `isError:true`; `tool_result` does not fire; the next model request carries R as the tool message                         |

Two facts the enforcement build depends on:

- Claude Code, Codex and Gemini fail open. A hook that overruns its timeout, exits with a
  code other than 0 or 2, or writes malformed output lets the tool run, and only Claude and
  Gemini even warn. The decision must be local, offline and fast; the capture hook decided in
  4 to 11 ms after reading stdin, with a fresh Node process on top of that. pi is the
  exception: an exception in the handler blocks the call.
- `{"decision":"block","reason":R}` on stdout with exit 0 blocked the call in all three
  shell-hook harnesses, and exit 2 with the reason on stderr did too (Claude wraps that
  reason with the hook command). The reason reaches the model verbatim in every harness;
  Codex prefixes it.

## Payloads

Fields are the same as the lifecycle captures in Appendix A; only the pre-tool cases are
new.

- Claude Code `PreToolUse`: `session_id, transcript_path, cwd, permission_mode, prompt_id,
effort, hook_event_name, tool_name, tool_input, tool_use_id`. `Bash` carries
  `tool_input.command` (the full command string) and `description`; an MCP tool is
  `tool_name: mcp__<server>__<tool>` with the call arguments as `tool_input`. The hook fires
  under `--allowedTools` grants and in `--print`.
- Codex `PreToolUse` (embedded schema `pre-tool-use.command.input`, all required):
  `session_id, turn_id, transcript_path, cwd, hook_event_name, model, permission_mode
(default|acceptEdits|plan|dontAsk|bypassPermissions), tool_name, tool_input, tool_use_id`,
  plus `agent_id`/`agent_type` in a subagent. The shell tool is `Bash` with
  `tool_input.command`, including commands the model runs through `tools.exec_command`
  inside a script; MCP tools are `mcp__<server>__<tool>`; `tool_use_id` is `exec-<uuid>`.
- Gemini `BeforeTool`: `session_id, transcript_path, cwd, hook_event_name, timestamp,
tool_name, tool_input` and, for MCP tools, `mcp_context {server_name, tool_name, command,
args}`. The shell tool is `run_shell_command` with `tool_input.command`, `description` and
  `wait_for_previous`; MCP tools are `mcp_<server>_<tool>`. There is no tool use id.
- pi `tool_call`: `{ type: "tool_call", toolName, toolCallId, input }` with `input` mutable;
  the context exposes `sessionManager.getSessionId()/getSessionFile()/getLeafId()`, `cwd`
  and `hasUI`. Built-in `bash` carries `input.command`; bridge tools arrive under their
  registered `agentcommons_<tool>` names.

## Output shapes accepted by Codex 0.153.4

The binary embeds `pre-tool-use.command.output`: top-level `continue`, `decision`
(`approve|block`), `hookSpecificOutput` (`hookEventName:"PreToolUse"`, `permissionDecision`
`allow|deny|ask`, `permissionDecisionReason`, `additionalContext`, `updatedInput`),
`reason`, `stopReason`, `suppressOutput`, `systemMessage`. Its validation messages name the
unsupported combinations: `permissionDecision:allow`, `permissionDecision:ask`,
`decision:approve`, `continue:false`, `stopReason`, `suppressOutput`, `updatedInput` without
`permissionDecision:allow`, `deny` without a non-empty reason, `reason` without `decision`,
and exit 2 without a stderr reason.

## Method

Every run used an isolated configuration and never read or wrote the workstation's real
`~/.claude`, `~/.codex`, `~/.gemini` or `~/.pi`; the user's credential files were copied
(0600) into the isolated homes and their modification times were unchanged afterwards.
One capture hook (`tool-policy-hook.mjs`) served all three shell-hook harnesses: it appended
stdin to `hooks.jsonl`, chose a decision from a sentinel in the tool arguments
(`tp-block-json`, `tp-block-exit2`, `tp-block-legacy`, `tp-allow-json`, `tp-timeout` which
sleeps 8 s, `tp-exit1`), recorded what it emitted in `decisions.jsonl`, and was configured
with a 3 s timeout in the second round. A one-tool stdio MCP server (`tpecho.echo`) showed how
MCP calls reach the hook. The prompt asked for `touch tp-<sentinel>.txt` per step and `ls`
at the end.

- Claude Code: `CLAUDE_CONFIG_DIR=<temp>` with a copied credential file and
  `{"hasCompletedOnboarding":true}`, `claude --print --settings <temp>/settings.json
--mcp-config <temp>/mcp.json --strict-mcp-config --allowedTools "Bash,mcp__tpecho__*"`,
  nested-session variables unset, stdin from `/dev/null`. The MCP entry carried
  `alwaysLoad: true`.
- Codex: `CODEX_HOME=<temp>` with a copied `auth.json` (ChatGPT tokens with days of
  validity, so no refresh) and an inline `[[hooks.PreToolUse]]` table; `codex exec
--dangerously-bypass-hook-trust --sandbox workspace-write --skip-git-repo-check --json`,
  `OPENAI_API_KEY` unset. `codex exec` refused the allowed MCP call itself ("MCP tool call
  requires approval, but approval policy is never") after the hook had fired; that is
  Codex's approval policy, not the hook contract.
- Gemini: `HOME=<temp>` with `.gemini/settings.json` holding `hooks.BeforeTool`,
  `hooks.AfterTool`, `mcpServers` and `security.auth.selectedType: "gemini-api-key"`;
  `gemini --prompt … --approval-mode yolo --allowed-mcp-server-names tpecho` with the private
  `GEMINI_API_KEY`.
- pi: the real CLI, `pi -p --no-extensions -e <extension> --provider agentcommons-mock
--model scripted --session-dir <temp>` with `HOME` and `PI_CODING_AGENT_DIR` pointed at
  temporary directories and a credential-free OpenAI-compatible mock model that replayed
  `touch tp-plain.txt`, `touch tp-block-json.txt`, `touch tp-throw.txt`, `ls` and then quoted
  every tool message it had received. The extension recorded `tool_execution_start`,
  `tool_call`, `tool_result`, `tool_execution_end` and `agent_end`, blocked the second
  command and threw on the third.

Observed directories after the runs: Claude, Codex and Gemini each held `tp-plain.txt` and
`tp-allow-json.txt` only after round one and `tp-timeout.txt` plus `tp-exit1.txt` after
round two; pi held `tp-plain.txt` only. Sessions (round one, round two): Claude
`bdd7c9b1-8934-4bc2-926a-4673d5d46e9a`, `c83d632f-9ea7-4bbc-b8df-1a464b8f4258`; Codex
`01a09f2e-9f06-7a13-a560-f66ca3e3eb33`, `01a09f31-09f6-74d1-8409-fa0dd00ccf9a`; Gemini
`0f02247d-c0b2-4fe8-8ff2-58d1f05facdf`, `cfb7eb06-0db8-4fbd-86a5-a3264f8f6a87`; pi
`01a09f31-1a46-74b2-a891-8af28f1f6411`, `01a09f33-3df0-7615-b6f0-719fab66990c`.

## Warn but allow (round three, Codex and Gemini)

A hook that wants to let the call run while saying something has two documented channels,
`systemMessage` (user-facing) and `hookSpecificOutput.additionalContext` (model-facing). Both
were emitted together for `touch tp-warn-json.txt` and `systemMessage` alone for
`touch tp-warn-sysmsg.txt`; both commands ran in both harnesses.

- Codex 0.153.4: `additionalContext` reached the model as a `developer` message
  (`response_item` `message`, `role: "developer"`, `content_item_kinds:
["hooks.additional_context"]`) and the model quoted it back. `systemMessage` produced nothing
  visible in `codex exec --json` events, stderr or the rollout.
- Gemini CLI 0.35.3: `systemMessage` was printed to stderr as `Hook system message: …`;
  `additionalContext` on `BeforeTool` did not reach the model (the reference documents it for
  `AfterTool` only) and the model reported no extra context.
- Claude Code: not run in this round (the isolated credential copy was too close to its
  expiry); the reference documents `systemMessage` and `hookSpecificOutput.additionalContext`
  on `PreToolUse`, and `permissionDecision: "ask"` as an interactive prompt.
- pi: the extension API has no warn return; a handler can call `ctx.ui.notify` or mutate
  `event.input`, and the model sees nothing unless the handler blocks.

Round-three sessions: Codex `01a09f42-3815-7b70-88e7-536d11d08df9`'s thread and Gemini's are
the third `session_id` listed in the manifest entries for their event fixtures.
