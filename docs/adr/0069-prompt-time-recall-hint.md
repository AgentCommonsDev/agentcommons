# ADR 0069: Prompt-time recall hint from the capture hook, and guidance in repositories

Date: 2026-09-11
Status: Accepted. Amends ADR 0057 decision 3 ("Teams add nothing to repositories") and
extends §6.2 with the only stdout a hook writes.

## Context

ADR 0057 moved the search-first guidance into every machine's global instructions file and
measured that agents then searched 18/18 times when the repository could not answer. Two
facts since then say that is not enough:

- On the hosted instance, all 916 attributed AgentCommons calls in two days came from one
  user, whose own global instructions file carries an explicit "search before changing
  code" directive. The agents of the other four installations made none.
- ADR 0057's own table: with git history available, Claude Code and Codex consulted
  AgentCommons 0/6 times under the old text; with the guidance and no history, 6/6. The
  guidance works when the agent reads it before it forms a plan, and a machine's global
  file is read by one person's agents only.

Two levers follow. Guidance that lives in the repository is read by every teammate's
agent, on machines with or without the install. And the capture hook already runs on every
prompt of every hooked session: its harnesses document a way to add one line of context
to the model at exactly that moment.

## Decision

1. **Repository guidance, one implementation.** `agentInstructionsFor(scope)` in
   `packages/core/format/install` produces the machine text (unchanged, pinned to §8.3)
   and a repository variant: the same search-first sentences, framed for a project, plus
   one sentence telling an agent without the `agentcommons` server to say so once. The
   shared markers moved to core so the installer, `hook.js guidance --repo`, and the
   Install page snippet wrap the same block. `hook.js guidance [--repo <path>]` writes it
   into `AGENTS.md` and links `CLAUDE.md` and `GEMINI.md` to it (the file each harness
   reads is data in `HARNESSES`, `repositoryInstructionsFile`); a regular file that
   already exists receives the block, a symlink that points elsewhere is left alone. The
   Install page shows the block with the instruction to commit it; the README points at
   both. This repository carries the block in its own `AGENTS.md`.
2. **Recall hint through the hook, no network in hook mode.** The detached uploader,
   after its drain, fetches the caller-visible count of indexed sessions for the session's
   repository, one `GET /api/v1/sessions?limit=1&filters={"repo_name"}` whose `total` is
   the page's own scan, at most every 15 minutes per repository, and caches it under the
   data directory keyed by the hashed repository name. Hook mode, on the events
   `HARNESSES` flags `hint` (Claude Code and Codex `UserPromptSubmit`, Gemini
   `BeforeAgent`), reads the cache and prints the documented
   `hookSpecificOutput.additionalContext` JSON with one line: "N prior AgentCommons
   sessions touch <repo>; search them before changing code (search, get, sql over MCP)."
   It prints on the first hinted prompt that finds a count and then every 25 prompts
   (counter beside the state file), nothing otherwise. No server change: the list
   endpoint's total already costs one scan (rule 2 of the read-path rules), and
   `sessions.list` is not a search-adoption action, so the fetch does not inflate the
   adoption tiles.
3. **Per-harness only where documented.** Claude Code 2.1.266 was verified live in an
   isolated config directory (Appendix A, `fixtures/hooks/claude-code-2.1.266-prompt-
context-events.jsonl`): the injected sentinel was the model's only reply and the
   context is stored as an `attachment` record. Codex 0.153.4 documents the same shape in
   its hooks reference and its binary's wire schema; Gemini CLI 0.35.3 documents it for
   `BeforeAgent` in its bundled reference. Both are implemented against the documented
   contract and marked canary-pending. pi has no shell hook output and gets no hint; its
   extension's system prompt is the documented place for one later.

## Consequences

- Privacy: the hint contains a count and the repository name, both of which the hook
  already knows from the session's own remote; nothing from other sessions crosses the
  wire to the harness. The count is the key's own visibility under the row policies.
- Hook mode still never touches the network (R-CAP-01 blackhole test now includes a
  hinted prompt); the hint costs two small JSON reads and one write, inside the 150 ms
  budget. The bundle grows by about 5 KB; `repositoryIdentity` moved to an import-free
  leaf module in core so the zero-dependency bundle does not pull in the redaction stack.
- Hinted Claude Code sessions show the line as a `SYSTEM` message in their own capture;
  the hint reaches the index like any other hook context.
- The first prompt of a session is never hinted (no git context yet) and a newly indexed
  session shows up in the count after at most one refresh. A machine whose key lacks
  `sessions:read` logs one skipped refresh per interval and hints nothing.
- The live canary should gain a hinted-prompt assertion for Codex and Gemini before their
  canary-pending marks are removed; the organic recall stage (R-MCP-10) is the place to
  measure whether the hint moves the rate when the repository block is absent.
