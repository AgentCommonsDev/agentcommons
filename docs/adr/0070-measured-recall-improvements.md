# ADR 0070: Measured recall improvements

Date: 2026-09-11
Status: Accepted. Extends ADR 0069 (prompt-time hint) and refines ADR 0057 (descriptions)
inside the catalog budget of ADR 0053 and ADR 0068.

## Context

The product works only if an agent handed an ordinary task decides, unprompted, to look at
prior sessions. ADR 0057 measured that decision once (0/6 with git history under the old
text, 6/6 with the new guidance and no history) and ADR 0069 added a prompt-time hint
without measuring it. Two production facts since then: every attributed read on the hosted
instance came from one user, and on this workstation a real Claude Code session never
loaded the `agentcommons` server at all, because its registration still carried the
unexpanded `${AGENTCOMMONS_API_KEY}` placeholder (the handshake got 401 and the harness
dropped the server) while the hint kept telling the model to search with tools it did not
have.

## Method

`scripts/recall-bench/` reproduces ADR 0057's method as a script (not in CI: it needs
Docker, the `claude` CLI and a signed-in Claude Code credential). A private API on its own
PostgreSQL and ClickHouse, one organization, a member's installation key wired into an
isolated config home (`CLAUDE_CONFIG_DIR`, a copy of the credential that is never allowed
to refresh). Six hooked Claude Code seed sessions record decisions in one repository
(`github.com/acme/orders-api`: a fake clock for a flaky TTL test, a payments retry policy,
an inventory timeout of 8000 ms from a latency log, zod over ajv per an ADR, an off-by-one
in a CSV pager, an S3 region fixed by a residency clause). Each task repository then
drops the evidence and regresses the value, with the history squashed to one import commit
(the repository cannot answer) or left in place (the fix commit is in `git log`, the
production reality). Six ordinary tasks, never mentioning AgentCommons, run twice per
condition with `claude -p` (default model `claude-opus-5`), each under its own read key so
the API audit rows attribute every `search`, `get` and `sql` call; every run's captured
session is set PRIVATE as soon as it is indexed so later runs cannot find earlier runs.
Scored per run: the first AgentCommons call versus the first write, the first call's hit
count from the result the model saw, whether the first result carried the seed session,
whether the finished repository carries the decision, and the hook context the model
received (from the isolated transcript). Two ablations: `--hint off` (capture disabled:
guidance and tools only, ADR 0057's condition) and `--registration placeholder` (the
production failure).

## Measurements (Claude Code 2.1.266, 2026-09-11)

Before, with the current bundle, guidance and three-tool catalog:

| condition                   | runs | searched before write | first call hits > 0 | first call has seed | used decision | hinted |
| --------------------------- | ---- | --------------------- | ------------------- | ------------------- | ------------- | ------ |
| squashed history            | 12   | 12/12                 | 11/12               | 10/12               | 11/12         | 11/12  |
| history available           | 12   | 12/12                 | 10/12               | 9/12                | 11/12         | 12/12  |
| hint off, squashed          | 6    | 6/6                   | 3/6                 | 3/6                 | 5/6           | 0/6    |
| hint off, history available | 6    | 6/6                   | 5/6                 | 5/6                 | 6/6           | 0/6    |
| placeholder registration    | 6    | 0/6 (server dropped)  | n/a                 | n/a                 | 3/6           | 4/6    |

The first recall call came at p50 6.9 s (squashed) and 5.3 s (available) after launch,
always `search`, in every run the first tool after reading the prompt or one file. The
unprompted-recall rate is saturated for this harness: the installer's guidance block alone
carries it (12/12 with the hint off), so the hint's value is not the rate. Where runs
failed was the first call: 5 of 24 first searches returned no hit, because a whole-sentence
query carried a word no session contained ("missing", "PermanentRedirect") or a
`repo_name` of the form `org/repo`, which the filter matches against nothing. Every such
run recovered with a second, shorter query. With the registration broken, the model
received the "search them" hint in 4 of 6 runs and could not act on it: two runs stopped
without editing, one guessed a wrong region, one noticed the 401 on its own, none told
the user how to repair the install.

Two facts the bench established about Claude Code 2.1.266 (Appendix A): `SessionStart`
`hookSpecificOutput.additionalContext` reaches the model (verified with a sentinel in an
isolated config directory), and the model is handed each MCP result's `structuredContent`
JSON, not the text rendering, so guidance placed in result text never reaches it.

After (the same bench, the rebuilt bundle and descriptions; filled in from
`summary-after.md` and `summary-placeholder-after.md`):

| condition                | runs | searched before write | first call hits > 0                        | first call has seed | used decision | hinted | reply names the repair |
| ------------------------ | ---- | --------------------- | ------------------------------------------ | ------------------- | ------------- | ------ | ---------------------- |
| squashed history         | 12   | 12/12                 | 1/1 (search first once; `get` first 11/12) | 12/12               | 12/12         | 12/12  | n/a                    |
| history available        | 12   | 12/12                 | n/a (`get` first 12/12)                    | 12/12               | 11/12         | 12/12  | n/a                    |
| placeholder registration | 6    | 0/6 (server dropped)  | n/a                                        | n/a                 | 3/6           | 6/6    | 6/6 (was 0/6)          |

Every task run received both the overview and a matched hint; 23 of 24 opened the matched
seed session with `get` as their first call and the 24th searched and hit, so the first
result carried the seed in 24/24 (was 19/24), the first recall call came at p50 4.7 s and
4.2 s (was 6.9 s and 5.3 s), the rate held at 24/24 and the decision was applied in 23/24
(was 22/24). With the placeholder registration the reply named the repair in 6/6 runs (was
0/6) and no run tried to search.

## Decision

1. **Hint only when the harness can act on it (R-CAP-24).** Before any hint, hook mode
   reads the harness's own MCP configuration (`mcpConfigPath` under the installer's
   `--config-home` or the home directory; at most on the start event and the first prompt;
   files over 1 MB skipped). An entry that is missing or still carries `${…}` means the
   harness has dropped the server, so the only context that session receives is one
   repair notice naming the file, the cause and `node <data directory>/hook.js install`,
   and nothing about searching. `packages/hook/src/registration.ts`; the format table
   (`mcpServers` / `mcp_servers`) is the same data the installer uses.
2. **The hint names sessions, not a count (R-CAP-20, R-CAP-23).** The uploader's refresh
   asks the list endpoint for the ten newest root sessions of the repository
   (`limit=10&roots_only=true`, the same single scan, at most every 15 minutes) and caches
   `{ id, title, startedAt, branch }` beside the count (cache v2; v1 stays readable). At
   session start (Claude Code and Gemini `SessionStart`) the shim gives a one-line
   overview with the three newest sessions and their ids; on a prompt it names the cached
   sessions whose title or branch shares two words, or one identifier or path, with the
   prompt, each once per session; the count nudge remains the fallback, first prompt and
   every 25th. The repository is read from the working tree's `.git` when the state has no
   git context yet, so the first event of a session and a fresh clone are hinted. File
   paths a session touched are not in the list endpoint's rows and therefore not in the
   hint; adding them is a server change deferred until a measurement needs it.
3. **Descriptions are action-first with a validated worked example (R-MCP-04, R-MCP-12).**
   The read tools' text lives in `packages/core/format/tool-descriptions.ts`; `search`
   opens with the questions it answers and the 2-to-4-words rule (every word must match),
   names the accepted `repo_name` forms and points at `get`; `get` opens the best hit; `sql`
   answers what search cannot. Each example is data parsed by the call schema in a core
   unit test; each description with the governing sentence stays under 1,200 bytes. The
   default catalog measures 9,398 bytes (was 8,414; budget 12 KB). The ADR 0057 governing
   sentence and server instructions are unchanged.
4. **Not shipped, by measurement.** A next-step line in the search result text would not
   reach Claude Code's model (it reads `structuredContent`), and every zero-hit first call
   in the bench was followed by a successful second query without one. A server-side
   default `repo_name` filter would hide cross-repository decisions and every first call
   in the bench that omitted the filter still found the seed; agents add the filter
   themselves when they know the repository. Both are recorded here rather than built; the
   `org/repo` filter form that silently matched nothing is fixed instead (Consequences).

## Consequences

- A machine with a broken registration now tells its user how to repair it instead of
  telling the model to use tools it does not have; the reconcile run of ADR 0069 still
  heals the entry on the next uploader run after a bundle swap.
- The hint carries session titles and ids the same key can already read through the list
  endpoint; nothing from other users' sessions crosses the wire that the row policies would
  not show. Titles are bounded to 100 characters and the cache to ten sessions.
- The bundle grows by about 7 KB (171,723 bytes). Hook mode reads up to four more small
  files (config.json, the MCP configuration once or twice per session, `.git/config`) and
  keeps its 150 ms budget (timing in `scripts/recall-bench/hook-timing.ts`).
- Codex and Gemini measurements need API keys this workstation lacks; their session-start
  contract is documented (Gemini) or absent (Codex) and marked canary-pending in Appendix A.
- The `org/repo` form of `repo_name`, which agents read off a remote and which 3 of the 5
  baseline first-call misses used, now resolves like the bare alias: one query over the
  `repos` view (only when a bare or one-slash value is present; canonical names still need
  no lookup) picks the repository whose name ends with it, and several matches are refused
  with `AMBIGUOUS_REPO` (`apps/api/test/repo-alias.integration.test.ts`).
