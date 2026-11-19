# ADR 0104: The installer exports no API key to shells

Date: 2026-10-29
Status: Accepted. Supersedes the login-shell exports of ADR 0083 and the sentence in ADR 0089
that kept them "for other tools".

## Context

ADR 0083 wrote `AGENTCOMMONS_SERVER` and `AGENTCOMMONS_API_KEY` exports into every shell
startup file (`.profile`, `.bashrc`, `.zshrc`, an existing `.bash_profile`/`.zprofile`, fish's
`config.fish`) because Codex could only read its MCP key from the environment. ADR 0089 removed
that need: Codex runs `hook.js mcp`, a stdio bridge whose own `env` table carries the key, and
Claude Code and Gemini carry it literally in their MCP entries. The exports stayed "for other
tools that read AGENTCOMMONS_API_KEY". None exists in this repository outside development
scripts that set the variable themselves.

The key the dashboard issues for an installation has `sessions: [ingest, read]`: it can read
everything its owner can see. Exported from every shell, it sat in the environment of every
process started from a terminal, every coding agent and every command an agent runs, where
crash reports, `env` dumps and child processes pick it up.

## Decision

1. `install` and `uninstall` write no exports. Both remove the marked `agentcommons-hook` block
   from every startup file an older installer wrote to, keep the user's own lines, and delete a
   file that held only the block (the `.profile` the installer created). Reconcile runs
   `install` after every bundle swap (ADR 0083), so existing installations are cleaned on their
   next swap without a reinstall.
2. `--no-shell-rc` is removed from `install.sh`, `hook.js install` and the recorded install
   options. `installOptions` is read loosely so the `noShellRc` an older installer recorded
   does not make `config.json` unreadable; the next install rewrites the options without it.
3. The uploader keeps the installation's one key. An ingest-only uploader key was considered
   and not adopted: the uploader itself reads with the key (after each drain it refreshes the
   recall hint cache and the tool policy, §6.2), the Codex bridge reads with it, and the
   harnesses' MCP entries hold it in files the same user owns, so a second, narrower key beside
   it would not narrow what any process on the machine can reach.

## Consequences

- No shell environment carries the key. Shells already open, and agents started from them,
  keep the variable until they restart.
- A person who relied on `$AGENTCOMMONS_API_KEY` in their own scripts must set it themselves.
- `install.sh --no-shell-rc` now fails with "Unknown option". The live canary and the recall
  benchmark, the only callers in this repository, install under `--config-home`, which already
  keeps them away from the real home.
- `AGENTCOMMONS_SERVER` and `AGENTCOMMONS_API_KEY` in the environment still override
  `config.json`: the Codex bridge depends on it. A process environment that sets
  `AGENTCOMMONS_SERVER` can therefore redirect uploads; ADR 0102 keeps it from redirecting
  self-update to code the release key did not sign.
