# 0006. Semantic search implemented, disabled by default, invisible when off

Date: 2026-09-07 · Status: accepted, amended by 0010

**Context.** Embeddings cost money per token and were not wanted at launch, but retrofitting
them later would touch ingest, schema, search, and the tool surface.

**Decision.** Implement chunking, provider adapters (OpenAI, Voyage, Bedrock, Ollama, fake),
pg-boss jobs, HNSW storage, and RRF fusion now, behind `EMBEDDINGS_ENABLED=false`. Only
`searchable` text is ever embedded. When enabled, `search` gains `mode`, a `similar` tool
appears, `similar_sessions()` is advertised in the SQL description, and `/sessions/:id/similar`
is registered. When disabled none of that is listed or documented to agents. A daily token
budget caps spend.

**Alternatives.** Defer entirely (retrofit cost); enable by default (cost surprise).

**Consequences.** Enabling is a config change plus deploy; a catch-up job embeds existing
content within budget.

**Amendment (0010).** Slimmed: two adapters first (`openai`, `fake`); fusion internal to `search` with no `mode` field; no `similar` tool; `similar_sessions()` and `/sessions/:id/similar` only when enabled. It ships with the flag off.
