# ADR 0094: Proactive recall — rank prior work by reuse and surface it before an edit

## Status

Accepted. Builds on ADR 0090 (cross-user reuse boost and the `by_teammate` label) and the
recall hint (§6.2); the pre-tool tool-policy path (§6.5) gains a new, non-blocking output.
Reverses no prior decision.

## Context

AgentCommons exists so an agent finds prior work before repeating it. Production data shows
the reuse that happens is genuine — a large share is cross-user, one teammate reading
another's recent session (ADR 0090) — but only a fraction of sessions ever invoke recall.
The index holds the answer and the agent still re-derives it. That is an adoption and a
quality problem, not a corpus problem: the sessions worth reading are already indexed and
already visible to the caller, but the surfaces that could point at them do not, or point
at the wrong ones.

Two gaps drove this:

- **The recall surfaces ranked by recency, not by proven value.** The session overview and
  the recall cache listed a repository's _newest_ roots. Newest is not most useful: a
  canonical session that ten later sessions reused is exactly what a new session should
  open first, and recency buries it under whatever ran last. The cache also carried only
  `{ id, title, startedAt, branch }`, so nothing told the reader _why_ a session was worth
  opening — how often it was reused, whether a teammate wrote it, or which files it touched.

- **Nothing connected a session to the file a new session was about to change.** The
  strongest recall signal — "someone already worked on this exact file" — was never
  surfaced at the moment it mattered, the instant before an edit. The overview fires once
  at session start and the prompt-match hint keys off prompt text; neither watches the
  files the agent is about to touch.

Everything needed to close both gaps is already caller-visible under the row policies: the
reuse count, the `by_teammate` derivation (ADR 0090), and the files a session changed. So
the change is about _order and moment_, not about exposing anything new.

## Decision

Three changes, plus one measurement view to check whether they pay off.

**1. The recall feed ranks by reuse, with a cheap distilled preview.**
`GET /api/v1/sessions?recall=true` (§7.6) orders a repository's roots for the install
hook's cache by `reuse_count` descending, then `started_at` descending, `session_id`
breaking ties — proven-useful canonical sessions first, overriding `sort`/`order`. It stays
one scan of `api_ro.sessions` under the reader fence, scoped by `filters` and `roots_only`
like any list call, with totals from the same window aggregates. In recall mode each item
also carries `files`: up to three representative paths the session touched (files it changed
ranked ahead of read-only, then alphabetical), from one bounded scan of
`api_ro.session_files` over the page's own ids — absent for an ordinary list, so the
non-recall path keeps its single scan. The reuse count, `by_teammate`, `message_count` and
`end_reason` a recall item shows are the session header's own fields (R-GET-04, R-GET-08);
recall only fixes the order and adds the files sample. This extends the cross-user reuse
label of ADR 0090 from search and get into the hook's own cache.

**2. The hook injects a distilled, reuse-ranked overview and adds targeted before-edit
recall.** The session overview and prompt-match hint (§6.2) now rank by reuse count, then a
teammate's authorship, then recency, and render each named session as its title plus the
markers that say why it is worth opening (reused N×, a teammate's work, its top file, an
unusual end) with `get <id>`; a session with no signal reads as title, age and get. On top
of that, a **new before-edit recall**: on a pre-tool event for one of the harness's
edit/write tools (`editTools` in `HARNESSES`) whose policy decision is `allow`, hook mode
checks the already-refreshed cache for a session whose `files` include the file about to be
edited (the tool's path resolved to a repo-relative cached path and compared by equality)
and, on a match, prints one line naming the strongest such session with `get <id>`. It is
**file-match only** — never mere same-repository membership, so it does not fire on every
edit in an active repository — deduped **once per file per session** (`<state>.edits`),
**fail-open**, and **zero-network** (it reads the cache the uploader already refreshed).

**3. A new informational pre-tool `context` channel, distinct from the policy `warn`
channel.** The before-edit line rides an informational output on the pre-tool event
(Claude Code/Codex `additionalContext`, Gemini `systemMessage`), carrying **no `decision`
or `permissionDecision` field**, so it can never change the `allow` outcome and never reads
as a caution. This is deliberately separate from the tool-policy `warn` channel of §6.5,
which exists to flag a risky call; recall context is help, not a warning, and keeping the
channels distinct keeps the allow path unchanged and the two meanings unconfused.

**Measurement.** `api_ro.metrics_reuse_outcomes` (§10) puts the same root-rolled reuse
flags beside a session's outcome proxies (duration, tokens, tool calls, message count, a
`completed` finish proxy, and admin-only rerun-loop signal) so reused and non-reused work
can be compared rather than counted, and the `reuse_outcomes` starter tile splits root
sessions into no-reuse, same-user-reuse and cross-user-reuse cohorts. The comparison is
observational — sessions that reuse prior work may differ systematically — so its deltas are
read as associations alongside the north-star reuse rate, not as proof reuse caused them. It
exists to answer whether proactive recall pays off, not to assert that it does.

## Consequences

- Recall points at the sessions most likely to help first, and the reader sees why each is
  worth opening without a second request. The added value fields and files come from the
  same key's existing visibility, so nothing is exposed that the caller could not already
  read.
- The strongest recall signal — a teammate already edited this file — reaches the agent at
  the moment it matters, once per file, without blocking the edit or opening a connection.
  File-match-only scoping keeps it from spamming every edit in a busy repository.
- The informational `context` channel is a new, narrow output contract on the pre-tool
  event. It carries no decision field by construction, so a bug there degrades to a missing
  hint, never to a changed allow/deny outcome; the tool-policy `warn` and deny shapes of
  §6.5 are untouched.
- `recall=true` adds a second bounded scan (`api_ro.session_files`) only in recall mode; the
  ordinary list path is unchanged and still single-scan. The before-edit check is a cache
  read on the hook's hot path, held to the same budget as the other hints.
- Whether this lifts adoption and pays off in outcomes is now measurable but not yet proven;
  `metrics_reuse_outcomes` is observational and needs both cohorts populated to mean
  anything.
