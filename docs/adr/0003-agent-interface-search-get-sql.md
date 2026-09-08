# 0003. Agent interface: `search`, `get`, `sql`

Date: 2026-09-07 · Status: accepted, amended by 0010

**Context.** Agents need to find prior work in one call, read more when necessary, and
occasionally compute counts or joins. Early drafts had seven tools, then a one-box query
grammar, then SQL only. Each had a specific failure: too many choices, misspelled grammar
(documented in GitHub's MCP issue tracker), or too much friction for "did anyone do X".

**Decision.** Three tools. `search(query, filters, context, limit)` with a fixed-enum filter
object (AND across keys, arrays OR within a key), PostgreSQL websearch syntax for free text,
and message windows with `context` neighbours as the result. `get(session_id, from, to,
full)` to expand. `sql(sql)` for everything else, over ~10 flat views with the schema in the
tool description. Results carry `session_id` and `seq`, which are exactly the keys `get` and
`sql` accept. Ingest decides what is searchable: whole prompts and replies, the first 1 KB of
tool inputs, the first 2 KB of tool results; nothing else is ranked or embedded. Tools are
listed per caller permission; admin tools appear only for admin keys; embeddings-dependent
additions appear only when enabled.

**Alternatives.** OpenAI's `search`/`fetch` pair (available behind a compat flag); a grep-shaped
tool (absorbed as context windows and filters); SQL only (kept as the escape hatch); GraphQL and
PostgREST (weak on aggregates and ad-hoc joins, extra auth model or container).

**Consequences.** No custom query language to maintain. Investigations are kept out of the
main context by tool-description text and an installed skill, not by server logic.

**Amendment (0010).** Filters reduced to nine keys with `api_ro` names; `get` has no `full`; no `mode`; static catalog; one guidance snippet; other channels deferred. See spec v3 §7–8.
