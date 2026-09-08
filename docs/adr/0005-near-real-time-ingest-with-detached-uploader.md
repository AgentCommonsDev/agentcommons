# 0005. Near-real-time ingest via prompt and tool hooks, uploads in a detached process

Date: 2026-09-07 · Status: accepted, amended by 0010

**Context.** Syncing only at turn boundaries left crashed or killed sessions unsynced until
another session ran. Uploading inside `PostToolUse` would add network latency to every tool
call. Codex clamps `SessionEnd` hooks to 3 s (verified).

**Decision.** Hooks on `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`,
`SubagentStop`, `SessionEnd`. The hook process does no network I/O; it decides whether a sync
is due (prompt: always; tool call: ≥10 s since last sync or ≥64 KB pending) and spawns a
detached copy of itself to upload, then exits in ~50 ms. There is no inline-upload special
case: `SessionEnd` computes git end state locally and uploads detached like every other event.
A per-session lock handles concurrent firings (Codex fires each hook once per hooks file it
loaded). A sweep on every upload ships any stale session's growth.

**Alternatives.** A resident daemon (more to install and keep alive); turn-boundary-only sync
(10-minute-plus loss windows); inline uploads in `PostToolUse` (slows the agent).

**Consequences.** Crash loss window ≈10 s, and that data is still on disk for the sweep. One
Node start-up per tool call.

**Amendment (0010).** Latency is event-triggered with no timer; stated as ‘within about ten seconds during activity’. Durability is a persisted state machine: intent, one pending batch, lock ownership with liveness, in-order sends, `ackedCursor` advanced only on `202`. Child sources register at `SubagentStart`.
