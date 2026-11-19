# ADR 0083: The Codex MCP key must reach login shells, and reconcile re-applies it

## Status

Accepted. The deferred item below (a stdio MCP bridge with the key in Codex's per-server
`env` table, for shell-less GUI/IDE launches) is now **resolved by ADR 0089**; the
login-shell exports and reconcile behavior this ADR introduced remain in force. ADR 0104
(2026-10-29) removes the exports: reconcile now removes the block this ADR wrote.

## Context

Agents recall past sessions through the `agentcommons` MCP server. Claude Code and Gemini
carry the API key literally in their config (`Authorization: Bearer <key>`), so their MCP
client authenticates regardless of how the agent was launched. Codex is different: Codex
0.154 offers no literal-token or `--header` option for a streamable-HTTP MCP server — only
`--bearer-token-env-var` (an environment-variable reference) or OAuth. So the Codex key can
only reach the server through Codex's process environment, which comes from the shell that
started Codex.

The installer wrote the `AGENTCOMMONS_API_KEY` export only to the interactive rc files
(`~/.bashrc`, `~/.zshrc`, and `~/.config/fish/config.fish`). That misses login shells: macOS
Terminal starts a **login** bash that reads `~/.bash_profile`/`~/.profile` and never
`~/.bashrc`; display managers and SSH login shells read `~/.profile`. A Codex started from
any of those has no key, and its search tool logs that the variable is unset — silently
degrading recall, the one thing the MCP server exists to provide. The spec already said
"every login shell needs it," but the implementation did not cover them.

Two things compounded it. First, reconcile — the uploader's self-heal that re-runs the
installed bundle's `install` after a bundle swap — always passed `--no-shell-rc`, so it
re-registered the MCP entry but never re-applied the exports. An install made by an older
bundle (fewer shell files) stayed broken until the user manually re-installed. Second, the
install note ("open a new terminal") did not tell a user how to tell whether the key is the
problem.

## Decision

1. **Export to login shells too.** The installer writes the marked export block to
   `~/.profile` (the POSIX login fallback, which display managers also source) and, when they
   already exist, `~/.bash_profile` and `~/.zprofile` — a shell's own login file shadows
   `~/.profile`, so we extend one that exists but never create it, leaving the shell's startup
   order unchanged. The interactive rc files and fish are unchanged.

2. **Reconcile honors the recorded shell-rc choice** instead of always suppressing it. A
   normal install recorded no `--no-shell-rc`, so reconcile re-applies the exports on a bundle
   swap; because they are marked blocks, a re-write that changes nothing is a no-op, and a swap
   heals an install whose exports an older bundle wrote to fewer files. A canary that installed
   with `--no-shell-rc` keeps suppressing them. This makes the login-shell fix reach existing
   installs automatically, and is consistent with how reconcile already heals a stale MCP entry
   (ADR-era R-INST-02): reconcile re-asserts what the install wrote.

3. **A sharper note.** Codex's install note tells the user that Codex reads the key from the
   shell that starts it, and that if its search tool reports the key unset they should run
   `echo $AGENTCOMMONS_API_KEY`, and re-run the installer and open a new terminal when it is
   empty.

## Consequences

- A Codex started from a login shell (macOS Terminal's bash, SSH, a display manager) now finds
  its key, so recall works there. Existing broken installs heal on their next bundle swap,
  without a manual re-install.
- Reconcile now touches shell rc files for normal installs. The write is idempotent and runs
  only on a real swap (not every uploader run), so the cost is a marked-block comparison; the
  only visible effect is that a user who deleted the export block sees it return on the next
  swap, exactly as the MCP entry already returns.
- Claude Code and Gemini are unchanged: they embed the literal key and were never affected.
  pi has no MCP server. Codex was the only harness with this failure mode.
- A launch with no shell at all (a GUI/IDE that spawns Codex without sourcing any startup
  file) is still out of reach of a shell export; the fully general fix would be a stdio MCP
  bridge that carries the key in Codex's per-server `env` table (which Codex supports only for
  stdio servers). That is a larger change, deferred until a real GUI-launch case appears; the
  common terminal-launched paths are all covered now. **Update: resolved by ADR 0089** — the
  installer now registers `agentcommons` for Codex as a stdio server (`node hook.js mcp`) with
  the literal key in its `env` table, so a shell-less GUI/IDE launch also authenticates; the
  export here stays for other tools but Codex no longer depends on it.

## Alternatives considered

- **Embed the key in Codex's config like Claude/Gemini.** Not possible: Codex 0.154 has no
  literal-token or header option for HTTP MCP servers. Rejected by the tool.
- **A stdio MCP bridge with the key in the per-server `env` table.** Fully robust (covers even
  GUI launches), but it means building and shipping an MCP stdio↔HTTP proxy in the
  zero-dependency hook. Disproportionate to the observed failure (terminal-launched Codex);
  deferred at the time — **since adopted in ADR 0089** (a zero-dependency bridge built on Node
  built-ins, ~2.7 KB).
- **Leave reconcile at `--no-shell-rc` and rely on manual re-install.** Leaves existing broken
  installs broken until each user knows to re-run the installer. Rejected: the whole value of
  reconcile is healing stale installs without user action.
