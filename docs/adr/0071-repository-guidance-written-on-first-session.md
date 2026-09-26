# ADR 0071: Repository guidance written on first session

Date: 2026-09-11
Status: Superseded by [ADR 0095](0095-explicit-repository-guidance.md) on 2026-09-26. Originally extends ADR 0069 decision 1 (repository guidance, one implementation)
and amends ADR 0057 decision 3 ("Teams add nothing to repositories") a second time: the
capture hook now adds the block itself.

## Context

The product exists for the moment an agent is handed an ordinary task and a colleague's
earlier session holds the answer. Every measurement so far says the agent looks only when
it has read the search-first guidance before it forms a plan (ADR 0057: 0/6 with git
history and without the text, 6/6 with it; ADR 0070: 24/24 with the installer's block and
the hint). Production says the guidance is not reaching most agents:

- On the hosted instance, all 916 attributed AgentCommons calls in two days came from one
  of five installations. The agents of the other four made none. The one user whose
  agents searched is the one whose instructions files carry an explicit "search before
  changing code" directive.
- The installer writes the block into each harness's global instructions file on the
  machine it runs on (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`),
  which reaches one person's agents. ADR 0069 added `hook.js guidance --repo <path>` and
  an Install page snippet so a team could put the same block in the repository, where
  every teammate's agent reads it with or without the install. In two days no repository
  block appeared in any captured session: a command a person has to remember is not run.

The user asked for the obvious next step: when the hook sees a new repository, add the
instructions to it.

## Decision

1. **The uploader writes the block on a repository's first captured session.** Hook mode
   keeps its contract (no network, no writes outside the data directory, 150 ms). After its
   drain, the detached uploader takes the checkout root the first drain recorded (`git
rev-parse --show-toplevel`) and runs the same `writeRepositoryGuidance` the command
   runs: the §8.3 repository block into `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` as
   symlinks to it when absent, the block appended when they exist as files, symlinks left
   alone, a link that leaves the repository never followed. The file each harness reads is
   data in `HARNESSES` (`repositoryInstructionsFile`); `if (harness === …)` appears nowhere.
2. **Once per repository, recorded in the hook state directory.** `guidance/<sha256(key)>.json`
   under the data directory holds `written` with the hash of the block text, or `declined`.
   The key is the remote's canonical name (`repositoryIdentity`, the server's `repo_name`)
   so every clone on the machine shares one decision, and the resolved root path for a
   checkout without a remote. A `written` with the current hash means no repository file is
   read on later sessions; a differing hash (a release changed the text) refreshes the
   block once; `declined` is honoured before anything is read.
3. **Opt-out paths, all data.** `hook.js guidance --repo <path> --off` removes the block
   (and a `CLAUDE.md`/`GEMINI.md` link to `AGENTS.md` the removal left dangling) and records
   `declined`; the plain command lifts it. `guidance.auto: false` in `config.json` turns the
   automatic write off for the machine; `AGENTCOMMONS_GUIDANCE_AUTO=0` does the same from
   the environment (`1` forces it on). Default on, as the user asked.
4. **Skip quietly where a write would be wrong.** No working tree root (bare repository),
   a root without its own `.git`, a read-only checkout, a checkout under `node_modules`, an
   `AGENTS.md` that is a symlink outside the repository: nothing is written and nothing is
   recorded, so a later session looks again. An identical block already present (a teammate
   committed it) is adopted: recorded, not rewritten, not announced.
5. **Tell the agent and the user once.** The next hinted hook event (ADR 0070's session
   overview or prompt hint) carries "AgentCommons guidance was added to AGENTS.md (with
   CLAUDE.md/GEMINI.md); commit it so every teammate's agent reads it." once per
   repository, behind a due hint or alone, and never in a session that received the repair
   notice. Hook mode reads the decision file and clears the flag; the uploader logs the
   files it changed to `hook.log`. The Install page and the README say the block is added
   automatically and how to turn it off.

## Consequences

- A file appears in the working tree once per repository: three new paths in a checkout
  without instructions files, or a block appended to the existing `AGENTS.md`. The tree is
  dirty until someone commits it, which is the point; the announcement asks for the
  commit. A team that does not want it has three switches, none of which needs a server.
- Privacy: nothing leaves the machine. The block is the same text for every server, the
  uploader writes it without a request, and the decision file holds the repository name
  the hook already knows from the session's own remote.
- The uploader gains a few `lstat` calls and, once per repository, three small writes; hook
  mode gains one small JSON read on hinted events and one write once per repository. The
  150 ms budget is unchanged (`timing.perf.test.ts`).
- Two clones of one repository on one machine receive the block once between them; the
  second clone gets it when the commit is pulled. A checkout without a remote is its own
  repository for this purpose.
- Removing the block by hand (without `--off`) holds until a release changes the block
  text, when the differing hash writes it again. `--off` holds for good.
- The live canary's organic recall stage now runs with the repository block present from
  the first session; the measurement of the hint without the block (ADR 0069 follow-up)
  needs `AGENTCOMMONS_GUIDANCE_AUTO=0` in its environment.
- pi has no hinted event, so a pi-only machine gets the files and the `hook.log` line but
  no in-session announcement until the extension's system prompt carries it (ADR 0069
  follow-up).
