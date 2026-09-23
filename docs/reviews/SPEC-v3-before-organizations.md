# AgentCommons — Specification

Status: v3, 2026-09-07, implementation-ready after external review (see
`docs/reviews/codex-review-2026-09-07.md`; v2 kept alongside for diffing). Everything
defined here is built; there is no roadmap. Owner:
rek7. First deployment: ZeroPath. Self-hostable by any organization;
one organization per instance; nothing organization-specific is hardcoded.

AgentCommons is a central, append-only index of coding-agent sessions. Hooks in each
harness ship transcripts to one API. The API redacts secrets, normalizes the transcript,
links sessions, and exposes search to agents (MCP) and people (dashboard) so work is not
repeated and the session history becomes the team's record of what was tried and why.

Why a separate, self-hosted system: developer agent workflows run in terminals, IDEs,
and CI, not chat apps, so a bot tagged in Slack or one vendor's session memory misses
most of the work and ties the record to that vendor. Most agent work, including failing
tests and abandoned approaches, never reaches a PR; indexing it makes failures visible
where they happened. Versioned `CLAUDE.md`, `AGENTS.md`, and skills tell agents what to
do; this corpus holds the sessions that explain why.

Verified facts: hook contracts captured live on 2026-09-07 from Claude Code 2.1.263 and
Codex 0.150.0 (all events) and Gemini CLI 0.35.3 (session events). pi 0.73 from its
documentation. Payloads in `fixtures/hooks/`, summarized in Appendix A.

---

## 0. How this document is maintained
This is a living document and the source of truth. Code follows it; when they disagree,
the spec is corrected first, then the code.
- **Requirement IDs.** Every testable statement has an ID in `docs/REQUIREMENTS.md`
  (`R-<AREA>-<NN>`, e.g. `R-ING-04`) with the spec section it comes from and how it is
  verified. Tests reference IDs with `@req R-ING-04` in a comment or test name.
- **`pnpm spec:check`** (`scripts/spec-check.mjs`, no dependencies) fails when any
  requirement has no referencing test, when a requirement cites a section that does not
  exist, or when a test cites an ID that does not exist. It runs in `pre-push` and CI.
  Implementation is complete when it passes with every ID covered and §16.1 item 8 holds.
- **Change protocol.** A PR that changes behavior updates the spec section, the
  requirements table, and the tests in the same PR. A PR that changes a decision adds an
  ADR. The version line at the top is bumped for any normative change; `docs/reviews/`
  keeps prior versions and external reviews.
- **Facts vs. design.** Statements marked "verified" were observed on a real harness on
  the stated date and version. Anything marked "capture during implementation" must be
  observed, recorded in Appendix A and `fixtures/hooks/`, and only then built against.

---

## 1. Scope

Everything in this document is built. There is no phased shipping; §17 gives the
dependency order for implementation, and §16 the verification each part must pass.

- Capture Claude Code, Codex, Gemini CLI, and pi sessions automatically after a one-line
  install. Full transcripts including subagents and tool output, near-real-time, without
  slowing the agent. Durable: acknowledged cursors, one pending batch, spool, recovery.
  Gemini's and pi's hook contracts are captured live during implementation before their
  adapters are written; a harness is announced as supported when its canary is green.
- Redaction before any persisted write, with admin-managed policies (regex and a fixed
  allowlist of preinstalled secretlint rules) and a complete rescan.
- Sessions linked to parents (subagent, explicit fork, spawned).
- Three agent tools over MCP: `search`, `get`, `sql`. Admin keys additionally see four
  static admin tools.
- Semantic ranking implemented and shipped behind `EMBEDDINGS_ENABLED=false`, internal to
  `search`; no change to the agent surface when it flips (§11).
- Dashboard: login, search and session list, transcript with live tail, session tree, SQL
  page, keys, admin (users, keys, visibility, purge, audit, redaction policies, status with
  charts).
- Scoped API keys, database-enforced visibility, purge with a complete manifest, audit
  written atomically with mutations.
- AWS deployment with Pulumi; Docker Compose for self-hosting and development.

Out of scope: LLM session summaries and a Windows client.

---

## 2. Architecture

```
 developer machine                              AWS (Pulumi) or Docker Compose
 ┌───────────────────────────────┐             ┌────────────────────────────────────────┐
 │ Claude Code ─ hooks ─┐        │   HTTPS     │ ALB ─► apps/api (one container)         │
 │ Codex ─────── hooks ─┼► hook.js ────────────►   /api/v1/*   REST + OpenAPI           │
 │ Gemini CLI · pi ─────┤ hook mode ~50 ms     │   /mcp        MCP streamable HTTP      │
 │                      │ upload mode detached │   /auth/*     Better Auth               │
 │ ~/.agentcommons/     │                      │   /install.sh /hook/*                   │
 │  config state spool  │                      │   /           dashboard (static SPA)   │
 └───────────────────────────────┘             │   in-process worker (pg-boss)           │
 agents ── MCP: search / get / sql ────────────►        │                                │
 people ── dashboard ──────────────────────────►  Postgres 16 + pgvector + pg_trgm       │
                                               └────────────────────────────────────────┘
```

Ingest: hook fires → hook mode records intent → detached uploader ships one batch →
server redacts, stores raw records, normalizes, links, writes audit in the same
transaction → `202` → uploader advances the acknowledged cursor.

Read: dashboard (cookie) or agent (API key, REST or MCP) → auth → service → reader-role
connection whose views enforce visibility → audit → response.

---

## 3. Monorepo, libraries, internal architecture

```
agentcommons/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.js
  docker-compose.yml              self-host: api + db        docker-compose.dev.yml: db only
  .github/workflows/ci.yml
  apps/api                        Fastify: REST, MCP, auth, audit, worker, static dashboard
    src/services/                 SearchService, SessionService, QueryService, IngestService, AdminService
    src/routes/                   REST routes, zod schemas from packages/core
    src/mcp/                      tool registry (explicit), text formatters
    public/                       install.sh, hook manifest
  apps/dashboard                  Vite + React + Tailwind + shadcn/ui; OpenAPI-generated client
    src/copy.ts                   every user-facing string
  packages/db                     Prisma schema, migrations, hand-written SQL (api_ro, functions, roles)
  packages/core                   zod schemas, normalizers, redaction, link rules, formatters
  packages/hook                   zero-dependency shim → dist/hook.js
  packages/pi-extension           pi bridge emitting canonical behaviors
  infra/                          Pulumi TypeScript (@pulumi/awsx): dev, prod
  fixtures/hooks  fixtures/transcripts  fixtures/search-golden.yaml
  docs/SPEC.md  docs/adr/  docs/reviews/
```

Dependency rules: `hook` has no runtime dependencies. `core` depends on zod and
secretlint. `api` depends on `core` and `db`. `dashboard` depends on `core` types and the
generated client.

### 3.1 Core tenet and internal architecture
**One implementation per concept.** Differences between harnesses, transports, and
feature flags are data a single implementation reads (the shim's `HARNESSES` table,
shared zod schemas, the tool registry), never parallel code paths. `if (harness === …)`
outside an adapter is a defect; the same logic in two adapters is a defect.

```
adapters   REST routes · MCP tools · dashboard (OpenAPI client)
              validate with SHARED zod schemas → call a service → format with the SHARED formatter
services   SearchService · SessionService · QueryService · IngestService · AdminService
              one implementation each; caller context {userId, role, keyPermissions}; audit as part of the operation
data       Prisma (typed) · pg pools per reader role (api_ro) · pg-boss
```
- **Shared schemas**: `packages/core/schemas/` holds zod for `search`, `get`, `sql`
  inputs and outputs, the ingest envelope, and filters. REST bodies, MCP `inputSchema`
  (via `zod-to-json-schema`), OpenAPI, and the dashboard client derive from them.
- **Explicit adapters, no framework.** REST routes are registered with Fastify; MCP tools
  are registered with the SDK. Each registration is a few lines: schema, permission,
  service call, formatter. A 30-line helper `toolFromRoute(route)` exposes a body-schema
  route as a tool for the cases where the two are identical; it does no params/query
  merging and no introspection.
- **One formatter** (`packages/core/format/`) renders search blocks, session headers,
  transcripts, and SQL tables to text and JSON; MCP and dashboard "copy as text" use it.
- **One caller context, one audit path.** Services receive `{ userId, role,
  apiKeyId, permissions }` and return `{ result, audit }`. Mutation audit rows are written
  inside the mutation's transaction; read audit rows are written before the response is
  sent. Adapters never write audit rows. Effective authority (§7.5): admin visibility and
  admin tools require both an admin owner and an `admin:*` key permission.
- **One shim, harnesses as data.** `hook.js` has a `HARNESSES` table; each entry is
  event mapping, reader name, config paths, MCP registration shape. All behavior is
  shared (§6).
- **Adding a harness, checklist**: capture hook payloads live into `fixtures/hooks/`;
  sanitize a transcript into `fixtures/transcripts/<harness>/`; add the enum value; write
  `packages/core/normalizers/<harness>.ts` with snapshot tests; add one `HARNESSES`
  entry (and a reader only for a new storage format); add the harness to the live canary
  (§16). Support is announced only when the canary is green.
- **Generated, not written**: OpenAPI from routes, dashboard client from OpenAPI, MCP
  input schemas from zod, Better Auth models from its generator, Appendix C examples from
  contract-test fixtures.

### 3.2 Libraries (use, don't build)
Fastify 5 (+helmet, cors, rate-limit, static, compress) · zod, `fastify-type-provider-zod`,
`@fastify/swagger` · `openapi-typescript` + `openapi-fetch` · Better Auth (Prisma adapter;
`admin`, `apiKey`, `genericOAuth`, `openAPI` plugins) · Prisma; PostgreSQL 16 with
`pgvector`, `pg_trgm`; `pg` pools for `api_ro` · pg-boss · secretlint (`@secretlint/core`,
preset-recommend, rule-pattern) · `pgsql-ast-parser` · `@modelcontextprotocol/sdk` ·
`uuidv7` · pino · `@t3-oss/env-core` · React 19, Vite, Tailwind, shadcn/ui, TanStack
Router/Query/Table, `react-virtuoso`, `shiki` · Pulumi + `@pulumi/awsx` · Vitest,
`@testcontainers/postgresql`, Playwright, `@axe-core/playwright` · ESLint 9 +
typescript-eslint strict, Prettier, knip, Husky, lint-staged, commitlint.

---

## 4. Data model

IDs are UUIDv7 unless stated. Timestamps `timestamptz`. Better Auth owns `user`,
`session` (web), `account`, `verification`, `apikey`.

### 4.1 Identity
- **User**: Better Auth; `role` ∈ {`admin`, `user`}.
- **ApiKey**: Better Auth API Key plugin; owned by a user; `permissions`
  `{ sessions: ["ingest" | "read"], admin: ["*"] }`; hashed; prefix `ac_`; a user may
  hold many. `admin:*` is grantable only to keys owned by admins and is effective only
  while the owner is an admin.
- **Installation**: `id` (random UUID generated by the installer and stored in
  `config.json`), `hostname`, `osUser`, `platform`, `arch`, `firstSeenAt`, `lastSeenAt`.
  Replaces hardware fingerprinting; attribution is by key and installation.

### 4.2 Session
| column | notes |
|---|---|
| `id` | |
| `harness` | `CLAUDE_CODE`, `CODEX`, `GEMINI_CLI`, `PI` |
| `harnessSessionId` | native id; Claude subagents `<sessionId>:agent-<agentId>`; unique with `harness` |
| `harnessVersion`, `entrypoint` | from the transcript (`version`/`cli_version`; `entrypoint`/`originator`) |
| `userId`, `ingestApiKeyId`, `installationId` | owner from the first ingesting key |
| `cwd`, `repoRoot`, `cwdRelative` | `git rev-parse --show-toplevel` (worktree root); cwd relative to it |
| `repoUrl`, `repoName` | normalized `host/org/repo` from `origin` with credentials and `.git` stripped; null outside a repo |
| `branch`, `startCommit`, `endCommit` | branch null when detached |
| `observedCommits`, `observedDiffStat`, `dirtyFileCount` | observations at session end (`startCommit..endCommit`, `git diff --shortstat`); labeled *observed*, not attributed (§12) |
| `model`, `modelsUsed` | |
| `startedAt`, `endedAt`, `lastActivityAt` | `lastActivityAt` is server receipt time |
| `status`, `endReason` | `ACTIVE`, `ENDED`, `INACTIVE` (no receipt for 6 h; displayed as inactivity, not death) |
| `title`, `firstPrompt` | Claude `aiTitle` → Codex thread name → first prompt (120 chars); first prompt ≤ 4 KB, redacted |
| `parentSessionId`, `parentRelation`, `parentNativeRef` | relation ∈ `SUBAGENT`, `FORK`, `SPAWNED`; `parentNativeRef` keeps the harness's reference when the parent has not been ingested; resolved on parent arrival |
| `agentType` | Claude `agent_type`; Codex `agent_role`/`agent_nickname` |
| `visibility`, `purgedAt`, `purgedByUserId`, `purgeReason` | |
| `messageCount`, `toolCallCount`, `inputTokens`, `outputTokens` | maintained from newly accepted records only |
| `toolsUsed` | `text[]` |

**SessionFile** (`sessionId`, `path` repo-relative, `ops text[]`): from explicit file
tools only (Claude `Read/Edit/Write/MultiEdit/NotebookEdit`; Codex `apply_patch`;
Gemini `read_file/write_file/replace`; pi `read/edit/write`). Shell commands are not
parsed. `pg_trgm` GIN on `path`.

Relationships are an adjacency list: `parentSessionId` plus `parentRelation`. Root,
depth, and descendants are computed with recursive SQL. Resume is a lifecycle event on
the same session, not an edge. Forks are recorded only from explicit native metadata.

Indexes: unique `(harness, harnessSessionId)`; btree `userId`, `installationId`,
`repoName`, `branch`, `startedAt desc`, `lastActivityAt desc`, `parentSessionId`,
`visibility`, `status`; composite `(repoName, branch, startedAt desc)`; GIN `toolsUsed`;
`pg_trgm` GIN `title`.

### 4.3 Records and messages
**RawRecord**: `id`, `sessionId`, `pos bigint` (source position: byte offset for JSONL,
array index for JSON documents), `key text` (native record id when present: Claude
`uuid`, Codex `ordinal`, Gemini message `id`, pi entry `id`), `recordType`, `payload`
jsonb (redacted and, if oversized, sanitized per §4.4), `ingestBatchId`, `receivedAt`.
Unique `(sessionId, pos)`; unique `(sessionId, key)` where key not null. **Source order
is `pos`.** Append-only.

**Message**: `id` = UUIDv5(`sessionId`, `rawRecordId`, block index), so the same source
record always yields the same message ids; `sessionId`, `rawRecordId`, `seq` (dense
ordinal assigned by `(pos, blockIndex)`, recomputed for the session when an earlier `pos`
arrives late, which the uploader's in-order rule makes rare), `role` (`USER`,
`ASSISTANT`, `TOOL_RESULT`, `SYSTEM`), `kind` (`TEXT`, `THINKING`, `TOOL_USE`,
`TOOL_RESULT`, `META`), `content`, `toolName` (on both use and result), `toolUseId`,
`toolInput` jsonb, `model`, `timestamp` (source; null if missing or invalid),
`receivedAt`, `inputTokens`, `outputTokens` (adapter-defined; null when unknown; retries
never add), `agentId`, `searchable`, `searchText`, `searchTsv` (generated; §7.1).
Index `(sessionId, seq)`, `(sessionId, toolUseId)`, GIN `searchTsv` where `searchable`.

**IngestBatch**: `id`, `sessionId`, `apiKeyId`, `userId`, `installationId`, `ip`,
`userAgent`, `behavior`, `nativeEvent`, `receivedAt`, `recordCount`, `duplicateCount`,
`byteCount`, `redactionCount`, `durationMs`.
**RedactionEvent**: `ingestBatchId`, `sessionId`, `policyId`, `count`. Never the value.
**RedactionPolicy**: `id`, `name`, `kind` (`REGEX` | `SECRETLINT_RULE`), `pattern` +
`flags` or `ruleId` + `options` (from a fixed allowlist of preinstalled rules), `replacement`
(default `[REDACTED:<name>]`), `enabled`, `builtin`, `createdByUserId`, timestamps.
**AuditEvent**: §9.3. **MessageChunk**, **SessionEmbedding**: §11 (present, unused when
the flag is off).

### 4.4 Full sessions, size, and sanitization
Every source record is stored. Records are parsed before any size handling: redaction
runs first, then if a record's serialized payload exceeds 1 MB, oversized string leaves
are replaced by `[agentcommons: N bytes omitted, sha256 …]` while structure stays valid
JSON. Storage is therefore *redacted and sanitized source*, not byte-exact. Base64
images become `[image: mime, N bytes]`. Requests: 10 MB compressed, 50 MB decompressed,
streamed. Harnesses already cap tool output (Claude `Read` 2000 lines, Bash ~30 KB), so
sanitization is rare.

### 4.5 Prisma notes
`tsvector`/`vector` are `Unsupported(...)`; generated columns, indexes, `api_ro` views
and functions, roles and grants are hand-written SQL steps kept with the migrations.
Extensions `vector`, `pg_trgm` in the first migration.

---

## 5. Ingest

### 5.1 Endpoint and envelope
`POST /api/v1/ingest`, permission `sessions:ingest`, gzip accepted.

```jsonc
{
  "envelopeVersion": 2,
  "harness": "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI",
  "harnessSessionId": "415cee4b-…",             // the harness's own id; subagents ship as their own sessions with parentHint
  "behavior": "start" | "sync" | "end",          // canonical (§6.3)
  "nativeEvent": "UserPromptSubmit",              // diagnostics only
  "batchId": "0192…",                             // client UUID; idempotent per batch
  "installationId": "…", "sentAt": "…",
  "context": {
    "cwd": "…", "git": { "root": "…", "remoteUrl": "…", "branch": "…", "head": "…" } | null,
    "parentHint": { "harnessSessionId": "…", "relation": "SUBAGENT" | "SPAWNED", "agentId": "…", "agentType": "…" } | null
  },
  "records": [ { "pos": 48213, "key": "c008375c-…", "line": "{…}" }, … ],   // in source order
  "cursor": "48213→52990",                        // opaque, echoed back
  "end": { "reason": "exit", "head": "…", "observedCommits": [ … ], "observedDiffStat": { … }, "dirtyFileCount": 1 } | null
}
```
Response `202 { "sessionId", "accepted", "duplicates", "cursor" }`. `202` means the whole
batch, its derived rows, and its audit row are committed. There is no partial acceptance.
Errors: `401/403` (suspend and report), `409` (session owned by another user, or
tombstoned), `413` (split), `422` (permanently invalid record: quarantined client-side,
other records accepted on resend without it), `429/5xx` (retry with backoff).

### 5.2 Semantics
- Upsert Session on `(harness, harnessSessionId)`; first writer owns it; another user's
  key gets `409` unless admin-permitted (audited). Tombstoned sessions reject appends.
- Records dedupe on `(sessionId, key)` when `key` is present, else `(sessionId, pos)`.
  Repeated batches (same `batchId`) return the prior result.
- **Source order is authoritative.** `seq` derives from `pos`. The uploader never sends
  a later range before an earlier range is acknowledged (§6.2), so late arrival is
  confined to retries of the same range.
- Lifecycle by source order: `start` with a resume source, and `end`, are applied in
  `pos`/time order; a delayed `end` does not override a later resume.
- Metadata idempotency: counters, `toolsUsed`, `SessionFile`, lifecycle markers change
  only for newly accepted records or events.
- One transaction per batch: raw records, messages, files, counters, links, IngestBatch,
  AuditEvent.

### 5.3 Redaction
Applied to **every persisted free-text path**: record lines, envelope git fields, commit
subjects, titles, first prompts, and audit `detail` text. In memory, before any write.
Local spool and state files on the client are not redacted (they are the transcript's
own machine); they are `0600` in a `0700` directory. README says "never stored
unredacted on the server", not "never reach disk".

Rules = shipped secretlint preset + pattern rule (Anthropic, OpenAI, JWTs, connection
strings with passwords, generic `token=…`, `ac_` keys) + `RedactionPolicy` rows,
composed into one secretlint configuration, validated on save (regex compiles, bounded
length, catastrophic-backtracking check), cached 30 s. Admins manage policies from the
dashboard or `/admin/redaction/policies`; `REDACTION_EXTRA_PATTERNS` seeds rows at boot.
Built-ins can be disabled, not deleted. `POST /admin/redaction/test { text }` shows what
would be redacted.

**Sensitive files.** Tool results whose input path matches `**/.env*`, `**/*.pem`,
`**/*.key`, `**/id_rsa*`, `**/credentials*`, `**/.npmrc`, `**/.netrc` are replaced
wholesale. Results are paired to inputs by `(sessionId, toolUseId)`: in the same batch or
already stored (in-order upload guarantees the input precedes the result). If no input
is found, the result is stored as `[withheld: unpaired tool result]` (fail closed) and
completed if the input arrives later.

**Rescan (complete by construction).** `POST /admin/redaction/rescan { policyIds?,
since?, reason }` enqueues a job that, per session: re-applies the current policy set to
every `RawRecord.payload`, then re-derives Message, SessionFile, title, first prompt,
and (if enabled) chunks from the rewritten raw records, and writes a RedactionEvent and
one audit row per session touched. Because everything derived is rebuilt from raw, no
representation is missed. It runs serialized with ingest for that session.

### 5.4 Normalization
`Normalizer { harness, toMessages(records), sessionDelta(records), links(records) }`
selected by the envelope's `harness` (no detection). Permissive: unknown record types
are raw-only. Zod `passthrough()` keeps unknown fields.

**Claude Code** (`~/.claude/projects/<slug>/<sessionId>.jsonl`). Types `user`,
`assistant`, `system`, `attachment`, `summary`, `ai-title`, `last-prompt`,
`queue-operation`, `atis-latch`. Fields `uuid`, `parentUuid`, `sessionId`, `cwd`,
`gitBranch`, `version`, `timestamp`, `isSidechain`, `agentId`, `entrypoint`,
`message.{role, model, content[], usage}`, `toolUseResult`, `aiTitle`. Blocks `text`,
`thinking`, `tool_use`, `tool_result`, `image`. Tool results arrive as `user`-role
records and are classified by block. Subagent transcripts:
`<slug>/<sessionId>/subagents/agent-<agentId>.jsonl` (+ `.meta.json`); the parent
transcript does not contain them (verified). `summary` → `SYSTEM TEXT`.

**Codex** (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`). Types
`session_meta`, `turn_context`, `response_item`, `event_msg`, `world_state`.
`session_meta.payload`: `id`, `cwd`, `originator`, `cli_version`, `source`,
`thread_source`, `git.{repository_url, branch, commit_hash}`, `agent_nickname`,
`agent_role`, `base_instructions` (stored once, `META`, not searchable).
`response_item.payload.type`: `message` (user/assistant/developer→`SYSTEM META`),
`function_call`/`local_shell_call`/`custom_tool_call` → `TOOL_USE`,
`function_call_output` → `TOOL_RESULT`, `reasoning` → `THINKING`. `turn_context` sets
model; `event_msg token_count` sets usage (adapter rule: treat as cumulative, store
deltas). A second `session_meta` in the same file = resume.

**Gemini CLI**. `~/.gemini/tmp/<project>/chats/session-<ts>-<id8>.json`: one
JSON document rewritten in full on every change (`writeFileSync`, verified); shape
`{ sessionId, projectHash, startTime, lastUpdated, messages: [{ id, type: "user" |
"gemini", content, thoughts[], toolCalls[], tokens, model, timestamp }] }`; large tool
outputs spilled to `tool-outputs/session-<id>/`. **Capture before writing the adapter:**
whether an existing message mutates in place (tool results added later). If
it does, raw versions are keyed by `(id, contentHash)` and the normalized projection is
the latest version; if not, index cursors suffice.

**pi**. `~/.pi/agent/sessions/--<cwd-encoded>--/<ts>_<uuid>.jsonl`, append-only
tree JSONL: header `{ type: "session", version: 3, id, timestamp, cwd, parentSession? }`,
entries with `id`, `parentId`, `timestamp`, `type` ∈ `message`, `model_change`,
`thinking_level_change`, `compaction`, `branch_summary`, `custom`, `custom_message`,
`label`, `session_info`. `message.role` ∈ `user`, `assistant`, `toolResult`,
`bashExecution`, `custom`; `toolCall` blocks; `toolResult` with `toolCallId`. All
entries stored with `parentId`; the pi extension sends the active leaf id with each
sync so the transcript view can follow it.

### 5.5 Links
| relation | Claude Code | Codex | Gemini CLI | pi |
|---|---|---|---|---|
| `SUBAGENT` | child path known from `SubagentStart` (`agent_id`) via the verified layout; shipped with `parentHint`; `SubagentStop` confirms | child rollout `session_meta.source.subagent.thread_spawn.parent_thread_id`; hooks verified by name, payloads captured during implementation | captured during implementation | none |
| `FORK` | none (no native metadata) | `forked_from` marker when present | n/a | header `parentSession` |
| `SPAWNED` | env `AGENTCOMMONS_PARENT_SESSION_ID` | same | same | same |
Native metadata outranks env hints; conflicts are recorded, never relinked silently.
Unresolved parents stay in `parentNativeRef` until the parent arrives.

---

## 6. Hook shim and installer

### 6.1 Install
```
curl -fsSL https://agentcommons.example.com/install.sh | sh -s -- --key ac_…
```
POSIX sh, idempotent; upgrades by re-run.
1. Require `curl` and Node ≥ 20; record the absolute `node` path (hooks run without the
   user's shell PATH).
2. Fetch `/hook/manifest.json` `{ version, sha256, url }`; download `hook.js` to a temp
   file; verify; atomic rename into `~/.agentcommons/hook.js`. Artifacts are versioned
   (`/hook/<version>/hook.js`) so caches cannot serve a mismatched pair.
3. Write `config.json` (0600): server, key, `installationId` (generated once), node
   path, `realtime`, `syncIntervalSeconds` (10), `syncBytesThreshold` (65536),
   `disabledPaths`. Existing values preserved.
4. `node hook.js install`: for each harness present, merge hooks into its config keyed by
   an exact marker (`agentcommons-hook` in the command); register the MCP server (`claude
   mcp add -s user -t http …`, `codex mcp add … --bearer-token-env-var
   AGENTCOMMONS_API_KEY`, Gemini `mcpServers` entry); append the env export to
   the shell rc unless `--no-shell-rc`. Prints the repository snippet (§8.4).
5. `node hook.js doctor`: `GET /api/v1/me`, harness config check; nonzero exit on failure.
6. Prints: Codex runs no hooks until trusted on next interactive launch (verified).

`--uninstall` runs the **installed** `hook.js uninstall` (no download), removes only
entries carrying the marker, keeps `config.json`. Exit codes: hooks always exit 0 (fail
open); `install`/`doctor`/`uninstall` exit nonzero on failure.

### 6.2 Shim: one durability state machine
One file, no dependencies, two modes.

**State** (`~/.agentcommons/state/<harness>-<sessionId>.json`, versioned):
`{ v, harness, sessionId, transcriptPath, reader, ackedCursor, pending?: { batchId, file,
cursorEnd }, intent: "none" | "sync" | "end", endMeta?, children: [ { sessionId,
transcriptPath, ackedCursor, pending? } ], lastSyncAt, owner?: { pid, since } }`.

**Hook mode** (`hook.js <harness>`, run by the harness on every event, ~50 ms): read
stdin, map the native event to a behavior via `HARNESSES` (§6.3), update the state
file: `start` → create state, register `context`; `sync` → set `intent = "sync"` if due
(prompt/turn end: always; tool: ≥ `syncIntervalSeconds` since `lastSyncAt` or ≥ 64 KB
pending); Claude `SubagentStart` → add a child source at the verified path; `end` →
compute `endMeta` (three local git commands, 500 ms each) and set `intent = "end"`.
Then, if no live owner holds the lock, spawn `hook.js upload <state>` detached
(`detached: true, stdio: 'ignore'`, `.unref()`) and exit 0. Never any network I/O.

**Upload mode** (`hook.js upload <state>`, always a detached child):
1. Acquire the lock: write `owner {pid, since}` with `O_EXCL`; if held by a live pid,
   exit; if held by a dead pid or older than the bounded uploader lifetime (5 min), take
   over.
2. Loop: if `pending` exists, resend it (same `batchId`, same cursor range); else if
   intent is set or the source grew, read from `ackedCursor` with the reader, write the
   batch file, set `pending`, send. On `202`: `ackedCursor = cursorEnd`, delete the batch
   file, clear `pending`, `lastSyncAt = now`. On `end` intent with nothing pending: send
   the `end` envelope. Repeat for each registered child source. Continue while intent
   changed during the loop or the source grew again; then clear intent, release the
   lock, exit.
3. Failures: `429/5xx/network` → backoff (1 s, 5 s, 30 s) up to three tries, then leave
   `pending` in place and exit (the next hook or sweep resumes). `401/403/409` → suspend
   the session (state `suspended` with reason), write to `hook.log`, exit. `413` → split
   the pending batch. `422` → quarantine the named record, resend.
4. After its own session: flush spooled pending batches of at most one other session
   (oldest `lastSyncAt` first) whose intent is set or whose source grew (**sweep**).

Guarantees, stated honestly: uploads are event-triggered. During activity, new content
is sent within about `syncIntervalSeconds`. An idle session with pending content waits
for its next hook or another session's sweep; there is no timer. Nothing is lost while
the disk survives: `ackedCursor` only advances on `202`, and the server dedupes.

### 6.3 Harness table
| behavior | Claude Code | Codex | Gemini CLI | pi |
|---|---|---|---|---|
| `start` | `SessionStart` | `SessionStart` | `SessionStart` | `session_start` |
| `sync` | `UserPromptSubmit`, `PostToolUse`, `Stop`, `SubagentStop` | same | `BeforeAgent`, `AfterTool`, `AfterAgent` | `input`, `tool_result`, `agent_end` |
| child source | `SubagentStart` (+ `SubagentStop` confirms) | `SubagentStart/Stop` | — | — |
| `end` | `SessionEnd` | `SessionEnd` | `SessionEnd` | `session_shutdown` |
Readers: `jsonl-append` (byte offset) and `json-document` (parsed array index, plus
version hashing if Gemini mutates in place). Each entry also carries config path, hooks
key, timeout unit (Gemini: ms), and MCP registration shape.

### 6.4 Environment
`AGENTCOMMONS_SERVER`, `AGENTCOMMONS_API_KEY`, `AGENTCOMMONS_PARENT_SESSION_ID`,
`AGENTCOMMONS_DISABLE=1`.

---

## 7. Search, read, SQL (the backbone)

Three operations, one index, one vocabulary. Field names in every output are the
`api_ro` column names (`repo_name`, `user_email`, `tool_name`, `content`, `seq`), so a
result from one operation is a valid input to the next.

### 7.0 From a keystroke to a hit
A prompt is appended to the transcript and fires a hook (≈50 ms: map event, mark
intent, spawn uploader). The uploader ships the new records with their source positions.
The server authenticates, redacts every line, stores raw records, normalizes them into
messages with deterministic ids and `seq` from source position, marks which parts are
searchable, and lets Postgres compute the search vector on insert, all in one
transaction with the audit row. Ten seconds later a teammate's agent calls `search` with
a query and a repo filter; the service validates against the shared schema, runs one
ranked statement on the caller's reader role (private rows are filtered inside the
view), fetches one neighbour either side of each hit, merges overlapping windows, cuts
match-centered excerpts, and returns blocks carrying `session_id` and `seq`.

### 7.1 Ingest decides what is searchable
| message | searchable | `searchText` |
|---|---|---|
| `USER` / `ASSISTANT` / `SYSTEM` `TEXT` | yes | whole text |
| `TOOL_USE` | yes | tool name + first 1 KB of input |
| `TOOL_RESULT` | yes | first 2 KB **and last 2 KB** (test and compiler failures appear at the end) |
| `THINKING`, `META`, images | no | stored, returned by `get`, never ranked |
```sql
search_tsv = setweight(to_tsvector('english', search_text), w) || setweight(to_tsvector('simple', search_text), w)
-- w: A USER · B ASSISTANT/SYSTEM · C TOOL_USE · D TOOL_RESULT
```
Stemmed and exact-token lexemes both match. This is token search, not substring search;
literal substrings outside the ranked portion are reachable with SQL `LIKE` on `content`.

### 7.2 `search`
Input (`packages/core/schemas/search.ts`):
```jsonc
{ "query": "rate limiter",                 // PostgreSQL websearch syntax; may be "" if filters given
  "filters": { "repo_name": "cunningham", "branch": ["feat/x", "main"], "user_email": "…",
               "tool_name": "Edit", "file_prefix": "src/auth/", "role": "USER",
               "session_id": "…", "since": "2026-08-01T00:00:00Z", "until": "2026-09-01T00:00:00Z" },
  "context": 1, "limit": 5, "cursor": null }
```
- Filters: scalar or array (OR within, AND across); enums on scalars and array items;
  unknown key or empty array → 400 listing valid keys. `repo_name` accepts the canonical
  `host/org/repo` or a short name when unambiguous (400 otherwise). `user_email` exact.
  `tool_name` matches tool-use/result messages themselves. `file_prefix` selects
  *sessions* that touched the path. `since` inclusive / `until` exclusive on **message
  time** (UTC). `session_id` searches within a session. Nothing else; the rest is SQL.
- `limit` = hit messages before window merging (default 5, max 50), with at most 3 hits
  per session so one noisy session cannot fill a page. `context` 0–3 (default 1) counts
  normalized non-thinking messages either side.
- Pipeline: filters → `WHERE`; `websearch_to_tsquery('english') || websearch_to_tsquery('simple')`
  against `search_tsv`; `ts_rank_cd(…, 1|32)`; (embeddings on: fused with cosine
  neighbours internally); deterministic order `(rank desc, session_id, seq)`; neighbours
  by `(session_id, seq)`; merge touching windows; excerpts.
- Empty `query` with filters: one most-recent anchor message per matching session.
- Output: blocks `{ session_id, title, harness, model, repo_name, branch, user_email,
  started_at, messages: [{ seq, role, kind, tool_name?, tool_use_id?, content, hit,
  truncated }] }`,
  `cursor` (opaque, query-bound; same in REST and MCP), `truncated_response`.
  `content` is a match-centered excerpt (~300 chars around the first match; tool text
  300 chars). No scores or timings in the agent-facing text. Response budget 32 KB
  (transport cap 256 KB).

### 7.3 `get`
`{ session_id, from?, to? }`; inclusive `seq` bounds; `to < from` → 400. Same behavior
with or without a range. Returns a header with every session-level fact: `session_id`,
`title`, `harness`, `harness_version`, `entrypoint`, `model`, `models_used`,
`user_email`, `installation_hostname`, `repo_name`, `repo_url`, `branch`, `cwd_relative`,
`start_commit`, `end_commit`, `started_at`, `ended_at`, `status`, `end_reason`,
`message_count`, `tool_call_count`, `input_tokens`, `output_tokens`, `tools_used`,
`file_count`, `observed_commit_count`, `agent_type`, `parent` ref and `children` refs
that the caller may see, `root_session_id`; then messages in order, every kind including thinking and tool results, each
`content` bounded to 4 KB with `content_cursor` for the remainder, total budget 32 KB,
`next` cursor `{ seq, offset }`. Full file lists, commits, and trees come from SQL.

### 7.4 `sql`
`{ sql }`: one read-only PostgreSQL `SELECT` over `api_ro`.
- Views: `sessions` (§4.2 columns snake_case + `user_email`, `user_name`,
  `installation_hostname`, `parent_title` (visible parents only), `child_count` (visible
  children), `duration_seconds`, `file_count`), `messages` (§4.3 + `session_title`,
  `repo_name`, `branch`, `user_email`, `search_tsv`), `session_files`,
  `session_observed_commits`, `session_tools`, `users (id, email, name)`,
  `installations`, `repos`, `schema_columns`, `schema_functions`.
- Functions: `search_messages(q text)` → uncapped relation `(session_id, seq, rank)` for
  composing ranking with any predicate or aggregate; `similar_sessions(session_id,
  max_rows)` only when embeddings are enabled (§11).
- Response `{ columns: [{name, type}], rows: [[…]], row_count, capped, truncated_cells:
  [[row, col]], duration_ms }`. Fetch 501 to set `capped`; big integers and decimals as
  strings; text cells cut at 2 KB; ≤ 256 KB total. Errors: `{ code, message, position }`
  plus "see `schema_columns`". No psql shortcuts, no enrichment.

### 7.5 Security, silently
1. Key verified; caller context built. **Effective authority**: admin visibility and
   admin operations require owner `role = admin` **and** key permission `admin:*`;
   admin-owned `read`-only keys see public data only.
2. Connection from the pool for the caller's authority: `ac_reader_user` or
   `ac_reader_admin`; both: `USAGE` on `api_ro`, `SELECT` on its views, `EXECUTE` on its
   functions, nothing on `public`, `search_path = api_ro`, read-only transactions,
   `statement_timeout = 5s`, `work_mem = 16MB`, `temp_file_limit = 64MB`.
3. Views are `security_barrier` and end with
   `AND ((visibility = 'PUBLIC' AND purged_at IS NULL) OR current_user = 'ac_reader_admin')`;
   functions are `SECURITY INVOKER` over those views. Derived columns (`parent_title`,
   `child_count`, `repos` counts, `installations`) are computed from the caller-visible
   set; a hidden parent appears as null, never reparented.
4. Guard (`pgsql-ast-parser`): one statement; `SELECT`/`WITH … SELECT` including
   `WITH RECURSIVE` (trees are recursive CTEs over `parent_session_id`); **allowlist**
   validation: every relation reference resolves to an `api_ro` view or a CTE, every
   function to `api_ro` or a small allowlist of builtins (`count`, `sum`, `min`, `max`,
   `avg`, `array_agg`, `string_agg`, `coalesce`, `nullif`, `lower`, `upper`, `length`,
   `left`, `right`, `substring`, `position`, `now`, `date_trunc`, `to_char`,
   `websearch_to_tsquery`, `to_tsquery`, `ts_rank_cd`, `jsonb_*` readers, `unnest`,
   `generate_series` bounded); no `INTO`, `FOR UPDATE`, `SET`, `COPY`, `DO`, `CALL`;
   ≤ 20 KB. Role, grants, and timeout are the enforcement; the guard gives fast errors.
5. `SELECT * FROM (<sql>) q LIMIT 501`. `search`/`get` run parameterized statements on
   the same pools.
6. Rate limits per key: `search`/`get` 300/min, `sql` 60/min. Audit rows carry filters,
   SQL text (redacted), row counts, duration, and transport (`rest` | `mcp`, tool name):
   one row per logical operation.

### 7.6 REST
All under `/api/v1`, zod-validated, OpenAPI at `/api/docs`; routes without response
schema and summary fail boot.
| method | path | permission | notes |
|---|---|---|---|
| POST | `/ingest` | `sessions:ingest` | §5 |
| POST | `/search` | `sessions:read` | = `search` |
| GET | `/sessions/:id` | read | = `get`; `?from=&to=&cursor=` |
| POST | `/query` | read | = `sql` |
| GET | `/schema` | read | `schema_columns`, `schema_functions` as JSON |
| GET | `/sessions` | read | list with the §7.2 filters, no text |
| GET | `/sessions/:id/raw` | read | paginated redacted raw records |
| GET | `/sessions/:id/tree` | read | the whole visible tree containing the session: ancestors to the root and all descendants, each node `{ session_id, title, harness, agent_type, parent_relation, user_email, started_at, status, message_count }`, via a recursive CTE over `parent_session_id`; hidden nodes are omitted and their visible children attach to the nearest visible ancestor with `gap: true` |
| GET | `/sessions/:id/similar` | read | registered only when embeddings are enabled |
| GET | `/me` | cookie or key | user, role, key metadata |
| GET/POST/DELETE | `/me/keys` | cookie session | create/revoke own keys; a key cannot mint keys |
| GET | `/repos`, `/installations` | read | |
| GET | `/health`, `/ready` | none | |
| GET | `/install.sh`, `/hook/manifest.json`, `/hook/<version>/hook.js` (root) | none | §6.1 |
| GET | `/auth/config` (root) | none | enabled login methods |

Admin (`/api/v1/admin`; owner admin + key `admin:*`, or admin cookie session):
`/users` (list, invite, role, ban), `/keys` (list, revoke), `/sessions/:id/visibility`,
`/sessions/:id/purge`, `/audit`, `/redaction/policies` (CRUD), `/redaction/test`,
`/redaction/rescan`, `/status`.

---

## 8. MCP

### 8.1 Transport
`POST /mcp`, `StreamableHTTPServerTransport` stateless (`GET`/`DELETE` → 405), raw
request via `reply.hijack()`. Bearer API key. Clients may cache `tools/list`; nothing
depends on re-listing.

### 8.2 Catalog: static, permission-filtered
User tools (`sessions:read`): `search`, `get`, `sql`, exactly as §7.2–7.4, schemas
generated from the shared zod. Admin tools, listed only when the caller has effective
admin authority (§7.5) and each authorized again on invocation: `set_visibility
(session_id, visibility, reason)`, `purge(session_id, reason)` (`destructiveHint`),
`audit(filters, limit, cursor)` (exact ids, UTC bounds), `status()`. No data-derived
schema content; discovery is `schema_columns` via `sql`. The `sql` description lists the
views by name with one line each and the discovery query; it does not enumerate every
column.

Every description opens with one governing sentence:
*"Only use this when the user asks about previous sessions or prior work; where possible
run multi-step investigation in a subagent that returns only findings with session ids."*

### 8.3 Repository snippet (the one guidance mechanism)
Printed by the installer for `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`:
```
## AgentCommons
Past agent sessions for this organization are indexed in AgentCommons (MCP server
`agentcommons`: search, get, sql). This session is recorded automatically. Only use it
when the user asks about prior sessions or prior work; for anything beyond a quick
lookup, run the investigation in a subagent and bring back only findings and session ids.
```

### 8.4 Client configuration
`claude mcp add -s user -t http agentcommons <URL>/mcp -H "Authorization: Bearer ac_…"`;
`codex mcp add agentcommons --url <URL>/mcp --bearer-token-env-var AGENTCOMMONS_API_KEY`;
Gemini `mcpServers` entry.

---

## 9. Auth, audit, moderation

### 9.1 Login
Better Auth (Prisma adapter; `admin`, `apiKey`, `genericOAuth`, `openAPI`). Configure
email/password and/or one social or OIDC provider (Appendix B); the server refuses to
boot with none. Optional `AUTH_ALLOWED_EMAIL_DOMAINS`. `AUTH_SIGNUP_MODE` `invite`
(default) | `open` | `closed`. **Bootstrap**: `pnpm db:seed --admin <email>` prints a
one-time credential; there is no "first matching email becomes admin". With
`EMAIL_TRANSPORT=none`, invite and reset links are shown to admins in the dashboard and
email verification is skipped only for invited accounts.

### 9.2 Authorization
`authenticate` accepts a cookie session or an API key (`Authorization: Bearer` /
`x-api-key`). `requirePermission`. Visibility lives in the `api_ro` views and the
repository layer, never in handlers. Read scopes cannot mutate; keys cannot mint keys.

### 9.3 Audit
`AuditEvent`: `id`, `ts`, `requestId`, `userId`, `apiKeyId`, `authMethod`, `ip`
(trusted-proxy chain resolution), `userAgent`, `transport` (`rest` | `mcp` | `web`),
`action`, `resourceType`, `resourceIds`, `statusCode`, `durationMs`, `detail` jsonb
(redacted; ≤ 8 KB). Written in the mutation transaction for writes, before the response
for reads; authentication failures audited; health and static assets not. Retention
`AUDIT_RETENTION_DAYS` (default 365). Append-only otherwise.

### 9.4 Public exposure
helmet, CORS to `PUBLIC_URL`, rate limits (ingest 600/min per key; read 300; `sql` 60;
MCP 120; auth 20/min per IP), secure cookies, CSRF origin checks, body limits, versioned
immutable client artifacts, optional AWS WAF in prod. `ac_` prefix for secret scanners.

### 9.5 Private and purge
**Private**: hidden from users everywhere (lists, search, SQL, `get`, MCP), including
from the uploader's own key; admin-only; reversible. Named "admin-only" in the UI.
**Purge**: within one transaction, serialized against ingest for the session: delete
RawRecord, Message, SessionFile, MessageChunk, SessionEmbedding, RedactionEvent; null
`title`, `firstPrompt`, `observedCommits`, `observedDiffStat`, `branch`; set tombstone;
subsequent appends → `409`; all workers check the tombstone. Kept: Session identity row,
IngestBatch, AuditEvent (whose `detail` is redacted text). Backups are outside the
manifest and documented as such.

---

## 10. Dashboard

Screens: Login; Sessions (search box + filter chips mirroring §7.2, result blocks exactly
as `search` returns them, and a list view whose columns are title, harness and version,
model, repo and branch, user, host, started, duration, messages, tool calls, observed
commits, status, with a column chooser and CSV export); Session detail (a header that
shows every field the `get` header carries with human labels and copyable ids, a
Details panel with token totals, models used, installation, cwd, entrypoint, start and
end commits, end reason, and links; a bounded virtualized transcript whose rows show
role, kind, tool name, timestamp, and the model when it changes, with token counts and
raw record id on hover; collapsible tool blocks and thinking toggle; a Raw tab paging
the redacted raw records; live tail over SSE with 5 s polling fallback while `ACTIVE`, parent and children as a linked list plus a tree view
fed by `/sessions/:id/tree`: the current session highlighted, subagents nested under
their parent with agent type and status, forks and spawned sessions labeled, every node
a link, hidden nodes shown as a gap marker for admins only; deep links `/s/<id>#<seq>`;
"Similar sessions" when embeddings are on); SQL page (editor with schema sidebar from
`/schema`, results grid, CSV export); My keys (create shows plaintext once; install
command with key inlined); Admin: Users, Keys, Audit (filters, CSV), Moderation
(visibility, purge with reason), Redaction (policies, test, rescan progress), Status
(ingest per day, redaction hits, failures, queue depth, embedding backlog and spend,
as charts and tables).

This is an enterprise operations tool, not a consumer app. No command palette, no
novelty. Quality bar: dense, consistent screens; results under 150 ms for typical
queries; every list paginated server-side with TanStack Table sort and filter; CSV
export on every admin table; deep links to `/s/<id>#<seq>` that survive in tickets and
chat; light and dark; skeletons and honest empty states; keyboard reachable;
accessibility (focus rings, ARIA on lists, no color-only meaning); every destructive
action confirms and records a reason.

**Copy.** Every string a user reads lives in `apps/dashboard/src/copy.ts` and is edited
with the vendored `no-ai-slop` skill (`.agents/skills/no-ai-slop/SKILL.md`) before merge:
lead with the fact, concrete nouns, short sentences, active voice, none of the banned
patterns. The rule covers public-facing text only: the README, dashboard copy, emails,
and error messages shown to users. Internal documents (this spec, CLAUDE.md, ADRs) are
exempt.

---

## 11. Embeddings (built in v1, disabled by default, internal to search)
`EMBEDDINGS_ENABLED=false` ships nothing observable. When on: chunks over `searchText`
of searchable messages (~512 tokens, 64 overlap, `js-tiktoken`), one session vector
(title + first prompt + last reply + files), stored in `MessageChunk`/`SessionEmbedding`
(`vector(D)`, HNSW cosine, one model per deployment), produced by pg-boss jobs with a
daily token budget (`EMBEDDINGS_DAILY_TOKEN_BUDGET`, default 5 M) and a catch-up job at
enable time. Adapters: `openai` (`text-embedding-3-small`) and `fake` first; `voyage`,
`bedrock`, `ollama` later. Effect on the surface: `search` fuses lexical and cosine rank
lists with RRF internally (no `mode` field); `similar_sessions(session_id, max_rows)`
and `GET /sessions/:id/similar` exist only when enabled; the dashboard shows "Similar
sessions" only then. Purge removes vectors. Nothing about embeddings is listed or
described to agents when the flag is off.

---

## 12. Edge cases and decisions
- **Hooks fire twice** (Codex loads user and project hooks files; verified): lock +
  `batchId`/record dedupe.
- **Stop fires while subagents run**: child sources are registered at `SubagentStart` and
  synced by the parent's uploader, so a child that never stops is still captured.
- **Subagent rows are not in the parent transcript** (verified): children are sessions
  linked `SUBAGENT`.
- **Crash, kill, lid close**: `ackedCursor` never advances without `202`; the next hook
  or a sweep resumes; `INACTIVE` after 6 h without receipt, shown as inactivity.
- **Codex `SessionEnd` clamp (3 s)**: hook mode finishes in ~150 ms; upload is detached.
- **No PATH in hooks**: installer writes the absolute node path.
- **Resume after days**: same session; `status` back to `ACTIVE`; a `SYSTEM META` marker;
  lifecycle applied in source order.
- **Compaction**: Claude `summary` → `SYSTEM TEXT`, searchable.
- **Detached HEAD, no repo, worktrees**: `branch` null; `repoUrl` null; `repoRoot` is the
  worktree root (`--show-toplevel`), `repoUrl` identifies the repository.
- **Git observations are not attribution**: `startCommit..endCommit` can include other
  processes' commits or be invalidated by rebases; columns are named `observed*`.
- **Transcript shorter than cursor** (rotation): reset to 0, dedupe.
- **Two keys, one session**: `409` + audit; admin override.
- **Timestamps**: source kept when valid, `receivedAt` always; never identity.
- **Codex boilerplate** (`base_instructions`, developer messages): `META`, not searchable.
- **Images**: placeholders.
- **Oversized records**: sanitized leaves, valid JSON.
- **Pre-install sessions**: a session first observed after install (including a resumed
  old one) syncs from cursor 0; disk is never scanned for unknown sessions (ADR 0008).
- **Gemini rewrites its file**: `json-document` reader; mutation semantics captured before
  the adapter is written (§5.4). **pi branches in place**: stored with `parentId`; the
  transcript view follows the active leaf.
- **Very long sessions**: all reads are bounded and paged; nothing loads a session whole.
- **Not captured**: what the harness never writes to disk; images.

---

## 13. Infrastructure
Pulumi TypeScript with `@pulumi/awsx`; stacks `dev`, `prod`; region and hostname are
config. VPC (2 AZ; one NAT in dev), ECR, `awsx.ecs.FargateService` behind
`awsx.lb.ApplicationLoadBalancer` (idle 120 s), one-off migration task before service
update, ACM + optional Route53, RDS PostgreSQL 16 (`db.t4g.micro`/`small`, gp3, encrypted,
7/35-day backups, deletion protection in prod), Secrets Manager (`DATABASE_URL`, two
reader URLs, `BETTER_AUTH_SECRET`, IdP secrets, embedding keys), CloudWatch logs and
alarms, GitHub Actions OIDC (`preview` on PR, `up dev` on main, `prod` behind approval).
Self-host without AWS: `docker-compose.yml` runs `api` + `db`. Development:
`docker-compose.dev.yml` (db only) + `pnpm dev`.

---

## 14. Local development
`docker compose -f docker-compose.dev.yml up -d`; `pnpm install`; `pnpm db:migrate`;
`pnpm db:seed --admin you@example.com` (prints a one-time credential); `pnpm dev` (API
3000, dashboard 5173 proxying `/api`, `/auth`, `/mcp`); `pnpm hook:link` installs the
local shim against `http://localhost:3000` with a seeded key.

## 15. Tooling and quality gates
TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); ESLint 9 +
typescript-eslint strict; Prettier; zod at every boundary; `prisma validate`/`migrate
diff`; knip; Dependabot; committed OpenAPI diffed in CI. Git hooks via Husky:
`pre-commit` lint-staged (eslint --fix, prettier, prisma format, redactor over staged
fixtures, reminder to run `/no-ai-slop` on README or `copy.ts` changes); `pre-push`
typecheck, unit tests, OpenAPI check, `spec:check` (§0); `commit-msg` commitlint. CI runs
the same.

---

## 16. Verification

### 16.1 Requirements
1. **Real database, real artifacts.** Integration tests run on Postgres via
   testcontainers; shim tests run the built `dist/hook.js` as child processes with the
   captured hook payloads; installer tests run `install.sh` in clean containers.
2. **Invariants over ceremony.** Tests target the properties that matter: record
   identity and source order under retries and reordering; `ackedCursor` only advances on
   `202`; one pending batch; lock takeover after owner death; kill-point tests at every
   state transition (before send, after send before ack, after ack before cursor write);
   duplicate terminal events; delayed `end` after resume; purge-versus-ingest race and
   tombstone enforcement; unpaired tool results withheld; oversized records sanitized;
   visibility through every view, function, and derived column for user and admin
   roles; admin-owned `read`-only keys see public only; guard allowlist against an
   injection corpus incl. `pg_catalog`, `SET`, `set_config`, `SET ROLE`; `api_ro`
   contract snapshot (columns, types, `security_barrier`).
3. **Search quality**: `fixtures/search-golden.yaml`, 30 question → session pairs over
   the fixture corpus including identifiers, error strings, long outputs, and failure
   tails; top-3 hit rate must not drop.
4. **Contract tests generate Appendix C**: tool schemas and example responses in this
   document are emitted from the same fixtures the tests assert.
5. **Live harness canary**: nightly and on any adapter change, install on a runner with
   the supported harnesses, run scripted sessions (`claude -p` with a tool call and a
   subagent; `codex exec` with `--dangerously-bypass-hook-trust`, stdin redirected), and
   assert per a **capability matrix** (subagents only where the harness has them): session
   row, prompt, tool call/result, links, observed git state, `search` finds the prompt,
   `get` returns the header, MCP lists the tools for user and admin keys. Payload
   compatibility is checked as required fields and types, not byte equality. Gemini
   runs with `GEMINI_API_KEY`, pi with a provider key.
6. **Feature flags**: the suite runs with embeddings off (default) and on with `fake`;
   nothing else is matrixed.
7. **Browser verification**: Playwright over every dashboard route, light/dark, 1440/390:
   screenshot baselines, `@axe-core/playwright` (no serious/critical), console or network
   errors fail, layout assertions (no horizontal overflow, no clipped transcript rows,
   empty states have copy). Nightly and on dashboard PRs, an agent with browser control
   walks the core flows as a new user and files a findings report; `blocking` findings
   fail the job.
8. **Done** means all of the above green, plus a dogfooding session on this workstation
   visible in the dashboard and found by an agent, for every supported harness.

### 16.2 Suites
Unit (Vitest): redaction rules and policy composition; normalizers as snapshots over
`fixtures/transcripts/`; link rules; metadata extraction; searchable decision; formatter;
shim state machine with fake filesystem and a fake server. Integration: everything in
16.1(2), ingest idempotency, search semantics (filters, arrays, since/until on message
time, per-session cap, excerpts, cursor determinism), `get` bounds and continuations, `/sessions/:id/tree` (depth 3 with mixed relations,
hidden-node gaps for users vs. admins),
`sql` shapes and errors, auth matrix, audit atomicity, admin endpoints, redaction
test/rescan completeness (raw → derived equality). E2E: full stack via compose; shim
against fixtures with server down/up; installer in Debian/Node 20 containers with bash,
zsh, fish (macOS on a macOS runner); MCP client for user and admin keys; Playwright.

---

## 17. Build order
Dependency order for implementation, not a shipping schedule. Each step carries its §16
verification; the whole spec is done when §16.1 item 8 holds.
1. Scaffold: monorepo, tooling, compose files, Prisma + hand-written SQL, CI, Pulumi.
2. Core: schemas, redaction and policies, normalizers (Claude Code and Codex from the
   captured fixtures; Gemini CLI and pi after capturing their contracts live), links,
   metadata, searchable decision, formatter.
3. API: Better Auth, effective authority, ingest with source identity, services,
   `/search`, `/sessions/:id`, `/query`, `/schema`, admin endpoints, OpenAPI + client,
   installer artifacts.
4. Shim + installer: state machine, readers, harness table for all four, pi extension,
   install/doctor/uninstall.
5. MCP: static registry, three tools, admin tools, snippet.
6. Embeddings behind the flag: chunker, `openai` and `fake` adapters, jobs, budget,
   fusion inside `search`, `similar_sessions`, catch-up.
7. Dashboard: all screens in §10, browser verification.
8. Deploy: `dev`, IdP, DNS, bootstrap, install on machines, canaries green for all four
   harnesses; then `prod`.

## 18. Out of scope
LLM session summaries and a Windows client. Everything considered and dropped during
design is recorded in ADR 0010 and is not planned.

## 19. Open questions
Production hostname, AWS account, DNS zone; Google OAuth client owner for the first
deployment; whether CI sessions use per-pipeline service users (default yes).

---

## Appendix A. Verified hook contracts (captured 2026-09-07)
Config shape (Claude `~/.claude/settings.json`; Codex `~/.codex/hooks.json` and
`<repo>/.codex/hooks.json`; Gemini `settings.json` with `timeout` in ms):
```json
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "/usr/bin/node /home/u/.agentcommons/hook.js claude", "timeout": 10 } ] } ] } }
```
**Claude Code 2.1.263** (`fixtures/hooks/claude-code-2.1.263-hook-events.jsonl`)
| event | fields |
|---|---|
| `SessionStart` | `session_id, transcript_path, cwd, hook_event_name, source` |
| `UserPromptSubmit` | `+ prompt, prompt_id, permission_mode` |
| `PreToolUse`/`PostToolUse` | `+ tool_name, tool_input, tool_use_id, prompt_id, permission_mode`; Post `+ tool_response, duration_ms`; in a subagent `+ agent_id, agent_type` (transcript_path is the parent's) |
| `Stop` | `+ prompt_id, permission_mode, stop_hook_active, last_assistant_message, background_tasks[], session_crons[]` |
| `SubagentStart` | `+ prompt_id, agent_id, agent_type` |
| `SubagentStop` | `+ agent_id, agent_type, agent_transcript_path, …` |
| `SessionEnd` | `+ prompt_id, reason` |
Fires in `-p` mode. Subagent path `<slug>/<sessionId>/subagents/agent-<agentId>.jsonl`.

**Codex 0.150.0** (`fixtures/hooks/codex-0.150.0-hook-events.jsonl`)
| event | fields |
|---|---|
| `SessionStart` | `session_id, transcript_path, cwd, hook_event_name, model, permission_mode, source` |
| `UserPromptSubmit` | `+ prompt, turn_id` |
| `PreToolUse`/`PostToolUse` | `+ tool_name, tool_input, tool_use_id, turn_id`; Post `+ tool_response` |
| `Stop` | `+ turn_id, stop_hook_active, last_assistant_message` |
| `SessionEnd` | `session_id, transcript_path, cwd, hook_event_name, reason` |
| `SubagentStart/Stop`, `PreCompact`, `PostCompact`, `PermissionRequest`, `Interrupt` | present in binary; payloads captured during implementation |
No hooks run without persisted trust (or `--dangerously-bypass-hook-trust`); `SessionEnd`
and `Interrupt` timeouts clamped to 3 s; `codex exec` reads stdin unless redirected;
`CODEX_HOME` relocates config; each hooks file loaded fires its hooks once.

**Gemini CLI 0.35.3** (`fixtures/hooks/gemini-cli-0.35.3-hook-events.jsonl`; `SessionStart`,
`SessionEnd` captured; tool/agent events from the reference: `BeforeAgent`/`AfterAgent`
`+ prompt` (After `+ prompt_response, stop_hook_active`), `BeforeTool`/`AfterTool`
`+ tool_name, tool_input, mcp_context, original_request_name` (After `+ tool_response`);
all events `session_id, transcript_path, cwd, hook_event_name, timestamp`). Headless runs
need `GEMINI_API_KEY`; the individual Code Assist login is rejected by this client.

**pi 0.73** (docs): events `session_start {reason, previousSessionFile}`, `input {text,
source}`, `tool_result {toolName, toolCallId, isError}`, `agent_end {messages}`,
`session_shutdown {reason, targetSessionFile}`; `ctx.sessionManager.getSessionFile()`;
extensions from `~/.pi/agent/extensions/`, `.pi/extensions/`, or `settings.json`
`packages` (`npm:`/`git:`).

## Appendix B. Configuration
| variable | default | purpose |
|---|---|---|
| `PUBLIC_URL` | required | origin for CORS, cookies, callbacks, installer |
| `DATABASE_URL`, `DATABASE_READER_USER_URL`, `DATABASE_READER_ADMIN_URL` | required | app role and the two reader roles |
| `BETTER_AUTH_SECRET` | required | |
| `AUTH_EMAIL_PASSWORD_ENABLED` | `true` | |
| `AUTH_SOCIAL_PROVIDER` + `AUTH_<PROVIDER>_CLIENT_ID/SECRET` | empty | one of Better Auth's built-ins |
| `AUTH_OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET/SCOPES` | empty | generic OIDC |
| `AUTH_ALLOWED_EMAIL_DOMAINS` | empty | |
| `AUTH_SIGNUP_MODE` | `invite` | `open`, `invite`, `closed` |
| `EMAIL_TRANSPORT` + `SMTP_*`/`SES_REGION` | `none` | |
| `TRUST_PROXY` | ALB CIDRs | trusted proxy chain |
| `REDACTION_EXTRA_PATTERNS` | `[]` | seeds `RedactionPolicy` rows |
| `AUDIT_RETENTION_DAYS` | `365` | |
| `EMBEDDINGS_ENABLED`, `EMBEDDINGS_PROVIDER`, `EMBEDDINGS_MODEL`, `EMBEDDINGS_DIMENSIONS`, `EMBEDDINGS_DAILY_TOKEN_BUDGET` | `false`, `openai`, `text-embedding-3-small`, `1024`, `5000000` | §11 |
| `SEARCH_CONTEXT_DEFAULT`, `SEARCH_LIMIT_DEFAULT` | `1`, `5` | |
| `LOG_LEVEL` | `info` | |
| client `config.json`: `realtime`, `syncIntervalSeconds`, `syncBytesThreshold`, `disabledPaths`, `installationId` | `true`, `10`, `65536`, `[]`, generated | §6 |

## Appendix C. What the agent sees (regenerated by contract tests)

`tools/list` for a user key: `search`, `get`, `sql`. For an admin key: plus
`set_visibility`, `purge`, `audit`, `status`.

```jsonc
{ "name": "search",
  "description": "Search this organization's past coding-agent sessions. Only use this when the user asks about previous sessions or prior work; where possible run multi-step investigation in a subagent that returns only findings with session ids. Returns message windows grouped by session; use session_id and seq with get or sql. query uses PostgreSQL websearch syntax (\"phrase\", -word, OR) and may be empty when filters are given.",
  "inputSchema": { "type": "object", "required": ["query"], "properties": {
    "query": { "type": "string" },
    "filters": { "type": "object", "additionalProperties": false, "properties": {
      "repo_name":  { "anyOf": [ { "type": "string" }, { "type": "array", "items": { "type": "string" } } ] },
      "branch":     { "anyOf": [ { "type": "string" }, { "type": "array", "items": { "type": "string" } } ] },
      "user_email": { "anyOf": [ { "type": "string" }, { "type": "array", "items": { "type": "string" } } ] },
      "tool_name":  { "anyOf": [ { "type": "string" }, { "type": "array", "items": { "type": "string" } } ] },
      "file_prefix":{ "anyOf": [ { "type": "string" }, { "type": "array", "items": { "type": "string" } } ] },
      "role":       { "anyOf": [ { "enum": ["USER","ASSISTANT","TOOL_RESULT","SYSTEM"] }, { "type": "array", "items": { "enum": ["USER","ASSISTANT","TOOL_RESULT","SYSTEM"] } } ] },
      "session_id": { "anyOf": [ { "type": "string" }, { "type": "array", "items": { "type": "string" } } ] },
      "since": { "type": "string", "format": "date-time" }, "until": { "type": "string", "format": "date-time" } } },
    "context": { "type": "integer", "minimum": 0, "maximum": 3, "default": 1 },
    "limit":   { "type": "integer", "minimum": 1, "maximum": 50, "default": 5 },
    "cursor":  { "type": "string" } } } }
{ "name": "get",
  "description": "Read one session by session_id: compact header (title, repo_name, branch, user_email, times, message_count, visible parent/children) and messages in order, each content bounded with content_cursor for the rest; from/to bound seq; next continues. Only use when the user asks about prior work; prefer a range.",
  "inputSchema": { "type": "object", "required": ["session_id"], "properties": {
    "session_id": { "type": "string" }, "from": { "type": "integer", "minimum": 0 }, "to": { "type": "integer", "minimum": 0 }, "cursor": { "type": "string" } } } }
{ "name": "sql",
  "description": "One read-only PostgreSQL SELECT over the session index (schema api_ro), for counts, facets, joins, and anything search's filters cannot express. Views: sessions, messages, session_files, session_observed_commits, session_tools, users, installations, repos. Functions: search_messages(q) -> (session_id, seq, rank). Columns: SELECT * FROM schema_columns WHERE view_name = 'sessions'. Limits: 500 rows, 5 s. Only use when the user asks about prior work.",
  "inputSchema": { "type": "object", "required": ["sql"], "properties": { "sql": { "type": "string" } } } }
```

`search({ query: "rate limiter", filters: { repo_name: "cunningham" } })` (text rendering):
```
2 sessions

── 0192a3f0-7c1e-7d1a-9b0e-3f2a1c9d4e55 · Add token-bucket rate limiter to API gateway
   cunningham · feat/rate-limit · ana@example.com · 2026-08-21 14:02
   seq 1  USER      ▶ …implement a **rate limiter** for the public API using a token bucket so bursts…
   seq 2  ASSISTANT   I'll look at how the gateway routes are structured first…
   seq 3  TOOL_USE    Read src/api/gateway.ts
   seq 17 TOOL_USE    Edit src/api/middleware/rateLimit.ts
   seq 18 ASSISTANT ▶ …added **RateLimiter** middleware in src/api/middleware/rateLimit.ts and wired…
   seq 19 TOOL_USE    Bash pnpm test

── 0192b7c1-… · Investigate 429s from upstream
   cunningham · main · raphael@example.com · 2026-08-03
   seq 6  TOOL_USE    Bash curl -i https://…
   seq 7  TOOL_RESULT ▶ …HTTP 429 Too Many Requests: **rate limit** exceeded for key…
   seq 8  ASSISTANT   The upstream is throttling us at 100 req/min…

▶ hit. get(session_id, from, to) expands; sql joins on session_id/seq.
```
`get({ session_id: "0192a3f0-…", from: 15, to: 20 })`:
```
Add token-bucket rate limiter to API gateway
Claude Code 2.1.263 (cli) · claude-opus-5 · ana@example.com on MacBook-Pro
cunningham · feat/rate-limit · apps/api · 68bde3a → c41d02f · 2026-08-21 14:02 → 14:54 · ENDED (exit)
118 messages · 41 tool calls · 84k in / 12k out tokens · tools: Read, Edit, Bash, Grep · 7 files · 3 observed commits
Parent: none · Children: 0192a3f1-… (SUBAGENT, Explore), 0192a3f2-… (SUBAGENT, Explore)

seq 15 [14:21] ASSISTANT   Now I'll add the middleware…
seq 16 [14:21] THINKING    The token bucket needs a monotonic clock…
seq 17 [14:22] TOOL_USE    Edit src/api/middleware/rateLimit.ts  {"file_path":"src/api/middleware/rateLimit.ts","old_string":"…"}
seq 18 [14:22] TOOL_RESULT The file has been updated…
seq 19 [14:23] TOOL_USE    Bash pnpm test
seq 20 [14:23] TOOL_RESULT ✓ 14 tests passed …  [4 KB shown; content_cursor "m20:4096"]
```
`sql({ sql: "SELECT f.path, s.user_email, count(*) FROM session_files f JOIN sessions s ON s.id = f.session_id WHERE f.path LIKE 'src/auth/%' AND 'edit' = ANY(f.ops) AND s.started_at > now() - interval '30 days' GROUP BY 1,2 ORDER BY 3 DESC" })`:
```
11 rows (21 ms)
path                | user_email          | count
src/auth/session.ts | ana@example.com     | 4
…
```
Errors: unknown filter → `400 Unknown filter "repository". Valid: repo_name, branch,
user_email, tool_name, file_prefix, role, session_id, since, until.`; `sql` with
`DELETE` → `Rejected: only a single SELECT is allowed.`; unknown column → PostgreSQL
`42703 column "user" does not exist (position 8); see schema_columns`.
