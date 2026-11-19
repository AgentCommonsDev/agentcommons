# ADR 0089: Codex registers the recall server as a stdio bridge the hook provides

## Status

Accepted. Resolves the item deferred in ADR 0083 ("A stdio MCP bridge with the key in the
per-server `env` table"). ADR 0104 drops the shell exports this ADR kept "for other tools".

## Context

Agents recall past sessions through the `agentcommons` MCP server. Claude Code and Gemini
carry the API key literally in their config (`Authorization: Bearer <key>`), so their MCP
client authenticates however the agent was launched. Codex 0.154 is different: for a
streamable-HTTP MCP server it offers no literal-token or `--header` option, only
`--bearer-token-env-var` (an environment-variable reference) or OAuth. The key therefore
reaches the server only through Codex's process environment, which comes from the shell that
started Codex.

ADR 0083 widened where the installer writes the `AGENTCOMMONS_API_KEY` export (interactive rc
files plus the login files `.profile`/`.bash_profile`/`.zprofile`) and made reconcile
re-apply it, so a terminal-launched Codex — bash, zsh, fish, an SSH or display-manager login
shell — now finds the key. ADR 0083 explicitly left one case open: a launch with no shell at
all (a GUI or IDE that spawns Codex without sourcing any startup file) is out of reach of a
shell export, and named the fully general fix — a stdio MCP bridge carrying the key in Codex's
per-server `env` table — as deferred until a real GUI-launch case appeared.

Codex supports a per-server `env` table only for **stdio** servers: `codex mcp add --help`
says `--env <KEY=VALUE>` is "Only valid with stdio servers", and a real config's
`[mcp_servers.mcp-clickhouse.env]` block confirms the table is read for stdio servers. So the
robust registration for Codex is a stdio command whose `env` carries the literal key.

## Decision

1. **Register `agentcommons` for Codex as a stdio server the hook itself provides.** The
   installer writes

   ```toml
   [mcp_servers.agentcommons]
   command = "<node>"
   args = ["<dir>/hook.js", "mcp"]

   [mcp_servers.agentcommons.env]
   AGENTCOMMONS_API_KEY = "<literal key>"
   AGENTCOMMONS_SERVER = "<server URL>"
   ```

   `command`/`args` are the recorded Node path and the installed `hook.js`; the literal key
   lives in the per-server `env` table, so it reaches the server even from a GUI/IDE launch
   that sourced no shell. Claude Code and Gemini are unchanged (literal HTTP header). The
   `codex mcp add` form uses `--env AGENTCOMMONS_API_KEY=<key> --env AGENTCOMMONS_SERVER=<url>
-- <node> <dir>/hook.js mcp`.

2. **A third hook invocation, `hook.js mcp`, is that bridge.** It reads the client's JSON-RPC
   messages from stdin (newline-delimited — the MCP stdio framing; a message carries no
   embedded newline), forwards each to the server's streamable-HTTP `/mcp` endpoint with
   `Authorization: Bearer <key>`, and writes the server's responses back to stdout. A response
   is either one `application/json` body (written as one line) or a `text/event-stream` SSE
   stream (each event's `data` lines become one line). It captures and echoes an
   `Mcp-Session-Id` if a server issues one (this server is stateless and does not), and
   answers a request whose forward fails with a JSON-RPC error so the client never hangs. It
   is a transparent pipe: the client drives the protocol; the bridge only routes responses.

3. **The bridge is zero-runtime-dependency.** It uses only Node built-ins (`node:http`/
   `node:https`, `node:readline`, process streams) and imports nothing from
   `@agentcommons/core`, so it does not pull secretlint or otherwise enlarge `hook.js` beyond
   its budget (the bundle grew ~2.7 KB). This keeps `packages/hook`'s zero-dependency,
   one-code-path-per-mode rule; the mode is a new invocation alongside hook and upload.

4. **The shell export stays, but Codex no longer depends on it.** The installer keeps
   exporting `AGENTCOMMONS_API_KEY`/`AGENTCOMMONS_SERVER` (ADR 0083) because other tools may
   read them, but Codex's own recall now works without any shell. Codex's install note says so.

## Consequences

- A Codex started from a pure GUI/IDE with no shell now reaches the recall server. The
  terminal-launched paths ADR 0083 fixed keep working (the bridge does not depend on the
  export either). The fix reaches existing installs on their next bundle swap, because
  reconcile re-runs `install` and rewrites the entry, exactly as it already heals a stale MCP
  entry.
- One more process per Codex MCP session (the bridge), spawned by Codex and living for the
  session; it does only I/O and holds no state.
- The manually pasted management server (`agentcommons-admin`, ADR 0072) is unchanged: it
  keeps the HTTP + `bearer_token_env_var` shape, because a person pasting it is at a terminal
  whose shell has the export. The installer's `agentcommons` shape and the management shape
  intentionally diverge for Codex now; a hook unit test pins both.
- Claude Code, Gemini and pi are unaffected.

## Alternatives considered

- **Embed the key in an HTTP entry like Claude/Gemini.** Not possible: Codex 0.154 has no
  literal-token or header option for HTTP MCP servers (ADR 0083).
- **Rely only on the login-shell exports (ADR 0083).** Covers terminal launches but not a
  shell-less GUI/IDE launch, which is exactly the deferred gap.
- **A general third-party stdio↔HTTP proxy dependency.** Would break `packages/hook`'s
  zero-dependency rule and risk bundle bloat; the bridge is a few dozen lines of Node
  built-ins instead.
- **Content-Length framing on stdin.** The MCP stdio transport is newline-delimited (messages
  carry no embedded newline); Content-Length is the LSP convention, not MCP. The bridge reads
  newline-delimited JSON, which is what Codex speaks.
