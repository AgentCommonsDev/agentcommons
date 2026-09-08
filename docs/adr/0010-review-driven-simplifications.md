# 0010. Simplifications adopted from the 2026-09-07 external review

Date: 2026-09-07 · Status: accepted · Amends 0003, 0004, 0005, 0006, 0009

**Context.** An independent review (`docs/reviews/codex-review-2026-09-07.md`) of spec v2
found accumulated layers, several unsound guarantees, and security gaps. Spec v3 applies
the corrections and the simplifications that do not reverse explicit product decisions.

**Adopted.**

- Interface: filters cut to `repo_name`, `branch`, `user_email`, `tool_name`,
  `file_prefix`, `role`, `session_id`, `since`, `until`; `get` loses `full`; no `mode`
  field; consistent `api_ro` names in every output; match-centered excerpts; 5-hit default,
  32 KB budget, per-session cap; content and message continuation; cursors in MCP and REST.
- Catalog: static tools, permission-filtered; no data-derived schema content; discovery
  via `schema_columns`; no psql shortcuts, error enrichment, facet suggestions, saved
  examples, compat wrappers, CLI channel, or auto-installed skill in v1. One snippet.
- Adapters: explicit registrations over shared schemas and services instead of a
  route-introspection framework. The implementation uses the static service registry
  directly; the proposed `toolFromRoute` convenience helper was unnecessary.
- Ingest: per-record source position and native key; source order authoritative;
  deterministic message ids; committed acknowledgments; one pending batch per session
  with in-order sends; lifecycle by source order; metadata idempotency.
- Shim: a small state machine with persisted intent, lock ownership with liveness, child
  source registration at `SubagentStart`, retry classes, sweep in the uploader only;
  honest latency statement (event-triggered, no timer).
- Security: `security_barrier` views, invoker functions, relation/function allowlist,
  derived metadata from the visible set, effective key authority, safe bootstrap, audit in
  the mutation transaction, redaction on every persisted free-text path, complete purge
  manifest and tombstone enforcement, sensitive-file pairing by tool id with fail-closed.
- Data: adjacency list (no closure table, no `PendingLink`), no `TagEvent`/`SavedQuery`,
  random installation id, explicit file tools only, git results named as observations.
- Verification: invariant and kill-point tests, contract-generated Appendix C, capability
  matrix for canaries, flag matrix limited to embeddings; no coverage percentage or
  route-hit gates.

**Kept against the review, by product decision.** Admin-managed redaction policies with a
complete rescan (re-derive from raw); admin MCP tools (static, doubly authorized);
embeddings built behind a flag, slimmed (two adapters, internal fusion, no surface
change); Gemini CLI and pi adapters gated on live-captured contracts; the full dashboard
with its quality bar; the browser verification job. Nothing is phased for later shipping.

**Consequences.** Fewer concepts to build; the remaining complexity sits in the shim's
durability state machine and the database security contract, both of which are tested by
failure injection.
