# 0009. Harnesses are adapters: reader + normalizer + hook mapping + fixtures

Date: 2026-09-07 · Status: accepted, amended by 0010

**Context.** The project must not be tied to any one agent vendor. Claude Code and Codex
were verified first; Gemini CLI and pi were added. They differ in ways that matter: Gemini
rewrites a JSON document instead of appending JSONL; pi has no shell hooks but an
extension API; pi sessions branch in place.

**Decision.** Every harness is four small pieces and nothing else: a `TranscriptReader`
(`jsonl-append` or `json-document`), a `Normalizer` (records → messages, session deltas,
links), a hook mapping onto six canonical events (`start`, `prompt`, `tool`, `turn_end`,
`subagent_end`, `end`), and live-captured fixtures. Harnesses without shell hooks get a
minimal extension that emits the canonical events by spawning the same `hook.js`. Search,
storage, tools, dashboard, and infra are harness-blind. A harness is listed as supported
only when the live verification job passes for it.

**Alternatives.** Per-harness ingest endpoints (four APIs to maintain); a daemon that
polls all known transcript directories (no per-event latency, but a resident process and
no knowledge of session boundaries); requiring harnesses to export MCP resources (none do).

**Consequences.** Adding a harness is a checklist (spec §3.1). Gemini's whole-file rewrite
costs a parse per sync; pi's branches are stored with `parentId` and rendered along the
active leaf.

**Amendment (0010).** Gemini CLI and pi adapters are written after their contracts are captured live; Gemini’s in-place message mutation must be captured first; pi branch-aware rendering deferred. Canonical behaviors reduced to `start`, `sync`, `end` plus child-source registration.
