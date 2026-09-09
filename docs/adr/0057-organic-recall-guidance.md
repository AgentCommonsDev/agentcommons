# ADR 0057: Tool guidance tells agents to check prior work before changing code

Date: 2026-09-09
Status: Accepted. Replaces the governing sentence of §8.2 and the §8.3 snippet as they
stood since ADR 0053; the catalog budget of ADR 0053 stands.

## Context

The product exists for the moment an agent is handed an ordinary task ("the auth test is
flaky again", "add retry the way the team does it", "set the correct timeout") and a
colleague's earlier session already holds the root cause, the chosen library or the exact
value. Until this decision every `search`, `get` and `sql` description and the repository
snippet opened with "Only use this when the user asks about previous sessions or prior
work". That sentence was written to keep agents from wandering into history on every
turn, and the native tool canary (R-MCP-07) proved the tools work when a user asks. It
never measured whether an agent that is not asked decides to look.

## Measurement

Three real seed sessions were captured into one organization on the local SaaS instance:
Claude Code root-caused a flaky TTL test (injectable clock), Codex chose a payments retry
policy (3 attempts, 100/200 ms, only 503 and ECONNRESET, idempotency keys) and Gemini CLI
set an inventory timeout to 8000 ms from a latency log and a runbook SLO. The repository
was then rewritten so none of those facts remained in it (payments client moved to an SDK,
logs and runbook sentence removed, timeouts regressed, a new real-timer test added) and
its history squashed to one import commit. Each harness then received three ordinary
tasks, twice, with only the installed registration and the snippet in
`AGENTS.md`/`CLAUDE.md`/`GEMINI.md`; no prompt mentioned AgentCommons or prior sessions.

Sessions that called `search` unprompted (search before the first edit, seed session in
the results), old text versus new text, isolated API instances serving each:

| harness     | old text, git history available | old text, squashed history | new text, squashed history |
| ----------- | ------------------------------- | -------------------------- | -------------------------- |
| Claude Code | 0/6                             | 4/6                        | 6/6                        |
| Codex       | 0/6                             | 0/6                        | 6/6                        |
| Gemini CLI  | 4/6                             | 4/6                        | 6/6                        |

With git history available Claude Code and Codex answered every task from `git log`
without touching AgentCommons; Gemini CLI searched anyway on the retry and timeout tasks.
With the history squashed and the old text, Claude Code started searching when the
repository gave it nothing, Gemini kept searching, and Codex never did (its timeout run
stopped to ask the user for the value). The flaky-test task never triggered a search on
any harness under the old text: the file already carried the fake clock pattern, so the
repository answered. Under the new text every one of the 18 sessions searched before its
first edit (queries such as "refreshes expiry on access", "retry notifications client",
"inventory timeout catalog rebuild"); the timeout task found the seed session in 6/6 runs
and Codex, which had stopped twice to ask the user for the value, restored 8000 from the
session and cited its id.

## Decision

1. The governing sentence becomes "Use this to check prior work before changing code, and
   whenever the user asks about earlier sessions; run long investigations in a subagent
   that returns only findings with session ids." The `search` description then names the
   trigger: start with the test name, file path or error you were given; an earlier session
   often holds the root cause, the library the team chose or the exact value.
2. `initialize` returns the same guidance as server `instructions`
   (`serverInstructions` in `apps/api/src/services/mcp.ts`). Claude Code places server
   instructions in its system prompt, so the agent reads the guidance before it reads the
   catalog. The transport contract test asserts `getInstructions()`.
3. The §8.3 guidance block says the same in a file the agent reads on every session. It was
   first a repository snippet the installer printed for teams to paste; the same day it
   became a block the installer writes into each harness's global instructions file
   (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, driven by
   `HARNESSES`), refreshed by self-update and removed on uninstall, with pi's extension
   adding the text to its system prompt. Teams add nothing to repositories.
4. The live canary gains an organic recall stage (R-MCP-10, §16.2): a scripted decision
   session followed by an ordinary task in a fresh repository, passing only when the
   harness searches before it writes the value, the result carries the decision session
   and the file and reply end with that value. This keeps the measurement, not just the
   text, under test.

The read catalog grows from 15043 to 15228 bytes and the admin catalog from 18363 to
18588 bytes, inside the §8.2 budgets (20 KB and 25 KB) and the canary's tighter 15 KB
and 20 KB assertions.

## Consequences

- Agents will search on tasks that the repository could have answered; the subagent clause
  and the small catalog keep that cheap. The dashboards' search-adoption tiles will show
  the change.
- Guidance is now stated in three places (global instructions, `instructions`, descriptions). They are
  the same sentence in different lengths and change together (§8.2, §8.3, R-MCP-04).
- Codex is the harness least moved by descriptive text; if the canary shows it regressing,
  the next lever is the Codex profile's project instructions, not a longer description.
