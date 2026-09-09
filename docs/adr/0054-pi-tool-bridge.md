# ADR 0054: The pi extension bridges the MCP catalog as native tools

Date: 2026-09-08
Status: Accepted. Extends ADR 0003 (agent interface `search`/`get`/`sql`), ADR 0036
(native tool identities) and the pi capture extension of spec §6 and Appendix A.

## Context

Every supported harness except pi reaches AgentCommons through the MCP registration
`install.sh` writes: Claude Code (`mcp__agentcommons__<tool>`), Codex (typed
`McpToolCall`, projected as `mcp__agentcommons__<tool>`) and Gemini CLI
(`mcp_agentcommons_<tool>`). pi 0.73.1 has no MCP client at all; its README says "No
MCP. Build CLI tools with READMEs, or build an extension that adds MCP support." Until
now the installed pi extension only captured sessions, so a pi user could not search
prior work, and the live canary recorded pi as unsupported for native tool use. The
founder wants every supported harness to use AgentCommons natively.

pi extensions may register tools (`pi.registerTool`) whose `parameters` are validated by
pi-ai with `typebox/compile`, which accepts plain JSON Schema without TypeBox metadata.
The zod-generated MCP `inputSchema` of every AgentCommons tool compiles and validates
there unchanged (checked against `search`, `get`, `sql`, `dashboard_list` and
`dashboard_render` inputs, including the `uuid` format). The server's `/mcp` is a
stateless Streamable HTTP endpoint with JSON responses (§8.1): `tools/list` and
`tools/call` work as single POSTs without `initialize` or a session id.

## Decision

The installed pi extension (`packages/pi-extension`, served as `pi-extension.mjs`) is
also pi's AgentCommons tool bridge.

- At load it reads `server` and `key` from the shim's `config.json`, POSTs `tools/list`
  to `<server>/mcp` with `Authorization: Bearer <key>` (3 s timeout) and registers every
  returned tool as a native pi tool named `agentcommons_<tool>`. The registration uses
  the server's `inputSchema` as parameters, the server's description (the governing
  sentence included) and a one-line prompt snippet for pi's "Available tools" section.
  Nothing is redeclared by hand: the catalog is the same permission-filtered,
  installation-gated list every other client sees, so admin tools appear only for keys
  with effective admin authority and a disabled installation registers nothing.
- Each call POSTs `tools/call` (60 s timeout, pi's abort signal honored). The text
  content becomes the tool output and `structuredContent` its details. A result with
  `isError` becomes a pi tool failure carrying the server's error text, never fabricated
  output. Authentication failures (the REST error envelope) and JSON-RPC errors surface
  the server's message.
- A missing `config.json`, a config without `server`/`key`, an unreachable server or a
  rejected key registers no tools, appends one line to `hook.log`
  (`pi tool bridge registered no AgentCommons tools: <reason>`) and leaves capture
  untouched. The extension factory is async; pi awaits it during load. A host that
  has already replaced its session when the catalog arrives rejects the late
  registration; the bridge logs one line and registers nothing rather than throwing.
- The bridge speaks only the stateless JSON-response subset the server configures. It
  does not bundle the official MCP SDK client.
- The tool identity `agentcommons_search` joins `mcp__agentcommons__search` and
  `mcp_agentcommons_search` in the adoption views (`metrics_search_sessions`), so pi
  searches count toward search adoption like the other harnesses.
- The live canary's native tool stage runs for pi as for the other harnesses: a second
  hooked session (the scripted mock model or a provider key) calls
  `agentcommons_search`, `get`, `sql`, `dashboard_list` and `dashboard_render`; the
  same transcript, search-hit and `transport=mcp` audit assertions apply (R-MCP-07).

## Alternatives considered

- **Bundle the official `@modelcontextprotocol/sdk` client into the extension.** The
  minified client plus its transport and zod is about 305 KB against a 4.5 KB extension,
  and it would load a second zod into every pi process at startup. The bridge needs two
  JSON-RPC methods on a server we configure ourselves; the SDK's value (session
  negotiation, SSE streams, capability handling) is unused here. ADR 0002 prefers
  libraries; this ADR records the exception and its reason.
- **Hand-written tool definitions in the extension.** Would duplicate the shared zod
  schemas and drift from the server catalog and permission filtering. Rejected by the
  one-implementation tenet (§3.1).
- **A CLI wrapper or skill that shells out to REST.** Matches pi's README advice, but
  tool calls would appear in transcripts as `bash` commands with no stable identity, so
  adoption metrics and the canary could not recognize them.
- **Wait for native MCP in pi.** pi's author rejects MCP by design; there is nothing to
  wait for.

## Consequences

- Every pi start makes one bounded request to the configured server. Offline or
  server-down starts lose at most 3 s and keep working without the tools.
- pi transcripts carry `agentcommons_<tool>` TOOL_USE/TOOL_RESULT rows; the pi
  normalizer needs no change because extension tools are ordinary `toolCall` blocks.
- Spec §3.1, §8.4, §16.2 and Appendix A are updated; requirements R-MCP-07 and R-MCP-08
  are added; `packages/pi-extension/src/index.test.ts` covers registration, forwarding,
  error mapping and the no-server path against a real local HTTP endpoint;
  `docs/VERIFICATION.md` lists the pi tool stage.
