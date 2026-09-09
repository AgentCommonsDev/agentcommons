# Native search tool identity capture, 2026-09-08

These are actual native CLI/SDK sessions, not hand-authored tool payloads. The
AgentCommons MCP server in this probe is an isolated official SDK stdio server named
`agentcommons`, exposing `search({query:string})`. Its response explicitly identifies
itself as a fixture and returns an empty session list. This capture establishes native
invocation identity and ordering; it does not demonstrate AgentCommons search quality,
production authorization, or a successful reuse of prior work.

## Observed identities

| Native client       | AgentCommons search                                                                                     | Other code/file search             | Web search                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| Claude Code 2.1.263 | `mcp__agentcommons__search`                                                                             | `Grep`, `Glob`                     | `WebSearch`                                                                           |
| Codex 0.153.4       | typed `McpToolCall` with `server:agentcommons`, `tool:search`; projected as `mcp__agentcommons__search` | No typed code/file search captured | typed `Extension`, `kind:web.search`, `action.type:search`; projected as `web.search` |
| Gemini CLI 0.35.3   | `mcp_agentcommons_search`                                                                               | `grep_search`, `glob`              | `google_web_search`                                                                   |
| pi 0.73.1           | No built-in AgentCommons MCP integration                                                                | `grep`, `find`                     | No native web search captured                                                         |

At capture time the installed pi capture extension registered lifecycle callbacks, not
tools, and its `HARNESSES` entry has no MCP config path or command. Since ADR 0054 the
extension registers the key's MCP catalog as `agentcommons_<tool>`; that qualified name
is pi's AgentCommons identity. A third-party pi extension may still register any name,
including `search`; that name alone cannot identify AgentCommons.
`find`, `glob`, and `Glob` search filenames, while the grep tools search file content.
Arbitrary shell commands, `exec` source, textual mentions of tools, and suffix matches
are excluded from this evidence.

## Method

Private working directory: `/tmp/agentcommons-tool-identities-nEOUv2`. The three CLIs
used separate working directories, each containing only `probe.txt` plus its generated
local capture settings. Native authentication was reused; inherited `OPENAI_API_KEY`
was unset. Gemini CLI and pi used the existing privately supplied Gemini credential.
No credentials were copied into the fixture server configuration or prompts.

The official `McpServer`/`StdioServerTransport` exposed a Zod-validated `query` input.
The native prompts requested two sequential AgentCommons searches (`contract-first`,
`contract-second`), then native file-content and web search where available. Separate
one-tool sessions captured Claude `Glob` and Gemini `glob`. Each file probe searched
for `agentcommons-search-contract-marker` in `probe.txt`; web probes searched for
OpenAI API documentation. Local search output and native web responses are actual tool
results; only the isolated MCP server's response is synthetic.

- Claude: `--print --setting-sources '' --strict-mcp-config --mcp-config <fixture>`;
  tools were limited to `Grep,WebSearch` or `Glob`, with explicit MCP/tool allowance,
  `--permission-mode dontAsk`, and JSON streaming. `scripts/capture-hook.mjs` copied
  the native transcript on PostToolUse and SessionEnd.
- Gemini: `--model gemini-2.5-flash --approval-mode yolo --output-format stream-json`,
  local `mcpServers.agentcommons` stdio configuration, and AfterTool/SessionEnd capture
  hooks. The final complete JSON document is retained, preserving its mutable tool
  call objects and result fields.
- Codex: `exec --ignore-user-config --ignore-rules --skip-git-repo-check`, model
  `gpt-6-astra`, high reasoning, `web_search="live"`, explicit stdio MCP configuration,
  and JSON output. Native function orchestration was allowed; shell commands and
  custom HTTP/MCP scripts were prohibited. With a read-only sandbox and approval
  policy `never`, native MCP attempts were rejected before reaching the server.
  A second bounded run used the native approval/sandbox bypass against this isolated
  fixture, with read-only MCP annotations, and both calls completed. Both successful
  and rejected-attempt transcripts are retained. An earlier prompt that prohibited
  function orchestration produced no calls and is not used as contract evidence.
- pi: installed SDK `createAgentSessionServices` and `createAgentSessionFromServices`,
  isolated agent/session directories, Gemini 2.5 Flash, tools limited to `grep,find`,
  and no third-party extensions or skills. Both native calls completed and the session
  was disposed. The diagnostic wrapper subsequently attempted a nonexistent
  `services.dispose()` method; that wrapper error occurred after the transcript was
  copied and after session disposal, and does not represent a native tool failure.

All seven files under `fixtures/transcripts/tool-identities/` were copied from native
persisted transcripts through the production `Redactor.text` before repository storage.
The shipped rules found no matches. JSON/JSONL was parsed after redaction; payloads
were not manually rewritten. The normalizer tests consume those original structures.

## Codex completion contract

The persisted source is `event_msg` with `payload.type: item_completed`. Its payload
has `started_at_ms` and `completed_at_ms`. `payload.item` contains:

- MCP: `type:McpToolCall`, `id`, `server`, `tool`, `arguments`, `status`, `duration`,
  and an actual `result` on success or `error` on rejection. Successful read-only
  calls also carried `readOnlyHint:true`.
- Web: `type:Extension`, `kind:web.search`, `id`, `query`, `action`, and `results`.
  The observed action was `type:search`; opening a page or finding text within one
  is not classified as a search by this contract.

In code mode, ordinary response items contain `custom_tool_call` named `exec` around
these calls. The typed completion supplies MCP identity without inspecting that code.
Codex CLI stdout also reports `mcp_tool_call` and `web_search` summaries, but ingestion
uses the persisted rollout, not stdout. A rejected attempt is still an observed call;
its error result must not be described as successful execution or retrieved history.

The successful rollout has no `item_started` events. Its outer response-item call IDs
and inner typed invocation IDs are disjoint. Typed TOOL_USE rows consequently occupy
the completion record's source position, while showing its recorded start timestamp.
For concurrent tools, source-order comparisons mean recorded completion order, not
invocation start order or causation.

The adapter projects one TOOL_USE per native identity, prefers ordinary call/result
observations when the same identity exists there, and retains the last actual result
across duplicate completion observations. Unknown extensions remain raw-only. See
[ADR 0036](adr/0036-codex-native-tool-completions.md).
