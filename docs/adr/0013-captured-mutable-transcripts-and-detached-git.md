# 0013. Mutable source versions and hook latency

Date: 2026-09-07 · Status: accepted · Amends ADR 0005 and ADR 0009

Live Gemini 0.35.3 snapshots show tool results added to an existing message without
changing its id, index, or timestamp. An index-only reader loses those results, and
the original unique(session, pos) constraint cannot preserve raw versions. Add an
acknowledged per-index hash and increasing observation version to the document reader.
Persist raw versions under unique(session, pos, sourceVersion) and nativeId:hash keys;
only the latest version contributes derived messages and counters. Other readers use
version zero. Replays cannot advance version or duplicate usage.

Pi tree navigation changes the active leaf without changing transcript bytes, so
session_tree joins the sync event mapping. The active leaf travels in the envelope.
Codex SubagentStart can point to the child rollout; the harness table must carry those
path semantics. The capture report and fixtures provide the contracts.

Spec v3 also put three 500 ms git commands in hook mode while requiring every hook
to finish within 150 ms. Collect git metadata in the detached uploader. Hook mode
persists intent and native context; no git subprocess or network request runs there.
