# AgentCommons — Specification

Status: draft v2, 2026-09-07, implementation-ready. Owner: rek7.
First deployment: ZeroPath. Designed so any organization can self-host it; nothing
organization-specific is hardcoded. One organization per instance.

AgentCommons is a central, append-only index of coding-agent sessions. Hooks in each
harness (Claude Code, Codex, Gemini CLI, and pi) ship transcripts to one API. The API redacts
secrets, normalizes the transcript, links sessions into parent/child trees, and
exposes search to humans (dashboard) and to agents (MCP endpoint) so work is not
repeated and the session history becomes a living corpus.

Why a separate, self-hosted system: developer agent workflows run in terminals, IDEs,
and CI, not in chat apps, so tagging an assistant in Slack or relying on one vendor's
built-in session memory misses most of the work and ties the record to that vendor.
AgentCommons is harness-agnostic and owned by the team. Its value compounds with
coordination: agents and people see what was already tried, duplicate work drops, and
the corpus becomes the living record of decisions that versioned `CLAUDE.md`,
`AGENTS.md`, and skills files summarize but cannot explain.

Hook contracts were captured live on 2026-09-07 from Claude Code 2.1.263 and Codex
0.150.0 (all events) and Gemini CLI 0.35.3 (session events; tool events are documented
and are captured in Phase 2 with an API key). pi 0.73 is specified from its
documentation and captured in Phase 2. Raw payloads live under `fixtures/hooks/` and
are summarized in Appendix A. Nothing here is vendor-specific: a harness is an adapter
(§3.1), and adding one is a checklist, not a redesign.

---

## 1. Goals and non-goals

### Goals
- Capture every Claude Code, Codex, Gemini CLI, and pi session automatically after a
  one-line install (`curl … | sh`). Full transcripts, including subagents and tool output.
- Harness-agnostic by construction: the client ships raw transcript records plus a
  small envelope; the server normalizes. Adding a harness is a reader, a normalizer, a
  hook mapping, and fixtures (§3.1 checklist). No vendor lock-in at any layer: standard
  Postgres, standard MCP, raw records exportable.
- Catch failures before they are pushed. Most agent work, including failing tests and
  abandoned approaches, happens locally and never reaches a PR. Indexed sessions make
  those failures visible and searchable (`search` for an error string, `has_commits:
  false`, sessions with many test runs and no commit), so the team sees problems at the
  point they occurred, not weeks later.
- Append-only raw storage with a normalized message model on top.
- Parent/child relationships: subagents, resumes, forks, explicitly spawned.
- Search that is easy for agents and people and strong enough to be the backbone:
  `search` returns message windows with context, `get` expands a session, `sql`
  covers counts, facets, and the long tail. No query grammar to learn. Semantic
  ranking is implemented and shipped disabled.
- Retrieve full sessions and session trees by id.
- API keys with scopes, every read and write audited with IP.
- Automatic secret redaction before anything is persisted, with admin-managed
  redaction policies so each organization can add its own secret formats without a
  deploy.
- Admin and user roles. Admins can make sessions private or purge them.
- Full dashboard for users and admins.
- Configurable login: any OIDC/SSO provider or email and password, chosen at deploy
  time. Safe to expose on the public internet.
- Unit, integration, and e2e tests. Strict TypeScript, linting, CI. Deployed to AWS
  with Pulumi.

### Non-goals for v1 (see §18)
- LLM-generated session summaries.
- PII redaction beyond secrets.
- Multi-tenancy. One flat namespace per deployment.
- Sub-second streaming. Ingest is near-real-time: every prompt and every tool call
  triggers a throttled sync, so the loss window on a crash is about 10 seconds.
- Backfill of transcripts that predate the install. Removed from scope.
- Windows clients. The shim targets macOS and Linux.

---

## 2. Architecture

```
 developer machine                              AWS (Pulumi)
 ┌───────────────────────────────┐             ┌───────────────────────────────────────┐
 │ Claude Code ─ hooks ─┐        │   HTTPS     │ ALB ─► ECS Fargate: apps/api          │
 │ Codex ─────── hooks ─┼► hook.js ────────────►   /api/v1/*     REST + OpenAPI        │
 │                      │ (zero-dep, Node ≥20) │   /mcp          MCP streamable HTTP   │
 │  ~/.agentcommons/    │        │             │   /auth/*       Better Auth            │
 │    config.json state/ spool/  │             │   /install.sh   /hook.js               │
 └───────────────────────────────┘             │   /            dashboard (static SPA) │
                                               │   in-process worker (pg-boss)          │
 agents (Claude Code / Codex)                  │        │                               │
   MCP client ── bearer API key ───────────────►  RDS Postgres 16: pgvector, pg_trgm    │
                                               │  Secrets Manager · CloudWatch · ECR    │
                                               └───────────────────────────────────────┘
```

Ingest: hook fires → `hook.js` tails the transcript from its last byte offset →
POSTs raw lines → server dedupes, redacts, stores raw records, normalizes to
messages, updates session metadata and links, writes an audit event.

Read: dashboard (cookie session) or agent (API key over REST or MCP) → auth →
visibility and role checks → query → audit event.

One deployable container serves everything. One ALB, one service, one database.

---

## 3. Monorepo and libraries

```
agentcommons/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.js  .prettierrc
  docker-compose.yml               pgvector/pgvector:pg16 for local dev
  .github/workflows/ci.yml
  apps/
    api/                           Fastify: REST, MCP, auth, audit, worker, static dashboard
      src/mcp/tools/               custom describe()/format() for search, get, sql; other tools derive from routes (§3.1)
      public/install.sh            install script (__PUBLIC_URL__ substituted at serve time)
      public/skill.md              agentcommons-investigate skill served to clients
    dashboard/                     Vite + React + TypeScript + Tailwind + shadcn/ui
  packages/
    db/                            Prisma schema, migrations (incl. hand-written SQL: api_ro
                                   views, search_messages() function), seed
    core/                          zod schemas, normalizers (claude-code, codex), redaction,
                                   link detection
    hook/                          zero-dependency shim → dist/hook.js (single file)
  infra/                           Pulumi TypeScript (@pulumi/awsx), stacks: dev, prod
  fixtures/
    hooks/                         live-captured hook payloads (Appendix A)
    transcripts/                   sanitized real transcripts, one directory per harness
  docs/SPEC.md  docs/adr/
```

Dependency rules: `hook` has no runtime dependencies. `core` depends on zod only.
`api` depends on `core` and `db`. `dashboard` depends on `core` types and an OpenAPI
generated client. `infra` is standalone.

### 3.1 Internal architecture: one service layer, thin adapters
**Core tenet: one implementation per concept, everywhere.** Harness differences,
transport differences, and feature flags are expressed as data (tables, schemas, config)
that a single implementation reads, never as parallel code paths. A reviewer who finds
`if (harness === …)` outside an adapter, or the same logic in two adapters, treats it as
a defect. This is what keeps adding a harness, a route, or a tool cheap and safe.

The same capabilities are reached from REST, MCP, the CLI, and the dashboard. To keep
that from becoming four copies of the same logic, the API is organized as one service
layer with adapters that only translate:

```
adapters   REST routes · MCP tools · CLI (hook.js sql/search/get over REST) · dashboard (OpenAPI client)
              │ validate with the SHARED zod schemas, call a service, format
services   SearchService.search(args, caller)   SessionService.get(args, caller)   QueryService.sql(sql, caller)
           IngestService.append(envelope, caller) AdminService.*                   FacetService.values()
              │ one implementation each; visibility via the caller's reader pool; audit on every call
data       Prisma (typed) · pg pools per reader role (api_ro) · pg-boss
```

Rules that follow:
- **One schema per concept, shared.** `packages/core/schemas/` holds the zod schemas for
  `search` input, `get` input, filters, envelope, and result shapes. REST bodies, MCP
  `inputSchema` (via `zod-to-json-schema`), the OpenAPI document, the dashboard client,
  and the CLI flags are all derived from them. A filter key is added in exactly one place.
- **Every route is declared with zod, or it does not boot.** Routes register
  `{ params, querystring, body, response }` zod schemas through
  `fastify-type-provider-zod`; `@fastify/swagger` turns them into the OpenAPI document at
  start-up. A startup check walks the route table and refuses to start if any route under
  `/api` lacks a response schema or a `summary`, so documentation cannot lag behind code.
- **Routes opt into MCP with one option.** A route may declare
  `config.mcp = { name, permission, describe, format? }`. The tool registry then derives
  an MCP tool from that route: `inputSchema` is the merged params/query/body schema,
  `outputSchema` is the response schema, the handler calls the same service, and the
  default text rendering is the shared formatter. `search`, `get`, and `sql` are routes
  with `mcp` set plus a custom `format`; the admin tools are the admin routes with `mcp`
  set. Exposing a new capability to agents is therefore a route with one extra line,
  and it inherits auth, audit, and documentation.
- **One formatter.** `packages/core/format/` renders search blocks, session headers,
  transcripts, and SQL result tables to text and to structured JSON. MCP text output,
  CLI output, and dashboard "copy as text" all call it.
- **One visibility mechanism.** The caller object carries `{ userId, role, permissions,
  apiKeyId }`; services pick the reader pool by role. No service takes a "skip
  visibility" flag.
- **One audit path.** Services return `{ result, audit }`; the adapter's response hook
  writes the AuditEvent. Adapters never write audit rows directly.
- **One normalizer interface.** `Normalizer { harness, detect(line), toMessages(records),
  sessionDelta(records), links(records) }`; Claude Code and Codex implement it; a new
  harness is a new file plus fixtures.
- **One shim, harnesses as a table.** `hook.js` contains a single `HARNESSES` object;
  each entry is data, not code:
  ```js
  gemini: { events: { SessionStart: 'start', BeforeAgent: 'prompt', AfterTool: 'tool', AfterAgent: 'turn_end', SessionEnd: 'end' },
            reader: 'json-document', settings: '~/.gemini/settings.json', hooksKey: 'hooks', timeoutUnit: 'ms',
            mcp: { file: '~/.gemini/settings.json', key: 'mcpServers', shape: 'httpUrl' } }
  ```
  Everything else in the shim (state, lock, throttle, spool, sweep, upload, install,
  doctor) is shared and reads that table. Two reader functions exist, `jsonl-append`
  (Claude Code, Codex, pi: byte-offset tail) and `json-document` (Gemini CLI: parse the
  rewritten file, emit messages past the last synced index); a harness picks one by
  name. The cursor is opaque to the server. Harnesses without shell hooks (pi) get a
  tiny extension that emits the same canonical events (`start`, `prompt`, `tool`,
  `turn_end`, `subagent_end`, `end`) by spawning `hook.js`; it contains no upload logic.
- **Adding a harness, checklist**: (1) capture hook payloads live into
  `fixtures/hooks/<harness>-<version>-hook-events.jsonl`; (2) sanitize a transcript into
  `fixtures/transcripts/<harness>/`; (3) add the `harness` enum value; (4) implement
  `Normalizer` in `packages/core/normalizers/<harness>.ts` with snapshot tests over the
  fixture; (5) add one entry to the shim's `HARNESSES` table (and a reader only if the
  transcript format is genuinely new); (6) add the harness to the live verification job
  (§16.1). Nothing else changes: install, upload, search, storage, tools, and dashboard
  are harness-blind. Expected size: one normalizer file, one table entry, fixtures.
- **One provider interface** for embeddings (`embed(texts, dims)`) and one for email
  (`send(msg)`); adapters per vendor.
- **Generated, not written**: OpenAPI from routes, the dashboard client from OpenAPI,
  MCP tools from routes, MCP input schemas from zod, the `sql` description from the
  catalog, Better Auth models from its generator.

### Libraries (use, don't build)

| concern | library | notes |
|---|---|---|
| HTTP | Fastify 5, `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/static`, `@fastify/compress` | ubiquitous, fast, plugin ecosystem |
| Validation + OpenAPI | zod, `fastify-type-provider-zod`, `@fastify/swagger`, `@fastify/swagger-ui` | one schema → types, validation, docs |
| Typed client | `openapi-typescript`, `openapi-fetch` | dashboard client generated from the OpenAPI doc; no hand-written fetchers |
| Auth | Better Auth: Prisma adapter, `admin`, `apiKey`, `genericOAuth`, `openAPI` plugins | users, roles, keys, SSO, email/password, sessions, CSRF |
| DB | Prisma, PostgreSQL 16, `pgvector`, `pg_trgm`, `pg` (raw pool for `/query`) | |
| Jobs | pg-boss | Postgres-backed queue; no extra infrastructure |
| Redaction | secretlint (`@secretlint/core`, preset-recommend, rule-pattern) | programmatic API |
| SQL guard | `pgsql-ast-parser` | pure TypeScript SQL parser |
| MCP | `@modelcontextprotocol/sdk` | Streamable HTTP server transport |
| Embeddings | `openai`, `voyageai`, `@aws-sdk/client-bedrock-runtime`, Ollama over fetch, `js-tiktoken` | behind an adapter interface, off by default |
| Email | nodemailer (SMTP) or `@aws-sdk/client-sesv2` | verification, reset, invites |
| Logging | pino, `pino-pretty` in dev | |
| Config | zod-validated env via `@t3-oss/env-core` | fails fast at boot |
| Dashboard | React 19, Vite, Tailwind, shadcn/ui, TanStack Router + Query, `@uiw/react-codemirror` (SQL), `react-virtuoso`, `shiki`, `date-fns` | |
| Infra | Pulumi, `@pulumi/awsx` Crosswalk (VPC, ECS/Fargate service, ALB), `@pulumi/aws` | far less code than raw resources |
| Tests | Vitest, `@testcontainers/postgresql`, Playwright, Fastify `inject` | |
| Lint/format | ESLint 9 + typescript-eslint strict-type-checked, Prettier, knip | |

---

## 4. Data model

IDs are UUIDv7 generated in the application (`uuidv7` package). Timestamps are `timestamptz`. Better
Auth owns `user`, `session` (web), `account`, `verification`, `apikey`; its schema
generator emits those Prisma models and we do not hand-edit them.

### 4.1 Identity
- **User**: Better Auth user. `role` ∈ {`admin`, `user`} via the Admin plugin.
  Optional allow-list of email domains enforced server-side (§9.1).
- **ApiKey**: Better Auth API Key plugin. Belongs to one user; a user may hold many
  (laptop, CI runner, a service). Fields used: `name`, `permissions`
  (`{ sessions: ["ingest" | "read"], admin: ["*"] }`), `expiresAt`, `rateLimit*`,
  `metadata.deviceLabel`. Hashed at rest; plaintext shown once; prefix `ac_` so
  secret scanners recognize it. Admin permission grantable only by admins.
- **Device**: `id`, `machineId` (sha256 of `/etc/machine-id` on Linux,
  `IOPlatformUUID` on macOS, fallback hostname), `hostname`, `osUser`, `platform`,
  `arch`, `firstSeenAt`, `lastSeenAt`. Unique on `machineId`. Linked to sessions.

### 4.2 Session

| column | notes |
|---|---|
| `id` | UUIDv7 |
| `harness` | enum `CLAUDE_CODE`, `CODEX`, `GEMINI_CLI`, `PI` |
| `harnessSessionId` | native id; for Claude subagents `<sessionId>:agent-<agentId>`; unique with `harness` |
| `harnessVersion` | Claude: `version` on records; Codex: `session_meta.cli_version` |
| `entrypoint` | `cli`, `sdk`, `exec`, `tui`, `other` (Claude `entrypoint`; Codex `originator`) |
| `userId`, `ingestApiKeyId` | owner from the first ingesting key |
| `deviceId` | FK Device |
| `cwd`, `repoRoot`, `cwdRelative` | `git rev-parse --show-toplevel`; cwd relative to it (monorepo subdir) |
| `repoUrl`, `repoName` | normalized `host/org/repo` from `origin`; null outside a repo |
| `branch` | null when detached |
| `startCommit`, `endCommit` | |
| `commits` | jsonb `[{sha, subject, authoredAt}]` made during the session |
| `diffStat` | jsonb `{filesChanged, insertions, deletions}` vs. start commit |
| `dirtyFileCount` | uncommitted changes at end |
| `model`, `modelsUsed` | dominant model; all models seen |
| `startedAt`, `endedAt`, `lastActivityAt` | |
| `status` | `ACTIVE`, `ENDED`, `STALE` (no activity 6 h, no end event) |
| `endReason` | Claude: `clear`, `logout`, `prompt_input_exit`, `other`; Codex: as sent |
| `title` | Claude `aiTitle` → Codex `session_index` thread name → first prompt, 120 chars |
| `firstPrompt` | redacted, ≤ 4 KB |
| `parentSessionId`, `parentRelation` | relation ∈ `SUBAGENT`, `RESUME`, `FORK`, `SPAWNED` |
| `rootSessionId`, `depth` | denormalized |
| `agentType`, `agentRole` | Claude `agent_type` (e.g. `Explore`); Codex `agent_role`/`agent_nickname` |
| `visibility` | `PUBLIC`, `PRIVATE` |
| `purgedAt`, `purgedByUserId`, `purgeReason` | tombstone |
| `messageCount`, `toolCallCount`, `inputTokens`, `outputTokens`, `cacheReadTokens` | |
| `toolsUsed`, `tags`, `linearIssueKeys`, `modelsUsed` | `text[]` |

Related tables: **SessionFile** (`sessionId`, `path`, `ops text[]` e.g. `read`,
`edit`, `write`; unique per session+path; `pg_trgm` GIN on `path`) and
**TagEvent** (`sessionId`, `tag`, `op ADD|REMOVE`, `actorUserId`, `createdAt`;
`Session.tags` recomputed from it). **PendingLink** (`childSessionId`,
`parentHarness`, `parentHarnessSessionId`, `relation`) holds links whose parent has
not arrived yet.

Indexes: unique `(harness, harnessSessionId)`; btree on `userId`, `deviceId`,
`repoUrl`, `branch`, `model`, `startedAt desc`, `lastActivityAt desc`,
`parentSessionId`, `rootSessionId`, `visibility`, `status`; composite
`(repoUrl, branch, startedAt desc)`, `(userId, startedAt desc)`; GIN on
`toolsUsed`, `tags`, `linearIssueKeys`; `pg_trgm` GIN on `title`. There is no
session-level text index; search is over messages (§7.1).

### 4.3 Records and messages

**RawRecord** — append-only, exactly what the harness wrote, after redaction.
`id`, `sessionId`, `seq`, `recordKey` (Claude `uuid`; Codex `ordinal`; else sha256
of the line), `recordType`, `payload` jsonb, `byteOffset`, `ingestBatchId`,
`ingestedAt`. Unique `(sessionId, recordKey)`. Index `(sessionId, seq)`.

**Message** — normalized for search and display.
`id`, `sessionId`, `rawRecordId`, `seq`, `role` (`USER`, `ASSISTANT`,
`TOOL_RESULT`, `SYSTEM`), `kind` (`TEXT`, `THINKING`, `TOOL_USE`, `TOOL_RESULT`,
`META`), `content` text (full), `toolName`, `toolUseId`, `toolInput` jsonb, `model`,
`timestamp`, `inputTokens`, `outputTokens`, `agentId`, `truncated`, `originalBytes`,
`contentSha256`, and the search columns decided at ingest (§7.1): `searchable` bool,
`searchText` text (the ranked portion), `searchTsv` generated over `searchText`.
Index `(sessionId, seq)`, `toolName`, GIN `searchTsv` (partial `WHERE searchable`).

**SavedQuery**: `id`, `title`, `description`, `sql`, `createdByUserId`, `createdAt`,
`isExample`. Curated by admins from the dashboard's Query page; exposed to agents as
`api_ro.query_examples` (§7.4). Seeded with eight examples.

**IngestBatch**: `id`, `sessionId`, `apiKeyId`, `userId`, `ip`, `userAgent`,
`hookEvent`, `receivedAt`, `recordCount`, `duplicateCount`, `byteCount`,
`redactionCount`, `durationMs`.
**RedactionEvent**: `ingestBatchId`, `sessionId`, `ruleId`, `count`. Never the value.
**RedactionPolicy**: `id`, `name`, `kind` (`REGEX` | `SECRETLINT_RULE`), `pattern` or
`ruleConfig` jsonb, `replacement` (default `[REDACTED:<name>]`), `enabled`,
`builtin` (the shipped rules appear here so admins can disable them), `createdByUserId`,
`createdAt`, `updatedAt`. Admin-managed (§5.3).
**AuditEvent**: §9.3.
**MessageChunk**, **SessionEmbedding**: §11.

### 4.4 Full sessions and large content

**We store the full session.** Every line of the main transcript and of every
subagent transcript is stored as a RawRecord: user prompts, assistant text, thinking
blocks as written by the harness, every tool call with its full input and full
result, attachments, system records, compaction summaries, and Codex's base
instructions and developer messages. Nothing is sampled or summarized.

Large tool results (file reads, command output) are the one place we bound size,
and only defensively, because the harnesses already bound them: Claude Code caps a
`Read` at 2000 lines and a `Bash` result around 30 KB before writing the transcript;
Codex caps shell output similarly. Policy:
- Per-record cap 1 MB. Above that the content keeps the first 768 KB and last
  192 KB with a marker `[agentcommons: truncated N bytes]`, `truncated=true`,
  `originalBytes` and `contentSha256` of the original. Expected to be rare.
- Base64 image blocks become `[image: <mime>, N bytes]`. Images are not stored.
- Only `searchText` is indexed and embedded: the whole of prompts and assistant
  text, the first 1 KB of a tool input, the first 2 KB of a tool result (§7.1). A
  200 KB file read contributes 2 KB to the index and cannot dominate ranking; the
  full content is still stored and returned by `get`.
- Request body cap 10 MB after gzip; the shim splits larger syncs.
- Postgres TOAST compresses large text; nothing extra.

### 4.5 Prisma notes
- `tsvector` and `vector(N)` columns are `Unsupported(...)` in Prisma; the generated
  columns, GIN/HNSW indexes, `api_ro` views, closure table triggers, and the reader
  role live in hand-written SQL migration steps next to the Prisma migrations.
- Extensions created in the first migration: `vector`, `pg_trgm`.
- Everything typed goes through the Prisma client; ranked search uses
  `prisma.$queryRaw` tagged templates; `/query` and `/search` use `pg` pools under
  the two reader roles (§7.5).

---

## 5. Ingest protocol

### 5.1 Endpoint
`POST /api/v1/ingest` — permission `sessions:ingest`. `Content-Encoding: gzip` accepted.

```jsonc
{
  "envelopeVersion": 1,
  "harness": "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI",
  "harnessSessionId": "415cee4b-…",              // Claude subagent: "<sessionId>:agent-<agentId>"
  "hookEvent": "SessionStart" | "UserPromptSubmit" | "PostToolUse" | "Stop" | "SubagentStop" | "SessionEnd" | "Sweep",
  "hookSource": "startup" | "resume" | "clear" | "compact" | null,   // SessionStart only
  "sentAt": "2026-09-07T19:31:00Z",
  "device": { "machineId": "sha256…", "hostname": "…", "osUser": "…", "platform": "linux", "arch": "x64" },
  "context": {
    "cwd": "/home/u/cunningham/apps/web",
    "git": { "root": "/home/u/cunningham", "remoteUrl": "git@github.com:Org/cunningham.git",
             "branch": "demo", "head": "68bde3…", "isWorktree": false } | null,
    "parentHint": { "harnessSessionId": "…", "relation": "SUBAGENT" | "SPAWNED",
                    "agentId": "a91e…", "agentType": "Explore" } | null,
    "tags": ["from", "AGENTCOMMONS_TAGS"]
  },
  "records": { "cursor": "48213", "lines": ["{…}", "…"] },   // cursor is opaque per reader: byte offset (JSONL) or message index (JSON document)
  "end": {                                        // SessionEnd only
    "reason": "other",
    "head": "…", "commits": [{ "sha": "…", "subject": "…", "authoredAt": "…" }],
    "diffStat": { "filesChanged": 3, "insertions": 40, "deletions": 2 }, "dirtyFileCount": 1
  } | null
}
```

Response `202`:
`{ "sessionId": "0192…", "accepted": 120, "duplicates": 3, "redactions": 2 }`. The
shim advances its own cursor on `202`.

### 5.2 Semantics
- Upsert Session on `(harness, harnessSessionId)`. First writer sets `userId`. A
  write from another user's key → `409` unless the key has admin permission. Audited.
- Records insert with `ON CONFLICT (sessionId, recordKey) DO NOTHING`; retries,
  overlapping ranges, and duplicate hook firings are all safe.
- `seq` is assigned in arrival order after the current max; readers sort by
  `(timestamp, seq)`.
- One transaction per batch: raw records, messages, files, counters, links, tags,
  IngestBatch.
- `SessionStart` with `hookSource=resume|clear|compact` on an existing session adds a
  `META` message and flips `status` back to `ACTIVE`.
- No endpoint updates or deletes RawRecord or Message except admin purge (§9.5).

### 5.3 Redaction
In memory, on every line, before any write. secretlint programmatically with the
recommended preset (AWS, GCP, GitHub, Slack, npm, Stripe, SendGrid, private keys,
basic-auth URLs, …) plus a pattern rule for: Anthropic `sk-ant-…`, OpenAI
`sk-…`/`sk-proj-…`, JWTs, `postgres://user:pass@`, generic
`(api[_-]?key|secret|token|password)\s*[:=]\s*\S{12,}`, our own `ac_…` keys, and any
organization-specific patterns. Each match becomes
`[REDACTED:<ruleId>]`, irreversibly. Applied to the raw line as text; if the line no
longer parses as JSON, fall back to redacting each string leaf. Tool results whose
input path matches `**/.env*`, `**/*.pem`, `**/*.key`, `**/id_rsa*`,
`**/credentials*`, `**/.npmrc`, `**/.netrc` are replaced wholesale with
`[REDACTED:sensitive-file <path>]`. Counts per rule go to RedactionEvent. The server
never logs bodies; pino redact paths cover `records.lines`.

**Admin-managed policies (base feature).** The active rule set is the shipped rules
plus rows in `RedactionPolicy`, composed into a secretlint config at run time and cached
for 30 s, so admins can add an organization's own secret formats without a deploy:
- Admin → Redaction page and `/api/v1/admin/redaction/policies`: create, edit, enable,
  disable, delete; `kind=REGEX` (pattern, flags, replacement) or `kind=SECRETLINT_RULE`
  (any published `@secretlint/secretlint-rule-*` with options). Built-in rules are listed
  as `builtin=true` and can be disabled but not deleted.
- **Test before saving**: `POST /admin/redaction/test { text, policyIds? }` returns what
  would be redacted, so a pattern can be checked against sample text.
- **Rescan**: `POST /admin/redaction/rescan { policyIds?, since? }` enqueues a pg-boss
  job that runs the selected policies over stored `content`/`searchText` and rewrites
  matches in place, recording RedactionEvents and one audit row per session touched.
  This is the second and last path (after purge) that modifies stored content; it is
  admin-only and reason-tagged.
- Hit counts per policy over time are on the Status page so noisy patterns show up.
- `REDACTION_EXTRA_PATTERNS` (env) still seeds policies at boot for infrastructure-as-code
  deployments; seeded rows are editable like any other.

### 5.4 Normalization (`packages/core/normalizers`)
Permissive: unknown record types are stored as RawRecord only. Zod schemas use
`passthrough()` so new harness fields are kept.

**Claude Code** (`~/.claude/projects/<slug>/<sessionId>.jsonl`). Observed record
types: `user`, `assistant`, `system`, `attachment`, `summary`, `ai-title`,
`last-prompt`, `queue-operation`, `atis-latch`. Fields: `uuid`, `parentUuid`,
`sessionId`, `cwd`, `gitBranch`, `version`, `timestamp`, `isSidechain`, `agentId`,
`entrypoint`, `message.{role, model, content[], usage}`, `toolUseResult`, `aiTitle`.
Content blocks: `text`, `thinking`, `tool_use`, `tool_result`, `image`. Subagent
transcripts: `<slug>/<sessionId>/subagents/agent-<agentId>.jsonl` (+ `.meta.json`);
the main transcript does **not** contain subagent rows (verified).

**Codex** (`~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`). Record types:
`session_meta`, `turn_context`, `response_item`, `event_msg`, `world_state`.
`session_meta.payload`: `id`, `cwd`, `originator`, `cli_version`, `source`,
`thread_source`, `git.{repository_url, branch, commit_hash}`, `agent_nickname`,
`agent_role`, `base_instructions` (stored once as a `SYSTEM/META` message, excluded
from search). `response_item.payload.type`: `message` (user/assistant/developer →
developer is `SYSTEM`), `function_call` / `local_shell_call` / `custom_tool_call` →
`TOOL_USE`, `function_call_output` → `TOOL_RESULT`, `reasoning` → `THINKING`.
`turn_context.payload.model` sets the model; `event_msg` `token_count` sets usage. A
second `session_meta` in the same file means the session was resumed.

**Gemini CLI** (`~/.gemini/tmp/<project>/chats/session-<timestamp>-<id8>.json`). One
pretty-printed JSON document, rewritten in full with `writeFileSync` on every change
(verified in `chatRecordingService.js`), shape `{ sessionId, projectHash, startTime,
lastUpdated, messages: [{ id, type: "user" | "gemini", content, thoughts[], toolCalls[],
tokens, model, timestamp }] }`. Large tool outputs are spilled to
`~/.gemini/tmp/<project>/tool-outputs/session-<id>/`; the reader inlines them when a
`toolCalls[]` entry references a file. `recordKey` is the message `id`. `type: "user"` →
`USER TEXT`; `type: "gemini"` → `ASSISTANT TEXT` plus one `TOOL_USE` per `toolCalls[]`
entry and one `TOOL_RESULT` for each result; `thoughts[]` → `THINKING`. Hook stdin is
the same contract as Claude Code (Appendix A).

**pi** (`~/.pi/agent/sessions/--<cwd-encoded>--/<timestamp>_<uuid>.jsonl`). Append-only
JSONL forming a tree: header `{ type: "session", version: 3, id, timestamp, cwd,
parentSession? }`, then entries with `id`, `parentId`, `timestamp`, `type` ∈ `message`,
`model_change`, `thinking_level_change`, `compaction`, `branch_summary`, `custom`,
`custom_message`, `label`, `session_info`. `message.role` ∈ `user`, `assistant`,
`toolResult`, `bashExecution`, `custom`; assistant content holds `toolCall` blocks
(`id`, `name`, `arguments`); `toolResult` messages carry `toolCallId`, `toolName`,
`content`, `isError`. `recordKey` is the entry `id`. All entries are stored; messages
keep `parentEntryId` in raw so branches are reconstructible; `branch_summary` and
`compaction` become `SYSTEM TEXT` (searchable); `model_change` sets `model`. pi has no
shell hooks; a small extension (§6.1) emits the canonical events. It is installed from
this repo as a pi package (`git:` source in pi's `settings.json`).

Files touched: Claude `Read`/`Edit`/`Write`/`MultiEdit`/`NotebookEdit` inputs; Codex
`apply_patch` and shell `cat`/`sed`/redirects; Gemini `read_file`/`write_file`/
`replace`/`run_shell_command`; pi `read`/`edit`/`write`/`bash`, best effort. Paths
stored relative to `repoRoot` when inside it.

### 5.5 Parent/child detection

| relation | Claude Code | Codex | Gemini CLI | pi |
|---|---|---|---|---|
| `SUBAGENT` | `SubagentStop` gives `agent_id`, `agent_type`, `agent_transcript_path`; shipped with `parentHint` | child rollout's `session_meta.source.subagent.thread_spawn.parent_thread_id` (+ `depth`, `agent_nickname`, `agent_role`); `SubagentStart/Stop` hooks verified by name, exercised in Phase 2 | checked in Phase 2; none assumed | none natively; `SPAWNED` via env |
| `RESUME` | `SessionStart` `source=resume`; same Session | second `session_meta` in the same rollout; same Session | `SessionStart` `source=resume` (`--resume`); same file | `session_start.reason=resume`; same file |
| `FORK` | `--fork-session`: new id whose first 3 `recordKey`s already exist elsewhere | `codex fork`: recordKey-prefix check on `response_item.id` | not applicable | header `parentSession` path → parent by file name; `reason=fork` |
| `SPAWNED` | env `AGENTCOMMONS_PARENT_SESSION_ID` read by the shim | same | same | same (read by the extension) |

Unresolved parents wait in PendingLink and resolve when the parent arrives.
`rootSessionId`/`depth` recompute for the subtree on link. Cycles are rejected.

---

## 6. Hook shim and install script

### 6.1 `curl | sh` install
The server hosts `GET /install.sh` (template with `PUBLIC_URL` substituted) and
`GET /hook.js` (+ `/hook.js.sha256`). Users run:

```
curl -fsSL https://agentcommons.example.com/install.sh | sh -s -- --key ac_…
```

The script is POSIX sh, idempotent, and does, in order:
1. Detect macOS or Linux; require `curl` and `node` ≥ 20; record the absolute `node`
   path (hooks run without the user's shell PATH; fish users in particular).
2. Download `hook.js`, verify sha256, install to `~/.agentcommons/hook.js`.
3. Write `~/.agentcommons/config.json` (mode 0600): server URL, key, machine id,
   node path, optional `tags`, `disabledPaths` (globs, default empty).
4. `node hook.js install`, which merges (idempotently, keyed on the string
   `agentcommons` in the command):
   - Claude Code `~/.claude/settings.json`: hooks `SessionStart`, `UserPromptSubmit`,
     `PostToolUse`, `Stop`, `SubagentStop`, `SessionEnd` →
     `<node> ~/.agentcommons/hook.js claude`, `timeout: 10`.
   - Codex `~/.codex/hooks.json`: same events → `… hook.js codex`, `timeout: 10`.
     Codex clamps `SessionEnd` to 3 s (observed); the shim budgets for it.
   - Gemini CLI `~/.gemini/settings.json` `hooks`: `SessionStart`, `BeforeAgent`
     (prompt), `AfterTool`, `AfterAgent` (turn end), `SessionEnd` →
     `… hook.js gemini`, `timeout: 10000` (Gemini's unit is milliseconds).
   - pi `~/.pi/agent/settings.json` `packages`: adds this repo's `packages/pi-extension`
     as a `git:` package, whose extension maps `session_start`, `input`, `tool_result`,
     `agent_end`, `session_shutdown` to the canonical events by spawning `hook.js pi`
     with a JSON payload in the same shape as the shell hooks (`session_id`,
     `transcript_path` from `ctx.sessionManager.getSessionFile()`, `cwd`,
     `hook_event_name`). Skipped if pi is not installed.
   - MCP registration: `claude mcp add -s user -t http agentcommons <URL>/mcp
     -H "Authorization: Bearer <key>"`, `codex mcp add agentcommons --url <URL>/mcp
     --bearer-token-env-var AGENTCOMMONS_API_KEY`, and Gemini CLI's `mcpServers` entry
     in `~/.gemini/settings.json` (`httpUrl`, `headers.Authorization`). pi reaches the
     same capability through the CLI channel (§8.6) or its MCP adapter package.
   - `export AGENTCOMMONS_API_KEY=…` appended to the user's shell rc (bash, zsh,
     fish) unless `--no-shell-rc`; needed by Codex's MCP client.
5. Writes the `agentcommons-investigate` skill (§8.4) into `~/.claude/skills/` and
   `~/.codex/skills/`, fetched from `/skill.md`.
6. `node hook.js doctor`: calls `GET /api/v1/me` with the key, prints the user and
   key name, checks every installed harness's config (Claude Code, Codex, Gemini CLI,
   pi), and prints the CLAUDE.md/AGENTS.md/GEMINI.md snippet (§8.4).
7. Prints the one manual step: **Codex runs no hooks until trusted.** On the next
   interactive `codex` launch, accept the prompt to trust `~/.codex/hooks.json`
   (verified: with hooks configured but untrusted, `codex exec` ran zero hooks).

`--uninstall` removes hooks, MCP entries, and the rc line, and leaves `config.json`.
Re-running the script upgrades `hook.js` in place.

### 6.2 Shim requirements
One JS file, no dependencies, Node ≥ 20 (`fetch`, `zlib`, `crypto`, `fs`,
`child_process`). It has exactly two entry modes and one code path per mode:

**Hook mode** (`hook.js <harness>`), what the harness runs on every event. It reads
the hook JSON from stdin, maps the event through the harness table (§6.3), loads the
session's small state file, and answers one question: is a sync due? (`prompt` and
`end`: always; `tool`: if ≥ `syncIntervalSeconds` since the last sync or ≥ 64 KB has
been appended; `turn_end`: always.) If not, it exits 0. If so, it starts the same file
again in upload mode, detached, and exits 0:
```js
spawn(process.execPath, [__filename, 'upload', statePath], { detached: true, stdio: 'ignore' }).unref();
```
`detached` puts the child in its own process group, so it is not killed when the
harness moves on or exits; `unref` lets the parent exit without waiting. Hook mode
never opens a network connection, so its wall time is Node start-up plus a `stat`,
about 50 ms, on every event, for every harness. For `end` it additionally runs the
three local git commands for the end-of-session block (≈100 ms) and writes them into
the state file for the uploader.

**Upload mode** (`hook.js upload <statePath>`), always a detached child. It takes the
per-session lock (`open` with `wx`; stale after 60 s; if held, exit), reads new records
through the harness's reader from the saved cursor, gzips them into the envelope, POSTs
to `/api/v1/ingest`, and on `202` writes the new cursor to the state file. On any
failure it writes the envelope to the spool and exits. Then it flushes up to three
spooled envelopes and sweeps at most one stale session (§6.3). Every path ends in
`process.exit(0)`; errors go to `~/.agentcommons/hook.log` (rotated at 5 MB).

Why two processes: harnesses wait for hooks to finish before continuing, and Codex caps
`SessionEnd` hooks at 3 s. If the upload ran inside the hook, every tool call would pay
network latency, and an offline laptop would pay a timeout per tool call. With the
split, the agent pays ~50 ms per event no matter what the network is doing, and uploads
still happen within seconds. There is no inline-upload special case for any event; if a
detached uploader is ever killed (machine power-off), the cursor did not advance, the
next event or the sweep re-sends, and the server dedupes on `recordKey`.

### 6.3 Per-event behavior
The shim thinks in six canonical events; each harness maps onto them:

| canonical | Claude Code | Codex | Gemini CLI | pi (extension) |
|---|---|---|---|---|
| `start` | `SessionStart` | `SessionStart` | `SessionStart` | `session_start` |
| `prompt` | `UserPromptSubmit` | `UserPromptSubmit` | `BeforeAgent` | `input` |
| `tool` | `PostToolUse` | `PostToolUse` | `AfterTool` | `tool_result` |
| `turn_end` | `Stop` | `Stop` | `AfterAgent` | `agent_end` |
| `subagent_end` | `SubagentStop` | `SubagentStop` | to verify | none |
| `end` | `SessionEnd` | `SessionEnd` | `SessionEnd` | `session_shutdown` |

Stdin is the harness hook JSON (Appendix A), or for pi the equivalent JSON built by
the extension. Per-session state in
`~/.agentcommons/state/<harness>-<sessionId>.json`: `byteOffset`, `serverSessionId`,
`startHead`, `lastSyncAt`. A lock file `<same>.lock` (`open` with `wx`; stale after
60 s) makes concurrent firings for one session a no-op; Codex fires each event once
per hooks file it loaded, so duplicates are normal.

- **SessionStart**: skip if `cwd` matches `disabledPaths`. Collect device and git
  context (`git rev-parse --show-toplevel`, `--abbrev-ref HEAD`, `HEAD`,
  `git remote get-url origin`, `git rev-parse --git-common-dir` for worktrees; each
  with a 500 ms timeout). Read `AGENTCOMMONS_PARENT_SESSION_ID` and
  `AGENTCOMMONS_TAGS`. Send an envelope with zero lines and `hookSource`.
- **UserPromptSubmit / PostToolUse** (near-real-time path): if the transcript has
  grown and either ≥ `syncIntervalSeconds` (default 10) have passed since
  `lastSyncAt` or ≥ 64 KB are pending, spawn the detached uploader; otherwise exit
  immediately. A prompt submit always syncs (it is the moment a human said something
  new). This bounds the crash loss window to about ten seconds at a cost of one
  ~50 ms process per tool call, and an upload every ten seconds while the agent is
  busy. Both thresholds are in `config.json`; setting `syncIntervalSeconds` to 0
  syncs on every event, `realtime: false` disables these two hooks and falls back to
  turn boundaries.
- **Stop**: always sync (detached). Uploader reads `transcript_path` from
  `byteOffset` to EOF, drops a trailing partial line, sends ≤ 5 MB gzip batches,
  advances `byteOffset` on `202`. If the file is shorter than `byteOffset`
  (rotation), reset to 0; the server dedupes.
- **SubagentStop** (Claude): also sync `agent_transcript_path` as its own session
  with `parentHint {relation: SUBAGENT, agentId, agentType}`. (Codex: same handling
  when `transcript_path` differs from the parent's.)
- **SessionEnd** (`end`): hook mode computes the `end` block locally, commits since
  `startHead` (`git log --format=%H%x1f%s%x1f%aI startHead..HEAD`), `git diff
  --shortstat startHead`, `git status --porcelain | wc -l`, each with a 500 ms timeout,
  saves it to the state file, and starts the detached uploader like any other event.
- **Sweep** (every run, after the main work): flush ≤ 3 spool files; then for any
  other state file whose transcript grew since `lastSyncAt` and is > 10 min old,
  sync at most one of them (oldest first) with `hookEvent: "Sweep"`. This closes the
  gap left by crashed or killed sessions that never fired `SessionEnd`, without a
  daemon, while keeping every run inside its time budget.

### 6.4 Spool
On network failure or non-2xx, the gzipped envelope is written to
`~/.agentcommons/spool/<ts>-<rand>.json.gz`. Cap 500 MB, oldest dropped with a log
line. `byteOffset` advances only on success, so overlaps happen and are deduped.

### 6.5 Environment variables
`AGENTCOMMONS_SERVER`, `AGENTCOMMONS_API_KEY` (override config),
`AGENTCOMMONS_PARENT_SESSION_ID`, `AGENTCOMMONS_TAGS`, `AGENTCOMMONS_DISABLE=1`.

---

## 7. Search and query (the backbone)

Three operations over one index. `search` returns message windows with context,
`get` expands a session, `sql` handles counts, facets, and anything the filters do
not cover. There is no query grammar: filters are a fixed enum, free text uses
PostgreSQL's standard `websearch` semantics, and ingest decides what is searchable.
Search results carry `session_id` and `seq`, which are exactly the keys `get` and
`sql` take, so every result is a reference the agent can follow or join on.

### 7.0 End to end: from a keystroke to a search hit
1. **A developer types a prompt** in Claude Code. The harness appends a `user` record to
   `~/.claude/projects/<slug>/<session>.jsonl` and fires `UserPromptSubmit`.
2. **The hook runs** (`node hook.js claude`, ~50 ms). It reads the hook JSON from stdin,
   loads the session's state file, sees new bytes, and spawns a detached uploader.
3. **The uploader** tails the transcript from the last byte offset, drops a trailing
   partial line, gzips the new lines into an envelope with device and git context, and
   POSTs to `/api/v1/ingest` with the machine's API key. On failure it spools to disk.
4. **The server authenticates** the key (Better Auth), resolves the user, and starts one
   transaction. Every line is **redacted** in memory (secretlint + patterns), then
   parsed. Unknown types are kept as raw records only.
5. **Normalization**: the Claude Code normalizer turns the record into Messages: a `USER`
   `TEXT` message with `content`, `searchable=true`, `searchText=content`. Later records
   in the same session become `ASSISTANT TEXT`, `TOOL_USE` (`searchText` = tool name +
   first 1 KB of input), `TOOL_RESULT` (first 2 KB), `THINKING` (not searchable).
6. **Indexing happens in the database**: `searchTsv` is a generated column
   (`english` + `simple` weighted vectors over `searchText`), so it is populated on insert
   with no application code. `SessionFile`, `toolsUsed`, counters, and links update in the
   same transaction. If embeddings are on, a pg-boss job is enqueued to chunk and embed
   `searchText`.
7. **Ten seconds later a tool call fires `PostToolUse`**; the hook sees ≥10 s passed and
   syncs again. The session is visible in the dashboard with a live tail.
8. **A teammate's agent is asked** "has anyone worked on rate limiting here?" It calls
   `search({ query: "rate limiter", filters: { repo: "cunningham" } })`.
9. **The API validates** the input against the shared zod schema (unknown filter key →
   error listing valid keys), takes a connection from the caller's reader pool, and runs
   one statement: `WHERE` from the filters, `search_tsv @@ websearch_to_tsquery(...)` via
   the GIN index, `ts_rank_cd` scores, top 10 hits. Private and purged rows are excluded
   by the view definition before ranking.
10. **Windows**: for each hit, one message before and after by `(session_id, seq)`,
    skipping thinking; overlapping windows merge; tool text trimmed to 300 chars.
11. **The response** lists blocks with `session_id`, `seq`, roles, and text, formatted
    for reading, with the structured JSON alongside. An audit row records the key, IP,
    query, filters, and duration.
12. **The agent reads** the two blocks, sees Ana's prompt and the assistant's summary,
    and answers. If it needs more, `get(session_id, from, to)` with the same ids.

### 7.1 Ingest decides what is searchable
At append time each Message gets `text` (plain extraction), `searchable`,
`searchText`, and `searchTsv`; when embeddings are enabled it also gets chunks and
vectors, only if `searchable`.

| message | searchable | `searchText` |
|---|---|---|
| `USER` `TEXT` | yes | whole prompt |
| `ASSISTANT` `TEXT` | yes | whole reply |
| `SYSTEM` `TEXT` (compaction summary) | yes | whole summary |
| `TOOL_USE` | yes | tool name + first 1 KB of the input; file paths and commands are what people look for |
| `TOOL_RESULT` | yes | first 2 KB of the result |
| `THINKING`, `META`, images | no | stored in full, returned by `get(full)`, never ranked |

```sql
search_tsv = setweight(to_tsvector('english', search_text), w) ||
             setweight(to_tsvector('simple',  search_text), w)
-- w: A = USER, B = ASSISTANT and SYSTEM summary, C = TOOL_USE, D = TOOL_RESULT
```
Two configurations in one vector so stemmed words ("limiting" → "rate limiter") and
exact identifiers (`ECONNRESET`, `useAuthStore`) both match. Index size tracks the
conversation, not the size of files read. `pg_trgm` indexes on `sessions.title` and
`session_files.path` serve the dashboard's quick box and path lookups.

### 7.2 `search`: filters, ranking, windows
Input: `query` (text, may be empty when filters are given), `filters` (object,
fixed keys), `context` (messages each side, default 1, max 3), `limit` (hits,
default 10, max 50).

**Filters.** AND across fields; an array within a field is OR within it. Keys:
`repo`, `branch`, `user` (email or name, case-insensitive), `device`, `harness`,
`model`, `tool`, `tag`, `linear_key`, `file` (path prefix over `session_files`),
`role` (`USER` `ASSISTANT` `TOOL_RESULT` `SYSTEM`), `kind` (`TEXT` `TOOL_USE`
`TOOL_RESULT`), `session_id`, `since`, `until`, `has_commits`. Nothing else;
negation and anything more complex is `sql`. Unknown keys are a validation error
listing the valid ones.

**Pipeline.**
1. Filters become a `WHERE` on `messages` joined to `sessions` (and `session_files`
   for `file`). Visibility is applied by the reader role (§7.5).
2. Lexical: `websearch_to_tsquery('english', query) || websearch_to_tsquery('simple',
   query)` against `search_tsv`, scored with `ts_rank_cd(search_tsv, q, 1|32)` (length
   normalized, bounded to [0,1)). Standard PostgreSQL websearch: `"quoted phrase"`,
   `-excluded`, `a OR b`. That is Postgres's syntax, not ours.
3. Semantic (when embeddings are on): query vector against `MessageChunk`, top 200 by
   cosine.
4. Fusion: reciprocal rank fusion (k=60) over the lists → top `limit` hit messages.
   Lexical-only when embeddings are off. Empty `query` → newest matching messages.
5. Context: for each hit, the `context` neighbours before and after by
   `(session_id, seq)` among non-`THINKING`, non-`META` messages. Windows in the same
   session that overlap or touch are merged into one block; hits are marked.
6. Trimming: text messages to 1,500 chars, tool inputs and results to 300 chars,
   each with `truncated: true` when cut. Response capped at 256 KB by dropping the
   lowest-ranked blocks with `truncated_response: true`.

**Output.**
```jsonc
{ "blocks": [
    { "session_id": "0192a3f0-…", "title": "Add token-bucket rate limiter to API gateway",
      "repo": "cunningham", "branch": "feat/rate-limit", "user": "ana@example.com",
      "started_at": "2026-08-21T14:02:11Z", "score": 0.91,
      "messages": [
        { "seq": 1, "role": "USER", "kind": "TEXT", "text": "Implement a rate limiter…", "truncated": false, "hit": true },
        { "seq": 2, "role": "ASSISTANT", "kind": "TEXT", "text": "I'll look at how the gateway…", "truncated": false, "hit": false },
        { "seq": 3, "role": "ASSISTANT", "kind": "TOOL_USE", "tool_name": "Read", "text": "src/api/gateway.ts", "truncated": false, "hit": false } ] } ],
  "took_ms": 38 }
```
`session_id` is `sessions.id`; `(session_id, seq)` is `messages.(session_id, seq)`;
both feed `get(session_id, from, to)` and any `sql` join.

**Robustness, by failure mode.** Search is the backbone, so each way it could be
brittle has a specific answer:
- *Odd free text* (unbalanced quotes, stray operators, code snippets):
  `websearch_to_tsquery` never raises; it degrades to plain AND of terms.
- *Mistyped filter key*: rejected with the list of valid keys.
- *Filter value that matches nothing* (`repo: "cuningham"`): the response includes
  `suggestions` from `pg_trgm` similarity over the facet values (`repo: cunningham`), and
  the same for `tool`, `model`, `tag`, `branch`, `user`.
- *Zero hits*: the response says so and includes `hints`: the closest facet values, how
  many sessions match the filters alone, and a ready-to-run variant with the filters
  only (`query: ""`) so the agent can list recent sessions and browse.
- *Too many hits*: ranking puts prompts first; `limit` and `context` keep responses
  bounded; the agent can narrow with filters it can see in the schema.
- *Identifiers and paths*: `simple` lexemes match exact tokens; `file:` filters match path
  prefixes on `SessionFile`; `pg_trgm` covers substrings in the dashboard.
- *Very long sessions*: windows are by `seq`, so context is O(1) regardless of length.
- *Quality regressions*: a golden query suite (§16.1) asserts that known questions over
  the fixture corpus return known sessions in the top 3, and admins can mark results
  relevant or not from the dashboard to grow the suite.

### 7.3 `get`: expansion
Input: `session_id`, optional `from` and `to` (inclusive `seq` range), `full`
(default false).
- No range: header plus all messages, with tool inputs and results stubbed to one
  line (`[Read src/api/gateway.ts → 4.1 KB]`) and thinking omitted, unless `full`.
  Capped at 200 messages or 256 KB; `next_from` is returned to continue.
- Range: exactly those seqs, expanded (tool results in full up to the per-record cap,
  thinking included).
- Header: title, harness and version, user, device, repo, branch, cwd, model,
  started/ended, status, commits, diff stat, files with ops, parent (id, relation),
  children (id, relation, agent type), tags, message and tool counts.
This is the "show me more" path and is rarely called.

### 7.4 `sql`: the escape hatch
One read-only PostgreSQL `SELECT` over schema `api_ro`. For counts, facets, time
series, joins across files, commits, tools, and trees, and any filter the enum does
not offer.
- Views: `sessions` (every §4.2 column in snake_case plus `user_email`, `user_name`,
  `device_hostname`, `parent_title`, `child_count`, `commit_count`,
  `duration_seconds`, `file_count`), `messages` (§4.3 columns plus `session_title`,
  `repo_name`, `branch`, `user_email`, `session_started_at`, `search_tsv`),
  `session_files (session_id, path, ops)`, `session_commits (session_id, sha,
  subject, authored_at)`, `session_tools (session_id, tool_name, call_count)`,
  `session_tags (session_id, tag)`, `session_tree (ancestor_id, descendant_id,
  depth)`, `users (id, email, name)`, `devices`, `repos (repo_url, repo_name,
  session_count, last_session_at)`.
- Functions: `search_messages(q text, filters jsonb DEFAULT '{}', max_rows int
  DEFAULT 100)` → `(session_id, seq, rank, snippet)` is the ranking core the `search`
  tool uses, exposed so ranking composes with SQL (`filters` takes the same keys as
  §7.2). When embeddings are enabled, `similar_sessions(session_id, max_rows)` is
  additionally advertised (§11.5); when disabled it is hidden from `schema_functions`
  and the `sql` description.
- Self-description: `schema_columns (view_name, column_name, data_type, comment)`,
  `schema_functions (name, signature, comment)`, `query_examples (title,
  description, sql)`. Every view, column, and function carries `COMMENT ON` text.
- Every view applies the visibility rule (§7.5) using `current_user`.
- Vocabulary is consistent: the field names in `search` and `get` output are the
  `api_ro` column names, so a search result teaches the names to use in SQL, and the
  `session_id`/`seq` it returns join directly.
- Request `{ sql }`; response `{ columns: [{name, type}], rows, rowCount, truncated,
  durationMs, warnings }`. Text cells over 2 KB are cut with a marker; response ≤
  256 KB. Postgres errors return verbatim with position; `undefined_column` and
  `undefined_table` are enriched with the valid names from `schema_columns`. Missing
  `LIMIT` is added. psql shortcuts `\d`, `\d <view>`, `\df`, `\examples` are
  rewritten to selects on the schema views.

Example, counts by repo for a topic, joining a search reference:
```sql
SELECT s.repo_name, count(DISTINCT r.session_id) AS sessions
FROM search_messages('rate limiter', '{"since":"2026-06-01"}', 500) r
JOIN sessions s ON s.id = r.session_id
GROUP BY 1 ORDER BY 2 DESC;
```

### 7.5 Security, silently
The caller sends a query, a session id, or SQL, and nothing else. Everything below
happens without the caller's involvement or knowledge:
1. The API key is verified; the owner's role is known.
2. A connection is taken from one of two small pools by role: `ac_reader_user` or
   `ac_reader_admin`. Both roles have `USAGE` on `api_ro` only, `SELECT` on its
   views, `EXECUTE` on its functions, no privileges on `public`,
   `search_path = api_ro`, `default_transaction_read_only = on`,
   `statement_timeout = 5s`, `work_mem = 16MB`, `temp_file_limit = 64MB`.
3. Every view's `WHERE` ends with `AND ((visibility = 'PUBLIC' AND purged_at IS
   NULL) OR current_user = 'ac_reader_admin')`. `current_user` is the connected role
   and cannot be changed by SQL, so a user cannot see `PRIVATE` or purged rows through
   any view, function, join, or CTE, even if a guard bug let a statement through.
   Purge deletes content rows, so there is nothing to leak. No session variables
   carry authorization state.
4. For `sql`, `pgsql-ast-parser` checks the statement: exactly one; `SELECT` or
   `WITH … SELECT`; no `INTO`, `FOR UPDATE/SHARE`, `LOCK`, `COPY`, `SET`, `DO`,
   `CALL`; no reference to `pg_catalog`, `information_schema`, or any schema other
   than `api_ro`; none of `pg_sleep*`, `pg_read_*`, `pg_ls_*`, `lo_*`, `dblink*`,
   `set_config`, `pg_terminate_backend`, `pg_cancel_backend`, `pg_notify`, `txid_*`;
   ≤ 20 KB. The role and timeout are the real protection; the guard gives fast,
   readable rejections.
5. `sql` runs as `SELECT * FROM (<sql>) q LIMIT 500`. `search` and `get` run
   parameterized statements on the same pools.
6. Rate limits per key: `search`/`get` 300/min, `sql` 60/min. Audit rows carry the
   query, filters, or SQL text, guard result, row count, and duration.

**Alternatives considered.** A one-box query grammar with qualifiers (agents get the
syntax wrong, per GitHub's MCP issue tracker; the fixed-enum object cannot be
misspelled without a helpful error); SQL as the only tool (works, but the most common
question should not need a `FROM`); GraphQL and PostgREST (self-describing, but weak
on aggregates and ad-hoc joins, and another auth model or container).

### 7.6 REST endpoints
All under `/api/v1`, JSON, zod-validated, OpenAPI at `/api/docs`. Auth: API key with
the listed permission, or a dashboard cookie session. Users never see `PRIVATE` or
purged sessions. The three agent operations are the same three endpoints the
dashboard uses.

| method | path | permission | notes |
|---|---|---|---|
| POST | `/ingest` | `sessions:ingest` | §5 |
| POST | `/search` | `sessions:read` | body = `search` input (§7.2); adds `cursor` |
| GET | `/sessions/:id` | read | = `get` (§7.3); `?from=&to=&full=` |
| POST | `/query` | read | = `sql` (§7.4) |
| GET | `/schema` | read | JSON of `schema_columns`, `schema_functions`, `query_examples`, cached distinct values; for the dashboard |
| GET | `/sessions` | read | list with the §7.2 filters, no text; sort `started_at` or `last_activity_at` |
| GET | `/sessions/:id/raw` | read | paginated RawRecord payloads (fidelity export) |
| GET | `/sessions/:id/similar` | read | §11.5; only registered (and in OpenAPI) when embeddings are enabled |
| POST | `/sessions/:id/tags` | read | `{ add: [], remove: [] }` |
| GET | `/me` | any | user, role, key metadata; used by `hook.js doctor` |
| GET/POST/DELETE | `/me/keys` | any | own keys via Better Auth, wrapped for audit |
| GET | `/devices`, `/repos`, `/repos/:repo/branches` | read | |
| GET | `/health`, `/ready` | none | liveness; readiness checks DB |
| GET | `/install.sh`, `/hook.js`, `/hook.js.sha256`, `/skill.md` (root) | none | §6.1, §8.4 |
| GET | `/auth/config` (root) | none | enabled login methods for the login page |

Admin, under `/api/v1/admin`, role `admin` or key permission `admin:*`:

| method | path | notes |
|---|---|---|
| GET/POST/PATCH | `/users`, `/users/:id` | list, invite, set role, ban |
| GET/DELETE | `/keys`, `/keys/:id` | all keys, revoke any |
| POST | `/sessions/:id/visibility` | `{ visibility, reason }` |
| POST | `/sessions/:id/purge` | `{ reason }` §9.5 |
| GET | `/audit` | filters: user, key, ip, action, resource, from, to |
| GET/POST/DELETE | `/examples`, `/examples/:id` | curated `query_examples` |
| GET/POST/PATCH/DELETE | `/redaction/policies`, `/redaction/policies/:id` | §5.3 admin-managed redaction policies |
| POST | `/redaction/test` | `{ text, policyIds? }` → what would be redacted |
| POST | `/redaction/rescan` | `{ policyIds?, since?, reason }` → job id |
| GET | `/status` | ingest volume, redaction by rule, embedding backlog and spend, flags |

---

## 8. MCP endpoint: `search`, `get`, `sql`

### 8.1 Transport and auth
`POST /mcp` with `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport` in
stateless mode (`sessionIdGenerator: undefined`; one transport per request; `GET`
and `DELETE` answer 405). Fastify hands the raw request/response to the transport via
`reply.hijack()`. Auth is the bearer API key (`sessions:read`). Every call is an
AuditEvent (`mcp_tool_call` plus `search`, `read_session`, or `sql_query`).
Visibility is enforced by the database role (§7.5), never by the tool.

### 8.2 The tools, curated per caller
`tools/list` is computed per request from the caller's permissions and from cached
facets of the data, so two things are dynamic: **which** tools appear and **what
values** their fields advertise.

User tools (permission `sessions:read`), matching §7.2–7.4 one-to-one:

| tool | input | output |
|---|---|---|
| `search` | `query`, `filters?`, `context?` (default 1), `limit?` (default 10) | blocks of message windows with `session_id` and `seq` references |
| `get` | `session_id`, `from?`, `to?`, `full?` | header + messages; `next_from` when capped |
| `sql` | `sql` | columns and rows; description carries the schema |

Admin tools (only when the key carries `admin:*`; absent from `tools/list` otherwise;
each marked with MCP `annotations.destructiveHint` where it changes state):

| tool | input | does |
|---|---|---|
| `set_visibility` | `session_id`, `visibility`, `reason` | §9.5 private/public |
| `purge` | `session_id`, `reason` | §9.5 purge; `destructiveHint: true` |
| `audit` | `filters` (user, key, ip, action, resource, since, until), `limit` | reads AuditEvent |
| `status` | none | ingest volume, redaction hits, embedding backlog and spend, flags |

Embeddings-dependent additions, present only when `EMBEDDINGS_ENABLED=true` and
absent otherwise (§11.5): `search` gains `mode` (`hybrid` default, `lexical`,
`semantic`); a `similar` tool (`session_id`, `limit?`) returns sessions nearest to a
given one; the `sql` description lists `similar_sessions()`. Nothing about embeddings
is visible to an agent when the flag is off.

Tools are derived from routes (§3.1): a route with `config.mcp = { name, permission,
describe, format? }` becomes a tool whose input schema is the route's zod schemas and
whose handler is the route's service call. `apps/api/src/mcp/tools/` holds only the
custom `format` functions and `describe(ctx)` builders for `search`, `get`, and `sql`.
Adding a tool is adding one option to a route; the registry filters by permission and
feature flag at list time and rejects calls to tools the caller could not list. Every description opens with the two sentences that govern use:
*"Only use this when the user asks about previous sessions or prior work; do not call
it on your own initiative. Where possible, run the investigation in a subagent and have
it return only the relevant findings with session ids: results can be large, and
anything beyond a single lookup (more than 2–3 calls, or reading full sessions) belongs
in a subagent, not in the main context."*

### 8.3 Dynamic fields and discovery
- **Filter values from the data.** `schema(ctx)` for `search` fills field metadata
  from a facet cache refreshed every 5 minutes: `harness`, `role`, `kind` are strict
  enums; `repo`, `tool`, `model`, `tag` are strings with `examples` set to the current
  top 50 values and a description listing them, so the agent sees real values without
  a call and a brand-new repo still validates. `user` lists example emails only for
  admins.
- **`sql` description from the catalog.** Regenerated at server start from
  `information_schema` and `pg_proc` (view and column lists, function signatures with
  defaults) plus the embeddings flag, so it cannot drift. Run-time discovery through
  `schema_columns`, `schema_functions`, `query_examples`, psql shortcuts (`\d`,
  `\d sessions`, `\df`, `\examples`), and enriched unknown-column errors.
- **Consistency.** Field names are identical across the output of all tools and the
  `api_ro` columns, so each result teaches the next call.
- **Feature-gated surface.** The registry consults feature flags as well as
  permissions, so embeddings (§11) and any future optional capability add tools or
  fields only where they work. Stateless MCP has no `listChanged` notifications;
  clients re-list on connect, which is every request in stateless mode, so changes
  appear immediately.

### 8.4 Keeping investigations out of the main context
Nothing is built into the server for this. Three levers, all text:
1. **Tool descriptions** carry the delegation sentence above. Claude Code follows it
   reliably; Codex less so, but it is the same text.
2. **CLAUDE.md / AGENTS.md snippet**, printed by the install script:
   ```
   ## AgentCommons
   Past agent sessions for this organization are indexed in AgentCommons (MCP
   server `agentcommons`: search, get, sql). This session is recorded there
   automatically; you do not need to do anything. Only use it when the user asks
   about prior sessions or prior work. For anything beyond a quick lookup, run the
   investigation in a subagent and bring back only the findings and session ids.
   ```
3. **An installed skill.** The install script writes `agentcommons-investigate` to
   `~/.claude/skills/` and `~/.codex/skills/` (both directories exist on this
   workstation). The skill tells the harness how to run a delegated investigation:
   spawn a subagent with the question and the MCP tools, iterate `search` → `get`
   (ranges only) → `sql` for counts, and return ≤ 300 words of findings with
   `session_id`/`seq` references and nothing else. The server hosts it at
   `/skill.md` so it can be updated without a reinstall.

### 8.5 Client configuration
Written by the install script (§6.1); manually:
```
claude mcp add -s user -t http agentcommons https://agentcommons.example.com/mcp -H "Authorization: Bearer ac_…"
codex mcp add agentcommons --url https://agentcommons.example.com/mcp --bearer-token-env-var AGENTCOMMONS_API_KEY
```

### 8.6 Other channels, same capability
- `agentcommons search|get|sql …` subcommands in the installed `hook.js` (§6) call
  the same endpoints from a shell; `--json` for machines. No context tokens per turn.
- `MCP_COMPAT_SEARCH_FETCH=true` additionally exposes OpenAI-connector-shaped
  `search(query)` and `fetch(id)` wrappers (single string arguments) for ChatGPT and
  deep research. Off by default.

---

## 9. Auth, roles, audit, public exposure

### 9.1 Login, configured at deploy time
Better Auth with the Prisma adapter and plugins `admin()`, `apiKey()`, `openAPI()`,
and `genericOAuth()` when an OIDC provider is configured. No provider or domain is
hardcoded. The server refuses to boot if no login method is enabled. Config
(Appendix B): `AUTH_EMAIL_PASSWORD_ENABLED` (default true, with verification and
reset), `AUTH_SOCIAL_PROVIDERS` (Better Auth built-ins: `google`, `github`,
`microsoft`, `gitlab`, `okta`, … each with `AUTH_<PROVIDER>_CLIENT_ID/SECRET`),
`AUTH_OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET/SCOPES` for any generic OIDC IdP,
`AUTH_ALLOWED_EMAIL_DOMAINS` (optional; enforced in `user.create.before` for every
provider), `AUTH_SIGNUP_MODE` = `open` | `invite` (default) | `closed`,
`AUTH_BOOTSTRAP_ADMIN_EMAIL` (first matching account becomes admin; or
`pnpm db:seed --admin`), `EMAIL_TRANSPORT` = `smtp` | `ses` | `none` (with `none`,
invite and reset links are shown to the admin in the dashboard to hand over
out-of-band, and email verification is skipped). Accounts from several providers
link to one user by verified email. The login page renders whatever
`GET /auth/config` reports as enabled. ZeroPath's deployment: Google + allowed domain
`zeropath.com` + invite mode. A small team elsewhere: email/password only.

### 9.2 Authorization
Fastify `preHandler` `authenticate` accepts a Better Auth cookie session or an API
key (`Authorization: Bearer` or `x-api-key`, verified with `auth.api.verifyApiKey`)
and attaches `{ userId, role, apiKeyId?, permissions }`.
`requirePermission('sessions:ingest' | 'sessions:read' | 'admin')` per route. The
visibility filter lives in the repository layer and in the `api_ro` views, never in
handlers, so it cannot be forgotten.

### 9.3 Audit
**AuditEvent**: `id`, `ts`, `requestId`, `userId`, `apiKeyId`, `authMethod`
(`API_KEY`, `COOKIE`, `NONE`), `ip inet`, `userAgent`, `method`, `route`, `action`
(`ingest`, `search`, `sql_query`, `read_schema`, `read_session`, `read_messages`,
`read_raw`, `read_tree`, `list_sessions`, `tag`, `mcp_tool_call`, `key_create`,
`key_revoke`, `login`, `login_failed`, `admin_set_role`, `admin_set_visibility`,
`admin_purge`, `admin_read_audit`, `install_download`), `resourceType`,
`resourceIds text[]`, `statusCode`, `durationMs`, `detail jsonb` (query text, tool
name, filters; never bodies). Written from an `onResponse` hook for every
authenticated route and MCP call, including 401/403. IP from the first
`X-Forwarded-For` hop with `trustProxy` limited to the ALB CIDR. Indexes on
`ts`, `(userId, ts)`, `(apiKeyId, ts)`, `(ip, ts)`, `(action, ts)`, GIN
`resourceIds`. Append-only.

### 9.4 Public exposure hardening
`@fastify/helmet` headers, CORS limited to `PUBLIC_URL`, `@fastify/rate-limit`
(ingest 600/min per key, read 300/min, `/query` 60/min, MCP 120/min, auth routes
20/min per IP), Better Auth's built-in login throttling, secure cookies, CSRF origin
checks, request body limits, `install.sh`/`hook.js` served with immutable caching
and a sha256 file. Optional AWS WAF managed rule set on the ALB in prod. API keys
are prefixed `ac_` and show up in GitHub secret scanning patterns via a pattern file
in the repo.

### 9.5 Private and purge
- **Private**: `visibility=PRIVATE`; invisible to users everywhere (lists, search,
  SQL views, trees, MCP). Admins see it with a badge. Reversible. Tree endpoints
  elide private nodes for users and reparent their public children to the nearest
  visible ancestor.
- **Purge**: sets `purgedAt/purgedBy/purgeReason`; deletes RawRecord, Message,
  SessionFile, MessageChunk, SessionEmbedding, RedactionEvent rows; blanks `title`
  and `firstPrompt`; keeps the Session row, tree position, counters, IngestBatch,
  TagEvent, AuditEvent. The only path that deletes content; for leaked secrets and
  client requests.

---

## 10. Dashboard (`apps/dashboard`)

Quality bar: it should feel like a first-class product, not an admin panel. Concretely:
search results in under 150 ms for typical queries (tsvector GIN, facet cache, keyset
paging); every list virtualized; keyboard-first with a command palette (`cmdk`) for
search, jump-to-session, and filters; deep links to any message (`/s/<id>#42`) that
also select the seq in the transcript; live tail on `ACTIVE` sessions (SSE from the
API, 5 s fallback polling) since ingest is near-real-time; transcript viewer with
sticky turn headers, collapsible tool blocks, syntax-highlighted code and unified
diffs for `Edit`/`apply_patch` inputs (`shiki` + a diff renderer), redaction markers
highlighted, thinking behind a toggle; parent/child tree as an inline graph with
click-through; filter chips that mirror the `search` filter keys exactly; light and
dark themes; skeleton loading and honest empty states; admin tables on TanStack Table
with server-side sort and filter; charts on Recharts. Accessibility: focus rings,
ARIA on the transcript list, no color-only meaning.

**Copy.** All user-facing text (labels, empty states, errors, tooltips, onboarding,
the install page, emails) is plain, specific, and short, and is edited with the
vendored `no-ai-slop` skill (`.agents/skills/no-ai-slop/SKILL.md`) before merge: no
binary contrasts, throat-clearing, colon reveals, puffery, or fake-profound endings;
lead with the fact; concrete nouns over abstractions; active voice. Strings live in one
module per app (`apps/dashboard/src/copy.ts`) so they can be reviewed in one place, and
a CI check runs the skill's `eval.md` checklist over that module and over `README.md`
via an LLM pass on PRs that touch them. The same rule applies to README, docs, tool
descriptions, and error messages returned to agents.

Vite + React 19 + TypeScript, Tailwind, shadcn/ui, TanStack Router and Query,
Better Auth React client, `openapi-fetch` client generated from the API's OpenAPI
document, `react-virtuoso` for transcripts, `shiki` for code, `@uiw/react-codemirror`
for SQL. Built to static assets served by the API with SPA fallback; same origin so
cookies work with no CORS.

User pages: **Login** (methods from `/auth/config`); **Sessions** (search box plus
filter chips for the §7.2 filter keys, result blocks with context exactly as the
`search` tool returns them, and a list view with title, repo/branch, user, device,
duration, tokens, tool chips, Linear keys); **Session detail** (tabs
Transcript / Tools / Files / Git / Tree / Raw; thinking and tool results collapsed
by default; redaction markers highlighted; "Similar sessions" panel when embeddings
are on); **Search results** (message windows, jump-to-seq in the transcript); **Query** (SQL editor,
schema sidebar from `/schema`, results grid, CSV export, shareable link, and for
admins "Save as example", which publishes to `query_examples`); **My
keys** (create with plaintext shown once, permissions, expiry, last used, revoke,
copy-paste install command with the key inlined); **Devices**.

Admin pages (role-guarded, hidden for users): **Users** (roles, ban, invites with
copyable links when `EMAIL_TRANSPORT=none`); **Keys** (all); **Audit log** (filters
by user, key, IP, action, resource, time; CSV export); **Moderation** (private and
purged lists; visibility toggle and purge with reason from session detail);
**Redaction** (policy list with hit counts, add regex or secretlint rule, test against
sample text, enable/disable built-ins, rescan with progress);
**Status** (ingest per day, sessions per user/repo, redaction hits by rule,
embedding backlog and spend, feature flags, install command).

---

## 11. Embeddings and semantic search (implemented, disabled by default)

Ships in v1 behind `EMBEDDINGS_ENABLED=false`. Off: nothing is embedded, no
provider is called, no cost, all search is lexical. On: a catch-up pass over existing
content starts, new ingest is embedded as it arrives, and every search path becomes
hybrid with no client or schema change.

### 11.1 What it is like
Off, search is lexical: exact words and stems, identifiers, paths, error strings. On,
conceptual queries work: "sessions where someone debugged flaky CI on the deploy
pipeline" finds sessions that never used those words, and exact identifiers still
win when present because lexical and semantic ranks are fused rather than replaced.
Session detail gets "Similar sessions". The `search` tool ranks hybrid by default
and gains a `mode` field; a `similar` tool and the `similar_sessions()` SQL function
appear. With the flag off none of that exists, is listed, or is documented to agents.

### 11.2 What gets embedded
- Message chunks over `searchText` of `searchable` messages only (§7.1): whole
  prompts and replies, the first 1 KB of tool inputs, the first 2 KB of tool results.
  Split at ~512 tokens with 64 overlap (`js-tiktoken` cl100k). Nothing that is not
  searchable is ever embedded.
- One session document per session: title, first prompt, last assistant text, repo,
  branch, files touched, commit subjects, tags. Re-embedded at session end and every
  50 new messages, keyed by content hash.
- Private sessions are embedded (admins search them); visibility applies at query
  time. Purge deletes chunks and the session vector. Everything embedded is already
  redacted because it is read from stored rows.

### 11.3 Storage
`MessageChunk(id, messageId, sessionId, ordinal, text, tokenCount, embedding
vector(D), model, createdAt)` unique on `(messageId, ordinal, model)`;
`SessionEmbedding(sessionId, embedding vector(D), model, contentHash, updatedAt)`.
`D` is fixed per deployment by `EMBEDDINGS_DIMENSIONS` (default 1024). Providers with
Matryoshka support (OpenAI text-embedding-3, Voyage, Titan v2) are asked for `D`
directly; Ollama models must match. HNSW `vector_cosine_ops` (m=16,
ef_construction=64) on both; one active model per deployment. Changing model or `D`
requires `pnpm embeddings:reindex`, which truncates and re-enqueues; the CLI prints
the estimated token count and cost first.

### 11.4 Pipeline
pg-boss queue in Postgres. Jobs: `embed.messages` (per ingest batch: chunk new
messages, embed, insert), `embed.session` (session document), `embed.catchup`
(enqueued at boot when the flag is on and unembedded content exists; walks sessions
oldest-first in batches of 200 chunks). Worker runs in-process (`WORKER_MODE=inline`,
default) or as a second ECS service (`WORKER_MODE=separate`) if volume demands.
Provider interface `embed(texts: string[], dims: number): Promise<number[][]>` with
adapters `openai` (`text-embedding-3-small` default), `voyage` (`voyage-code-3`),
`bedrock` (`amazon.titan-embed-text-v2:0`, natural on AWS), `ollama`, and `fake`
(deterministic, for tests). Cost controls: `EMBEDDINGS_DAILY_TOKEN_BUDGET` (default
5 M tokens ≈ $0.10 on text-embedding-3-small; excess defers to the next UTC day and
the Status page shows the backlog), `EMBEDDINGS_MAX_CHUNKS_PER_SESSION` (2000).
Retries with backoff, dead-letter after 5, counts on the Status page.

### 11.5 What is exported when enabled, and only then
The tool registry (§8.2) and the OpenAPI document are built from the same feature
flag, so the surface is exactly:

| enabled | disabled |
|---|---|
| `search` has `mode: hybrid \| lexical \| semantic` (default `hybrid`) | `search` has no `mode` field; lexical only |
| `similar` tool: `session_id`, `limit?` → nearest sessions by stored vector | no such tool |
| `sql` description and `schema_functions` list `similar_sessions(session_id, max_rows)` | function exists but is not advertised; returns zero rows with a NOTICE |
| `GET /sessions/:id/similar`; dashboard "Similar sessions" panel | route not registered; panel absent |

How it works: the API embeds the query text once per request (cached 10 min by text
hash) and passes the vector to `search_messages(q, filters, max_rows, query_embedding)`,
which fuses the lexical and cosine rank lists with RRF (k=60); with no vector the
function is purely lexical. `similar_sessions` ranks by cosine distance from the stored
session vector and needs no query embedding, so it works from `sql` unchanged.
Visibility applies through the views as everywhere else.

### 11.6 Enabling
Set `EMBEDDINGS_ENABLED=true`, `EMBEDDINGS_PROVIDER`, `EMBEDDINGS_MODEL`,
`EMBEDDINGS_DIMENSIONS`, provider credentials in Secrets Manager (or an IAM role for
Bedrock); deploy. The server enqueues the catch-up; Status shows progress and spend.
`pnpm embeddings:estimate` prints token count and cost before enabling.

---

## 12. Edge cases and decisions

- **Hooks fire twice.** Codex loads both `~/.codex/hooks.json` and
  `<repo>/.codex/hooks.json` and runs both; Claude Code can have user and project
  hooks too. Per-session lock file + server-side dedupe on `recordKey` make this
  harmless. Verified live.
- **Stop fires while subagents are still running.** Claude's `Stop` payload lists
  `background_tasks`; the parent sync proceeds, subagent transcripts arrive on their
  own `SubagentStop`. No coordination needed.
- **Subagent rows are not in the parent transcript.** Verified. Subagents are
  separate Sessions with `SUBAGENT` links; the `get` header lists parent and children.
- **Sessions that never end.** Crash, kill, laptop lid. Because every prompt and tool
  call triggers a throttled sync, at most ~10 s of transcript is unsynced at any
  moment, and it is still on disk: the sweep (§6.3) ships it on the next hook run of
  any session. The server marks `STALE` after 6 h idle; `SessionEnd` `reason` is
  recorded when it does arrive. Only losing the disk itself loses data, and then at
  most the last ~10 s.
- **Hook overhead.** Six hook events per harness, one Node start-up (~50 ms) each,
  network work always in a detached child, one code path for all events and all
  harnesses. Measured against the alternative of PostToolUse doing the upload inline,
  this keeps tool-call latency flat. Ingest rate limit (600/min per key) comfortably
  exceeds one upload per 10 s per session.
- **Codex clamps `SessionEnd` hooks to 3 s.** Irrelevant to correctness: hook mode
  finishes in ~150 ms even on `end` (git commands are local and time-boxed), and the
  upload runs in a detached process the clamp cannot reach.
- **No PATH in hooks.** Hooks run with a minimal environment (fish users lose
  `node`). The install script records the absolute node path into the hook command.
- **Gemini rewrites its transcript.** The chat file is a whole JSON document rewritten
  on every change, not an append log, so byte offsets are meaningless. The
  `json-document` reader parses the file and emits messages past the last synced
  index; if the file is mid-write and does not parse, the run exits and the next event
  retries. Tool outputs Gemini spills to `tool-outputs/` are inlined by the reader.
- **pi sessions branch in place.** One file can hold several branches (`/tree`,
  `/fork` into a new file with `parentSession`). All entries are stored with their
  `parentId`; the transcript view follows the active leaf and shows branch summaries
  as system messages. Forks link to the parent session by file name.
- **Resume after days.** Same harness id, same Session; status returns to `ACTIVE`, a
  `META` message marks the resume, `endedAt` clears until the next `SessionEnd`.
  Claude `/clear` ends the old session (`reason=clear`) and starts a new id.
- **Compaction.** Claude writes a `summary` record and continues in the same file;
  stored as `SYSTEM` text, indexed at weight B so the summary is searchable.
- **Detached HEAD / not a repo / worktrees.** `branch` null with `startCommit` set;
  `repoUrl` null outside repos; worktrees resolve `repoRoot` via
  `--git-common-dir` so sessions in worktrees group under the same repo.
- **Monorepo subdirectories.** `repoRoot` + `cwdRelative` are both stored and
  filterable; files are repo-relative.
- **Transcript file rewritten or shorter than the offset.** Reset to 0, resync,
  dedupe. Trailing partial lines are held until the next run.
- **Two people's keys ingest the same session** (shared machine). Second key gets
  `409` and an audit row; admins can override.
- **Clock skew.** Record timestamps come from the client; `IngestBatch.receivedAt`
  is server time; ordering within a session is `(timestamp, seq)` so skew cannot
  interleave incorrectly across batches.
- **Codex base instructions and developer messages** are tens of KB of boilerplate
  per session. Stored once in raw, `META` in messages, `searchable=false`, so they
  cannot pollute search.
- **Images in transcripts** are replaced with a placeholder; never stored.
- **Secrets that survive redaction.** Admin purge exists for this; the redaction
  rule set is config-extensible without a deploy (`REDACTION_EXTRA_PATTERNS`).
- **Sensitive repos.** `disabledPaths` in the client config skips them entirely;
  admins can additionally mark sessions private after the fact.
- **Non-UTF-8 or malformed lines.** Stored as RawRecord with `recordType=malformed`
  and the raw text as a string; no Message; counted in IngestBatch.
- **Very large sessions** (days, tens of thousands of tool calls). Everything is
  paginated; `get` caps at 200 messages and returns `next_from`; nothing loads a whole
  session into memory server-side.
- **What we do not capture.** Anything the harness does not write to disk (Codex
  encrypted reasoning, model system prompts in Claude Code), and images.

---

## 13. Infrastructure (`infra/`, Pulumi TypeScript, AWS)

Stacks `dev` and `prod`; region and hostname are stack config. Built with
`@pulumi/awsx` so the VPC, Fargate service, and ALB are a few dozen lines.
- **Network**: `awsx.ec2.Vpc` with 2 AZs; one NAT in dev, two in prod (or
  `--public-subnets` mode to skip NAT and save ~$33/month).
- **Registry/compute**: ECR; `awsx.ecs.FargateService` behind
  `awsx.lb.ApplicationLoadBalancer`; 1 task 0.5 vCPU/1 GB in dev, 2 × 1 vCPU/2 GB in
  prod; circuit-breaker rollback; health check `/ready`; ALB idle timeout 120 s for
  MCP streams.
- **Migrations**: one-off ECS task running `prisma migrate deploy` before the service
  update; deploy fails if it fails.
- **TLS/DNS**: ACM certificate for the configured hostname; Route53 record if a
  zone id is configured, else the stack outputs the ALB DNS name for a CNAME.
- **Database**: RDS PostgreSQL 16, `db.t4g.micro` dev / `db.t4g.small` prod, gp3
  20→200 GB autoscaling, encrypted, 7/35-day backups, deletion protection in prod,
  `vector` and `pg_trgm` created by the first migration. Reader roles
  `ac_reader_user` and `ac_reader_admin` created by migration with the grants in §7.5.
- **Secrets**: Secrets Manager for `DATABASE_URL`, `DATABASE_READER_USER_URL`,
  `DATABASE_READER_ADMIN_URL`,
  `BETTER_AUTH_SECRET`, IdP client secrets, SMTP, embedding provider keys; injected
  as ECS secrets. Bedrock via task-role IAM if selected.
- **Observability**: CloudWatch logs (pino JSON), alarms on 5xx rate, unhealthy
  targets, RDS storage < 15 %, CPU > 80 %.
- **CI/CD**: GitHub Actions with OIDC to AWS. PR → `pulumi preview` comment. `main`
  → build, push, migrate, `pulumi up dev`. Tag `v*` → `prod` behind a manual
  approval environment.
- Rough monthly cost, dev: Fargate ≈ $15, RDS ≈ $13, NAT ≈ $33, ALB ≈ $18.

---

## 14. Local development
`docker compose up -d` (pgvector/pgvector:pg16). `pnpm install && pnpm db:migrate &&
pnpm db:seed --admin you@example.com` (email/password enabled,
`EMAIL_TRANSPORT=none`, so no IdP is needed locally). `pnpm dev` runs API (3000) and
dashboard (5173, proxying `/api`, `/auth`, `/mcp`). `pnpm hook:link` installs the
local shim pointing at `http://localhost:3000` with a seeded dev key so real sessions
on this machine flow into the local DB.

---

## 15. Tooling and quality gates
TypeScript 5 strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`; `tsc -b` in CI. ESLint 9 flat config: typescript-eslint
`strict-type-checked` + `stylistic-type-checked`, `import-x`, `unicorn` (subset),
`react-hooks` in dashboard; no `any`, no non-null assertions. Prettier. Zod at every
boundary (HTTP, hook stdin, env, transcript records with `passthrough`). `prisma
validate` and `migrate diff` in CI. knip for dead code. Dependabot weekly. The OpenAPI
document is committed and diffed in CI so the dashboard client cannot drift.

Git hooks (Husky, installed by `pnpm install` via `prepare`; the same commands run in CI
so hooks are a fast path, not the gate):
- `pre-commit`: lint-staged runs `eslint --fix` and `prettier --write` on staged files,
  `prisma format` on the schema, and the redactor over staged fixtures.
- `pre-push`: `pnpm typecheck` (`tsc -b`), `pnpm test` (unit), `pnpm openapi:check`
  (regenerates the OpenAPI document and fails if it differs from the committed one).
- `commit-msg`: commitlint with Conventional Commits, which drives the changelog.
- `pre-commit` also flags staged changes to `README.md`, `docs/**`, or
  `apps/dashboard/src/copy.ts` with a reminder to run `/no-ai-slop` on the diff; CI
  runs the skill's checklist over those files on the PR (§10, Copy).

---

## 16. Testing

### 16.1 Verification requirements (non-negotiable)
"Done" for this project means the whole system has been stood up and exercised with
the real harnesses, not that unit tests pass. Concretely:

1. **Full-stack bring-up in CI.** A job builds the container, starts it with Postgres
   via compose, runs migrations, seeds an admin and keys, and runs every integration and
   e2e suite against that live stack, not against mocks.
2. **Live harness verification, all four harnesses.** A job (nightly, and on demand
   for every phase sign-off) installs the shim on a runner with Claude Code, Codex,
   Gemini CLI, and pi installed, points it at the live stack via `install.sh --server
   … --key …`, then runs a scripted session in each: `claude -p` with a tool call and
   a subagent; `codex exec` (with `--dangerously-bypass-hook-trust`, stdin redirected);
   `gemini -p --approval-mode yolo` with `GEMINI_API_KEY` set (individual OAuth is
   retired for headless use, verified); `pi -p` with a provider key and the extension
   installed. For each it asserts within 30 s: session row, user prompt message, tool
   call and result messages, subagent session linked as `SUBAGENT`, git end state,
   `search` finds the prompt text, `get` returns the header with commits, the MCP
   client lists the tools and `search`/`get`/`sql` all succeed with the same key. Any
   difference between captured hook payloads and Appendix A fails the job and prints
   the diff, so harness upgrades are caught. A harness is not "supported" in the README
   until this job is green for it.
3. **Feature-flag matrix.** The entire integration and e2e suite runs twice:
   `EMBEDDINGS_ENABLED=false` and `EMBEDDINGS_ENABLED=true` with the `fake` provider.
   The matrix also toggles `MCP_COMPAT_SEARCH_FETCH` and `AUTH_EMAIL_PASSWORD_ENABLED`
   with a social provider stub, so every gated surface is tested present and absent.
4. **Every route and every tool, dynamically enumerated.** A test reads the OpenAPI
   document at run time and fails if any operation lacks at least one recorded test hit
   (routes are tagged by the test client). A sibling test calls `tools/list` as a user
   key and as an admin key and fails if any listed tool lacks a recorded call. New
   routes and tools cannot ship untested by construction.
5. **Search quality suite.** `fixtures/search-golden.yaml` holds question → expected
   session pairs over the fixture corpus (30 to start); the top-3 hit rate must not
   drop. Admin relevance marks from the dashboard export into this file.
6. **Install script on clean machines.** Docker images for Debian and macOS-like
   (Node 20, bash, zsh, fish) run `install.sh` against the live stack and assert both
   harness configs, MCP registrations, skill files, rc line, idempotent re-run, and
   `--uninstall`.
7. **Browser verification of the dashboard.** Playwright drives the built dashboard
   against the live stack, for every route, in light and dark themes, at desktop (1440)
   and mobile (390) widths:
   - screenshot baselines with visual diff (`toHaveScreenshot`, small threshold) so
     rendering regressions are caught;
   - `@axe-core/playwright` on every page with zero serious or critical violations;
   - any console error, unhandled rejection, or failed network request fails the test;
   - layout assertions: no horizontal overflow, no clipped or overlapping text in
     transcript rows, every empty state has copy and an action, every table has
     server-side sort where the spec says so;
   - an **agent-driven usability pass**: an LLM agent with browser control (Claude Code
     with a browser skill, or the Playwright MCP server) walks the core flows as a new
     user (sign in, create a key, copy the install command, search, open a session, use
     the tree, run a query, admin pages), and writes a findings report (friction,
     confusing labels, rendering glitches, dead ends) attached to the CI run. Findings it
     tags `blocking` fail the job; the rest open issues. The pass runs nightly and on
     dashboard PRs.
8. **Phase sign-off** requires 1–4 green (and 7 for dashboard phases) plus a recorded
   dogfooding session on this workstation with real Claude Code and Codex, visible in
   the dashboard, searchable by an agent.

### 16.2 Suites
Vitest everywhere; DB tests on `@testcontainers/postgresql` with the pgvector image
and a fresh schema per file. Coverage gate 85 % lines on `core` and `api`.

**Unit** (`core`, `hook`): redaction rule positives/negatives, JSON-validity after
redaction, sensitive-file rule, 1 MB line performance; normalizers as snapshot tests
over `fixtures/transcripts/` (Claude main + subagent, Codex user thread + `thread_spawn`
child + resumed rollout); link detection incl. pending resolution and cycles;
metadata extraction (repo URL forms, Linear keys, files, tools, truncation);
searchable decision and `searchText` per message type; redaction policy composition
(DB rows + builtins → secretlint config), disable-builtin, test endpoint, rescan job
rewriting content and recording events; shim: stdin parsing from
`fixtures/hooks/*` for every harness, byte-offset tailing with partial lines, the `json-document` reader against a rewritten Gemini file,
batching/gzip, spool write/flush, lock file, sweep, throttle decisions (interval,
64 KB, prompt always, `realtime:false`), detached uploader hand-off, exit-0 on every
thrown error,
`disabledPaths`, env precedence, 2.5 s budget (fake timers), git context in a temp
repo incl. worktree and detached HEAD.

**Integration** (`api`, real Postgres): ingest idempotency and overlap, cross-user
409, transaction rollback, counters, tags; resume/clear/compact handling; `search`
(every filter key incl. arrays as OR and AND across keys, unknown key error, empty
query with filters, ranking: prompt beats tool result, websearch phrase/negation/OR,
context windows 0–3 skipping thinking, window merge on overlap, trimming flags,
256 KB cap); `get` (header, stubbing, `full`, ranges, 200-message cap and
`next_from`); error enrichment on unknown column/table; `query_examples` seeded and
admin-saved; `api_ro` contract snapshot (columns, types,
comments) so breaking changes fail CI; `search_*` functions; closure table across
link/relink/purge; SQL sandbox (accepts SELECT/CTE; rejects multi-statement, DML,
DDL, `INTO`, `FOR UPDATE`, catalog access, each denylisted function, > 20 KB;
`LIMIT 500`; timeout on a cross join; the user pool cannot see PRIVATE/purged via
any view while the admin pool can; neither reader role can read `public` or change
role; an injection corpus incl. `SET`, `set_config`, `SET ROLE`); schema
discovery (`schema_columns`, `/schema`, the generated `sql` description) reflects a
test migration's new column and comment; auth matrix (cookie
vs key, permissions per route, expired/revoked keys, allowed domains, signup modes,
invite flow, provider config validation, boot refuses with no login method); audit
row per request with correct IP, incl. MCP and failures; embeddings with the `fake`
provider (flag off → no jobs, no `mode` field, no `similar` tool, no `/similar`
route, `similar_sessions` hidden from `schema_functions`; flag on → all present,
catch-up drains, chunking, hybrid ranking, `similar_sessions`, budget deferral, purge
removes vectors).

**E2E**: API in-process against a container; the built `hook.js` executed as a child
process with the captured hook stdin fixtures pointing at fixture transcripts in a
temp HOME; asserts sessions, messages, subagent links, git end state, spool-and-retry
with the server down then up, sweep of a stale session, lock contention. Install
script run in a Docker container (Debian + Node 20, fish and zsh) against a live
local API: asserts Claude settings merge, Codex hooks.json, MCP entries, rc line,
idempotent re-run, `--uninstall`. MCP client from the SDK connects with a bearer key,
lists exactly three tools for a user key and seven for an admin key, asserts a user
calling `purge` gets a permission error and an audit row, asserts `search` filter
`examples` reflect seeded repos and tools, runs `search` with filters and context,
`get` with and without a range, `sql` with an aggregate, a closure-table join,
`\d sessions`, and an unknown-column query (asserts enriched error), verifies that
`session_id`/`seq` from `search` resolve in `get` and `sql`, verifies audit rows and
visibility; with
`MCP_COMPAT_SEARCH_FETCH=true` asserts the two extra tools match the OpenAI shape.
Install script test also asserts the skill file lands in both skills directories. Playwright smoke on the dashboard: login
(email/password), search with filter chips, open session, tree tab, Query page, create
key, admin visibility toggle, audit page.

**Fixtures policy**: `fixtures/hooks/` are the live captures from Appendix A.
`fixtures/transcripts/` are real transcripts run through the redactor and reviewed.
A CI job re-runs the redactor over `fixtures/` and fails on any new hit.

---

## 17. Build plan
1. **Scaffold**: monorepo, tooling, docker compose, Prisma schema + hand-written SQL
   (extensions, tsvector columns, closure table, `api_ro`, reader role), CI, Pulumi
   skeleton with `preview` in CI, fixtures sanitized and committed.
2. **Core**: envelope and record schemas, redaction with policy composition, all four
   normalizers with fixtures, link detection, metadata extraction, searchable decision.
   Live-capture the remaining payloads: Codex `SubagentStart/Stop` (with
   `multi_agent`), Gemini tool and agent events (with an API key), pi extension events;
   record them in Appendix A.
3. **API**: Better Auth with configurable providers and seed, authenticate and
   permissions, ingest with the searchable decision, audit, `/search` (filters,
   ranking, windows), `/sessions/:id` (`get`), `/query` (`sql`), `/schema`, admin
   endpoints, OpenAPI + generated client, `install.sh`/`hook.js`/`skill.md` hosting.
4. **Hook shim + install script**: readers (`jsonl-append`, `json-document`),
   batch/spool/lock/sweep, throttled near-real-time sync with detached uploader, four
   harness mappings, the pi extension package, install/doctor/uninstall. E2E. Dogfood on
   this workstation.
5. **MCP endpoint**: tool registry with per-permission listing; `search`, `get`,
   `sql` and the four admin tools; facet cache for dynamic field examples; boot-time
   `sql` description; psql shortcuts; text + structured output; compat wrappers behind
   the flag; CLI subcommands; skill file and guidance snippet. E2E.
6. **Dashboard**: user pages, admin pages, Query page. Playwright.
7. **Embeddings**: chunker, adapters, pg-boss jobs, `api_ro` semantic functions,
   hybrid fusion, Status page, estimate/reindex CLIs. Tests with `fake`. Ships off.
8. **Deploy**: `dev` stack, IdP config, DNS, bootstrap admin, install on each
   machine; then `prod`.

Each phase merges behind green CI and the §16.1 verification requirements that apply
to it; the API is usable with curl after phase 3. Phases 4, 5, and 8 additionally
require the live harness job (§16.1 item 2) green.

---

## 18. Deferred
- LLM session summaries (title, goal, outcome, decisions) with cost review first.
- PII redaction if customer data starts appearing.
- Audit and raw-record retention policies.
- Teams/orgs via Better Auth Organization plugin if a second tenant appears.
- SessionStart `additionalContext` hint: "N similar sessions exist" once embeddings
  or summaries are on.
- Windows shim.

## 19. Open questions
- Production hostname, AWS account, and Route53 zone for the first deployment.
- Who owns the Google OAuth client for ZeroPath's deployment.
- Whether service/CI sessions should belong to a dedicated service user per
  pipeline (default: yes, one key per service, named accordingly).

---

## Appendix A. Verified hook contracts (captured 2026-09-07)

Both harnesses use the same config shape and the same stdin contract, which is what
makes the shim tiny.

**Config shape** (Claude `~/.claude/settings.json`; Codex `~/.codex/hooks.json` and
`<repo>/.codex/hooks.json`, feature `hooks` stable and on by default):
```json
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "/usr/bin/node /home/u/.agentcommons/hook.js claude", "timeout": 10 } ] } ] } }
```

**Claude Code 2.1.263** (`fixtures/hooks/claude-code-2.1.263-hook-events.jsonl`)

| event | fields |
|---|---|
| `SessionStart` | `session_id, transcript_path, cwd, hook_event_name, source` (`startup`, `resume`, `clear`, `compact`) |
| `UserPromptSubmit` | `+ prompt, prompt_id, permission_mode` |
| `PreToolUse` / `PostToolUse` | `+ tool_name, tool_input, tool_use_id, prompt_id, permission_mode`; Post adds `tool_response, duration_ms`; inside a subagent adds `agent_id, agent_type` |
| `Stop` | `+ prompt_id, permission_mode, stop_hook_active, last_assistant_message, background_tasks[], session_crons[]` |
| `SubagentStart` | `+ prompt_id, agent_id, agent_type` |
| `SubagentStop` | `+ agent_id, agent_type, agent_transcript_path, stop_hook_active, last_assistant_message, background_tasks, permission_mode` |
| `SessionEnd` | `+ prompt_id, reason` |

Also fires in `-p`/SDK mode, so CI and scripted sessions are captured. Env exposes
`CLAUDE_PROJECT_DIR`. Subagent transcript path:
`~/.claude/projects/<slug>/<sessionId>/subagents/agent-<agentId>.jsonl`.

**Codex 0.150.0** (`fixtures/hooks/codex-0.150.0-hook-events.jsonl`)

| event | fields |
|---|---|
| `SessionStart` | `session_id, transcript_path, cwd, hook_event_name, model, permission_mode, source` |
| `UserPromptSubmit` | `+ prompt, turn_id` |
| `PreToolUse` / `PostToolUse` | `+ tool_name, tool_input, tool_use_id, turn_id`; Post adds `tool_response` |
| `Stop` | `+ turn_id, stop_hook_active, last_assistant_message` |
| `SessionEnd` | `session_id, transcript_path, cwd, hook_event_name, reason` |
| `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, `PermissionRequest`, `Interrupt` | present in the binary; payloads to be captured in Phase 2 |

Observed behaviors: hooks do not run without persisted trust (or
`--dangerously-bypass-hook-trust`); `SessionEnd` and `Interrupt` timeouts are clamped
to 3 s; `codex exec` reads stdin unless redirected; `CODEX_HOME` relocates the config
directory. Transcript path:
`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<session_id>.jsonl`.

**Gemini CLI 0.35.3** (`fixtures/hooks/gemini-cli-0.35.3-hook-events.jsonl`; captured:
`SessionStart`, `SessionEnd`; the run then failed on auth, so tool and agent events
below are from the reference docs and are captured in Phase 2)

| event | fields |
|---|---|
| all | `session_id, transcript_path, cwd, hook_event_name, timestamp` |
| `SessionStart` | `+ source` (`startup`, `resume`, `clear`) — captured |
| `SessionEnd` | `+ reason` (`exit`, `clear`, `logout`, `prompt_input_exit`, `other`) — captured |
| `BeforeAgent` / `AfterAgent` | `+ prompt`; After adds `prompt_response, stop_hook_active` |
| `BeforeTool` / `AfterTool` | `+ tool_name, tool_input, mcp_context, original_request_name`; After adds `tool_response` |
| `BeforeModel`, `AfterModel`, `BeforeToolSelection`, `PreCompress`, `Notification` | not used |

Config: `settings.json` `hooks` (user `~/.gemini/settings.json` or project
`.gemini/settings.json`; project hooks print a trust warning), same
`{ matcher, hooks: [{ type: "command", command, name, timeout }] }` shape; `timeout` is
in milliseconds. `gemini hooks migrate` converts Claude Code hooks. Transcript:
`~/.gemini/tmp/<project>/chats/session-<timestamp>-<id8>.json`, a JSON document
rewritten on every change (§5.4). Headless runs need `GEMINI_API_KEY` or Vertex; the
individual Code Assist login is rejected by this client version.

**pi 0.73** (from `docs/extensions.md` and `docs/session-format.md`; captured in Phase 2)

| extension event | payload used |
|---|---|
| `session_start` | `reason` (`startup`, `reload`, `new`, `resume`, `fork`), `previousSessionFile` |
| `input` | `text`, `source` |
| `tool_result` | `toolName`, `toolCallId`, `isError` |
| `agent_end` | `messages` |
| `session_shutdown` | `reason`, `targetSessionFile` |
| context | `ctx.sessionManager.getSessionFile()`, `getSessionId()`, `getLeafId()` |

Extensions load from `~/.pi/agent/extensions/*.ts`, `.pi/extensions/`, or
`settings.json` `packages` (`npm:` or `git:` sources). Handlers are async and do not
block the agent; ours spawns `hook.js pi` detached. Transcript:
`~/.pi/agent/sessions/--<cwd-encoded>--/<timestamp>_<uuid>.jsonl`, append-only tree
JSONL (§5.4).

## Appendix B. Configuration reference

| variable | default | purpose |
|---|---|---|
| `PUBLIC_URL` | required | canonical https origin; CORS, cookies, callbacks, install script |
| `DATABASE_URL`, `DATABASE_READER_USER_URL`, `DATABASE_READER_ADMIN_URL` | required | app role and the two reader roles (§7.5) |
| `BETTER_AUTH_SECRET` | required | |
| `AUTH_EMAIL_PASSWORD_ENABLED` | `true` | |
| `AUTH_SOCIAL_PROVIDERS` | empty | e.g. `google,github`; plus `AUTH_<PROVIDER>_CLIENT_ID/SECRET` |
| `AUTH_OIDC_ISSUER`, `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET`, `AUTH_OIDC_SCOPES` | empty | generic OIDC via `genericOAuth` |
| `AUTH_ALLOWED_EMAIL_DOMAINS` | empty | comma list; empty means any |
| `AUTH_SIGNUP_MODE` | `invite` | `open`, `invite`, `closed` |
| `AUTH_BOOTSTRAP_ADMIN_EMAIL` | empty | |
| `EMAIL_TRANSPORT` + `SMTP_*` / `SES_REGION` | `none` | |
| `TRUST_PROXY_CIDRS` | ALB subnets | for client IP |
| `REDACTION_EXTRA_PATTERNS` | empty | JSON array of `{id, regex}`; seeds `RedactionPolicy` rows at boot (§5.3) |
| `EMBEDDINGS_ENABLED` | `false` | |
| `EMBEDDINGS_PROVIDER`, `EMBEDDINGS_MODEL`, `EMBEDDINGS_DIMENSIONS` | `openai`, `text-embedding-3-small`, `1024` | |
| `EMBEDDINGS_DAILY_TOKEN_BUDGET`, `EMBEDDINGS_MAX_CHUNKS_PER_SESSION` | `5000000`, `2000` | |
| `WORKER_MODE` | `inline` | `inline` or `separate` |
| `SEARCH_CONTEXT_DEFAULT` | `1` | default `context` for `search` |
| client `config.json`: `realtime` / `syncIntervalSeconds` / `syncBytesThreshold` | `true` / `10` / `65536` | near-real-time sync behaviour of the shim (§6.3) |
| `MCP_COMPAT_SEARCH_FETCH` | `false` | also expose OpenAI-style `search`/`fetch` tools |
| `RATE_LIMIT_*` | §9.4 values | |
| `LOG_LEVEL` | `info` | |

## Appendix C. What the agent sees

### C.1 The three tools, as listed by `tools/list`

```jsonc
[
  {
    "name": "search",
    "description": "Search this organization's past coding-agent sessions (Claude Code, Codex). Only use this when the user asks about previous sessions or prior work; do not call it on your own initiative. Where possible, run the investigation in a subagent and have it return only the relevant findings with session ids: results can be large, and anything beyond a single lookup (more than 2-3 calls, or reading full sessions) belongs in a subagent, not in the main context.\n\nReturns message windows: each hit with the messages around it, grouped by session, with session_id and seq you can pass to get or join in sql. query uses PostgreSQL websearch syntax (\"phrase\", -word, OR) and may be empty if filters are given. Filters AND across keys; an array within a key is OR.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": { "type": "string" },
        "filters": {
          "type": "object", "additionalProperties": false,
          "properties": {
            "repo": { "type": ["string", "array"], "items": { "type": "string" } },
            "branch": { "type": ["string", "array"], "items": { "type": "string" } },
            "user": { "type": ["string", "array"], "items": { "type": "string" }, "description": "email or name" },
            "device": { "type": ["string", "array"], "items": { "type": "string" } },
            "harness": { "type": ["string", "array"], "items": { "enum": ["CLAUDE_CODE", "CODEX"] } },
            "model": { "type": ["string", "array"], "items": { "type": "string" } },
            "tool": { "type": ["string", "array"], "items": { "type": "string" } },
            "tag": { "type": ["string", "array"], "items": { "type": "string" } },
            "linear_key": { "type": ["string", "array"], "items": { "type": "string" } },
            "file": { "type": ["string", "array"], "items": { "type": "string" }, "description": "path prefix" },
            "role": { "type": ["string", "array"], "items": { "enum": ["USER", "ASSISTANT", "TOOL_RESULT", "SYSTEM"] } },
            "kind": { "type": ["string", "array"], "items": { "enum": ["TEXT", "TOOL_USE", "TOOL_RESULT"] } },
            "session_id": { "type": ["string", "array"], "items": { "type": "string" } },
            "since": { "type": "string", "format": "date-time" },
            "until": { "type": "string", "format": "date-time" },
            "has_commits": { "type": "boolean" }
          }
        },
        "context": { "type": "integer", "minimum": 0, "maximum": 3, "default": 1, "description": "messages each side of a hit" },
        "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }
      },
      "required": ["query"]
    }
  },
  {
    "name": "get",
    "description": "Fetch one session by session_id (from search). Without a range: header (title, user, repo, branch, commits, files, parent, children) and all messages with tool inputs/outputs stubbed to one line and thinking omitted; capped at 200 messages, next_from to continue. With from/to (inclusive seq range): exactly those messages, expanded. full=true expands tool outputs and thinking. Only use when the user asks about prior work. Prefer a range over a whole session, and where possible do long reads in a subagent that returns only the relevant findings.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "session_id": { "type": "string" },
        "from": { "type": "integer", "minimum": 0 },
        "to": { "type": "integer", "minimum": 0 },
        "full": { "type": "boolean", "default": false }
      },
      "required": ["session_id"]
    }
  },
  {
    "name": "sql",
    "description": "<generated at boot; see C.2>",
    "inputSchema": { "type": "object", "properties": { "sql": { "type": "string" } }, "required": ["sql"] }
  }
]
```

### C.2 The generated `sql` description (template; lists come from the catalog)
```
Run one read-only PostgreSQL SELECT over the session index, for counts, facets, time
series, and anything search's filters cannot express. Only use this when the user asks
about previous sessions or prior work. Where possible, run multi-step analysis in a
subagent and return only the findings.

Views (schema api_ro; you only see sessions you are allowed to see):
  sessions(id, title, first_prompt, repo_name, repo_url, branch, cwd_relative, user_email, user_name, device_hostname, model, started_at, ended_at, duration_seconds, status, end_reason, parent_session_id, parent_relation, root_session_id, depth, agent_type, tools_used[], tags[], linear_issue_keys[], commits jsonb, commit_count, diff_stat jsonb, message_count, tool_call_count, input_tokens, output_tokens, file_count, child_count)
  messages(id, session_id, seq, role, kind, content, searchable, tool_name, tool_use_id, tool_input jsonb, model, timestamp, session_title, repo_name, branch, user_email, search_tsv)
  session_files(session_id, path, ops[])  session_commits(session_id, sha, subject, authored_at)  session_tools(session_id, tool_name, call_count)
  session_tags(session_id, tag)  session_tree(ancestor_id, descendant_id, depth)  users(id, email, name)  devices(id, hostname, os_user, platform, last_seen_at)  repos(repo_url, repo_name, session_count, last_session_at)
Functions: search_messages(q, filters jsonb DEFAULT '{}', max_rows int DEFAULT 100) -> (session_id, seq, rank, snippet); similar_sessions(session_id, max_rows) [embeddings: off]
References: search results give session_id = sessions.id and (session_id, seq) = messages.(session_id, seq).
Discovery: \d · \d sessions · SELECT * FROM schema_columns WHERE view_name = 'messages' · SELECT * FROM query_examples
Limits: one SELECT, 500 rows, 5 s. Errors return the PostgreSQL message plus the valid column names.
Example: SELECT s.repo_name, count(DISTINCT r.session_id) FROM search_messages('rate limiter', '{"since":"2026-06-01"}', 500) r JOIN sessions s ON s.id = r.session_id GROUP BY 1 ORDER BY 2 DESC
```

### C.3 Responses

`search({ query: "rate limiter", filters: { repo: "cunningham", since: "2026-06-01T00:00:00Z" } })`
```
2 blocks (38 ms)

── 0192a3f0-7c1e-7d1a-9b0e-3f2a1c9d4e55 · Add token-bucket rate limiter to API gateway
   cunningham · feat/rate-limit · ana@example.com · 2026-08-21 14:02 · score 0.91
   seq 1  USER      ▶ Implement a rate limiter for the public API using a token bucket…
   seq 2  ASSISTANT   I'll look at how the gateway routes are structured first…
   seq 3  TOOL_USE    Read src/api/gateway.ts
   seq 17 TOOL_USE    Edit src/api/middleware/rateLimit.ts  [truncated]
   seq 18 ASSISTANT ▶ …added RateLimiter middleware in src/api/middleware/rateLimit.ts…
   seq 19 TOOL_USE    Bash pnpm test

── 0192b7c1-… · Investigate 429s from upstream
   cunningham · main · raphael@example.com · 2026-08-03 · score 0.44
   seq 6  TOOL_USE    Bash curl -i https://…
   seq 7  TOOL_RESULT ▶ HTTP 429 Too Many Requests: rate limit exceeded for key…  [truncated]
   seq 8  ASSISTANT   The upstream is throttling us at 100 req/min…

▶ = hit. Use get(session_id, from, to) to expand, or join session_id/seq in sql.
```

`get({ session_id: "0192a3f0-…", from: 15, to: 20, full: true })`
```
Add token-bucket rate limiter to API gateway
cunningham · feat/rate-limit · ana@example.com · MacBook-Pro · claude-opus-5 · Claude Code 2.1.263
2026-08-21 14:02 → 14:54 · ENDED · 3 commits · 7 files · 41 tool calls · 118 messages
Parent: none · Children: 0192a3f1-… (SUBAGENT, Explore), 0192a3f2-… (SUBAGENT, Explore)
Commits: 3f2a1c Add RateLimiter middleware · 9b0e77 Wire limiter into gateway routes · c41d02 Tests for token bucket
Files: src/api/middleware/rateLimit.ts (write, edit) · src/api/gateway.ts (edit) · test/rateLimit.test.ts (write) · …

seq 15 [14:21] ASSISTANT   Now I'll add the middleware…
seq 16 [14:21] THINKING    The token bucket needs a monotonic clock…
seq 17 [14:22] TOOL_USE    Edit src/api/middleware/rateLimit.ts
                           {"file_path":"src/api/middleware/rateLimit.ts","old_string":"…","new_string":"…"}
seq 18 [14:22] TOOL_RESULT The file has been updated…
seq 19 [14:23] TOOL_USE    Bash pnpm test
seq 20 [14:23] TOOL_RESULT ✓ 14 tests passed …
```

`sql({ sql: "SELECT f.path, s.user_email, count(*) FROM session_files f JOIN sessions s ON s.id = f.session_id WHERE f.path LIKE 'src/auth/%' AND 'edit' = ANY(f.ops) AND s.started_at > now() - interval '30 days' GROUP BY 1,2 ORDER BY 3 DESC" })`
```
11 rows (21 ms)
path                | user_email          | count
--------------------+---------------------+------
src/auth/session.ts | ana@example.com     | 4
src/auth/oauth.ts   | raphael@example.com | 3
…
```

Errors: `search` with `filters: { repository: "x" }` →
`Unknown filter "repository". Valid: repo, branch, user, device, harness, model, tool, tag, linear_key, file, role, kind, session_id, since, until, has_commits.`
`sql` with `SELECT user FROM sessions` → `ERROR: column "user" does not exist (position 8)` plus `sessions columns: id, title, …, user_email, user_name, …`.
`sql` with `DELETE …` → `Rejected: only a single SELECT statement is allowed (found DELETE).`

### C.4 A worked interaction, with delegation
User: *"Has anyone already worked on rate limiting in cunningham? I don't want to
redo it."*
1. One `search` with `repo: cunningham` answers this. The agent reads the two blocks
   and replies with Ana's branch, the files, and the commit count. No `get` needed.

User: *"Go through everything we've done on auth in the last two months and tell me
what's still open."*
2. This is open-ended. Following the tool description and the installed skill, the
   agent spawns a subagent with the question and the three tools.
3. The subagent runs `search("auth", { repo: "cunningham", since: … }, context 1,
   limit 30)`, then `sql` for `session_files` under `src/auth/` grouped by session and
   user, then `get` with ranges on the three sessions whose last assistant message
   looked unfinished, and returns ~200 words: five sessions, what each shipped, two
   with uncommitted changes, with `session_id` references.
4. The main agent relays the findings. Its own context grew by the summary only.

### C.5 Why this is enough
- `search` answers "did anyone do X" in one call and hands back `session_id`/`seq`
  that `get` and `sql` accept unchanged.
- `get` is rarely needed and, when it is, ranges keep it small.
- `sql` covers every count, facet, and join, with the schema in its description and
  discoverable by `\d`.
- No grammar: filters are an enum with a helpful error, free text is Postgres's own
  websearch syntax.
- Investigations stay out of the main context by instruction and skill, not by
  server machinery.
