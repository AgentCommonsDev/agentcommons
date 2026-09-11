# AgentCommons — Specification

Status: v5, local ClickHouse acceptance verified 2026-09-08. ClickHouse replaces PostgreSQL trace storage under ADR0047. Current results and external configuration boundaries are recorded in
`docs/VERIFICATION.md`. Completion requires §16.1 item 8 and is not implied by requirement citations.
See `docs/reviews/codex-review-2026-09-07.md`; v2 is retained for comparison. Owner: rek7. First deployment: ZeroPath. Self-hostable with one or more organizations per
instance; each organization is an independent data and authorization boundary
(ADR 0011). Nothing organization-specific is hardcoded.

AgentCommons is a central, append-only index of coding-agent sessions that gives an
organization shared history, governance, and observability over its agents' work. Hooks in
each harness ship transcripts to one API; the API redacts secrets, normalizes the
transcript, links sessions, enforces organization policy, and exposes search, dashboards,
and SQL to agents (MCP) and people (dashboard) so work is not repeated, leaders can see
what agents are doing, controls are enforced centrally, and the team and its agents become
more effective.

Why a separate, self-hosted system: developer agent workflows run in terminals, IDEs,
and CI, not chat apps, so a bot tagged in Slack or one vendor's session memory misses
most of the work and ties the record to that vendor. Most agent work, including failing
tests and abandoned approaches, never reaches a PR; indexing it makes failures visible
where they happened. Versioned `CLAUDE.md`, `AGENTS.md`, and skills tell agents what to
do; this corpus holds the sessions that explain why.

Verified facts: hook contracts captured live on 2026-09-07 from Claude Code 2.1.263 (re-verified on 2.1.265 on 2026-09-08) and
Codex 0.150.0 and 0.153.4, Gemini CLI 0.35.3, and pi 0.73.1 (including tool and
lifecycle events). Payloads in `fixtures/hooks/`, summarized in Appendix A and
`docs/harness-capture-2026-09-07.md`.

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

Everything in this document is required for the implementation. There is no phased
shipping; §17 gives the dependency order, and §16 the verification each part must pass.
Cloud deployment is explicitly deferred until operator approval (ADR 0019).

- Capture Claude Code, Codex, Gemini CLI, and pi sessions automatically after a one-line
  install. Full transcripts including subagents and tool output, near-real-time, without
  slowing the agent. Durable: acknowledged cursors, one pending batch, spool, recovery.
  Gemini's and pi's hook contracts are captured live during implementation before their
  adapters are written; a harness is announced as supported when its canary is green.
- Redaction before any persisted write, with admin-managed policies (regex and a fixed
  allowlist of preinstalled secretlint rules) and a complete rescan.
- Sessions linked to parents (subagent, explicit fork, spawned).
- Three agent tools over MCP by default: `search`, `get`, `sql`. The dashboard tools are an
  opt-in key permission; admin keys additionally see four static admin tools.
- Semantic ranking implemented and shipped behind `EMBEDDINGS_ENABLED=false`, internal to
  `search`; no change to the agent surface when it flips (§11).
- Dashboard under `/app`: organization dashboards (Home is the default one), search and
  session list, transcript with live tail and inline subagent runs, IDE-style SQL page,
  install page, keys, embedded API reference, admin (users, keys, visibility, purge,
  audit, redaction policies, status, settings).
- Public landing page bundled with the app, responsive on mobile and desktop, with
  the generated AgentCommons logo. Public mode includes search-engine metadata,
  `robots.txt`, `sitemap.xml`, `llms.txt`, and `llms-full.txt`. Customer mode disables
  discoverability; tenant data never enters public artifacts (§10.1).
- Scoped API keys, database-enforced visibility, purge with a complete manifest, audit
  written atomically with mutations.
- Operator-created organizations, email access lists, membership roles, and an
  organization switcher. Keys, sessions, queries, policies, jobs, and audit are scoped
  to one organization. SaaS mode adds verified public signup, organization onboarding,
  monthly usage limits, Stripe subscriptions and welcome emails (§9.6). CSV imports,
  SCIM and automated suspicious-behavior detection remain outside this implementation.
- AWS deployment with Pulumi; Docker Compose for self-hosting and development.

Out of scope: LLM session summaries and a Windows client.

---

## 2. Architecture

**Storage decision (ADR0047).** ClickHouse is the only permanent trace and vector
store. PostgreSQL retains native identity, organization/access settings, audit,
billing/admission, compact session publication/lifecycle controls, and pg-boss.
Ingestion commits a bounded temporary redacted outbox with admission and audit before 202. Jobs project versioned data into ClickHouse and publish a complete revision;
pending work is visible as pending, and the outbox survives terminal queue failures.
Fresh visibility/purge fences remain authoritative while cleanup is asynchronous.
PostgreSQL trace tables/views/reader pools, pgvector and the PostgreSQL query dialect
are superseded and removed, with no dual-store compatibility or historical backfill.
The runtime and verification contracts below use this storage decision.

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
 people ── dashboard ──────────────────────────►  PostgreSQL control + ClickHouse traces       │
                                               └────────────────────────────────────────┘
```

Ingest: hook fires → hook mode records intent → detached uploader ships one batch →
server redacts and commits admission, audit and a temporary outbox → `202` → uploader
advances the acknowledged cursor. A durable worker projects ClickHouse rows, then
publishes their revision and removes the outbox in one control transaction.

Read: dashboard (cookie) or agent (API key, REST or MCP) → auth → service → native ClickHouse reader
whose row policies enforce current visibility and publication → audit → response.

---

## 3. Monorepo, libraries, internal architecture

```
agentcommons/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.js
  docker-compose.yml              self-host: api + PostgreSQL + ClickHouse; dev: both databases
  .github/workflows/ci.yml
  apps/api                        Fastify: REST, MCP, auth, audit, worker, static dashboard
    src/services/                 SearchService, SessionService, QueryService, IngestService, AdminService
    src/routes/                   REST routes, zod schemas from packages/core
    src/mcp/                      tool registry (explicit), text formatters
    public/                       install.sh, hook manifest
  apps/dashboard                  Vite + React + Tailwind + shadcn/ui; OpenAPI-generated client
    src/copy.ts  src/copy/*.ts    every user-facing string, composed per area
  packages/db                     Prisma identity/control schema and native PostgreSQL migrations
  packages/traces                 ClickHouse corpus, native reader policies, views, indexes and migrations
  packages/core                   zod schemas, normalizers, redaction, link rules, formatters
  packages/hook                   zero-dependency shim → dist/hook.js
  packages/pi-extension           pi bridge emitting canonical behaviors
  infra/                          Pulumi TypeScript (@pulumi/awsx): dev, prod
  fixtures/hooks  fixtures/transcripts  fixtures/search-golden.yaml
  docs/SPEC.md  docs/adr/  docs/reviews/
```

Dependency rules: `hook` has no runtime dependencies. `core` depends on zod and
secretlint. `api` depends on `core`, `db`, and `traces`. `dashboard` depends on `core` types and the
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
data       Prisma control · official ClickHouse client and native reader policies · pg-boss
```

- **Shared schemas**: `packages/core/schemas/` holds zod for `search`, `get`, `sql`
  inputs and outputs, the ingest envelope, and filters. REST bodies, MCP `inputSchema`
  (via native Zod 4 `z.toJSONSchema`), OpenAPI, and the dashboard client derive from them.
- **Explicit adapters, no framework.** REST routes are registered with Fastify; MCP tools
  are registered with the SDK. Each registration is a few lines: schema, permission,
  service call, formatter. A static service registry supplies MCP definitions directly
  from the shared schemas; there is no route introspection or params/query merging.
- **One formatter** (`packages/core/format/`) renders search blocks, session headers,
  transcripts, and SQL tables to text and JSON; MCP and dashboard "copy as text" use it.
- **One caller context, one audit path.** Services receive `{ organizationId, userId, role,
apiKeyId, permissions }` and return `{ result, audit }`. Mutation audit rows are written
  inside the mutation's transaction; read audit rows are written before the response is
  sent. Adapters never write audit rows. Effective authority (§7.5): admin visibility and
  admin tools require current organization admin/owner membership and an `admin:*` key permission.
- **One shim, harnesses as data.** `hook.js` has a `HARNESSES` table; each entry is
  event mapping, reader name, config paths, MCP registration shape. All behavior is
  shared (§6). pi has no MCP registration; its installed extension bridges the same
  catalog as native tools (§8.4).
- **Adding a harness, checklist**: capture hook payloads live into `fixtures/hooks/`;
  sanitize a transcript into `fixtures/transcripts/<harness>/`; add the enum value; write
  `packages/core/normalizers/<harness>.ts` with snapshot tests; add one `HARNESSES`
  entry with its config, MCP and global instructions paths (and a reader only for a new
  storage format); add the harness to the live canary
  (§16). Support is announced only when the canary is green.
- **Generated, not written**: OpenAPI from routes, dashboard client from OpenAPI, MCP
  input schemas from zod, Better Auth models from its generator, Appendix C examples from
  contract-test fixtures.

### 3.2 Libraries (use, don't build)

Server and repository development require Node 22.12 or newer; the installed hook
supports Node 20. Secretlint profiling is disabled through its native profiler API
for the long-running server (ADR 0015).
Fastify 5 (+helmet, cors, rate-limit, static, compress) · zod, `fastify-type-provider-zod`,
`@fastify/swagger` + `@scalar/fastify-api-reference` · `openapi-typescript` + `openapi-fetch` · Better Auth (Prisma adapter;
`admin`, `organization`, `apiKey`, `genericOAuth`, `openAPI` plugins) · Prisma; PostgreSQL 16 control; ClickHouse 26.8.2.7 with the official Node client · pg-boss · secretlint (`@secretlint/core`,
preset-recommend, rule-pattern) · `@clickhouse/parser` · `@modelcontextprotocol/sdk` ·
`uuid` (its `v7` export) · pino · `@t3-oss/env-core` · React 19, Vite, Tailwind, shadcn/ui, TanStack
Router/Query/Table/Virtual, `shiki` · Pulumi + `@pulumi/awsx` · Vitest,
`@testcontainers/postgresql`, Playwright, `@axe-core/playwright` · ESLint 9 +
typescript-eslint strict, Prettier, knip, Husky, lint-staged, commitlint.

---

## 4. Data model

Domain IDs are UUIDv7 unless stated. Domain timestamps are `timestamptz`; Better Auth
models retain the types emitted by its generator. Better Auth owns `user`, `session`
(web), `account`, `verification`, `apikey`, `organization`, `member`, and `invitation`.

### 4.1 Identity

- **User**: global Better Auth identity. Global `User.role` does not grant access to
  an organization's data. Membership determines application authority.
- **Organization / Member / Invitation**: Better Auth organization plugin; membership
  roles `owner`, `admin`, `member`. Instance operators create organizations through
  the bootstrap CLI. Admins add people by email to the organization membership list
  before first login. SaaS verified accounts may create organizations through native
  onboarding (§9.6). There is no invitation-email flow.
- **ApiKey**: Better Auth API Key plugin with native organization references; bound
  to one organization for its lifetime; `permissions`
  `{ sessions: ["ingest" | "read"], tools: ["dashboards"], admin: ["*"] }` (`tools` names
  the opt-in MCP tool groups, §8.2; any member may grant it); hashed; prefix `ac_`; a user
  may hold many. `ApiKeyOwner` stores the issuing user's identity and organization as
  immutable attribution alongside the plugin-owned key. `admin:*` is grantable only
  by organization owners/admins and remains effective only while the issuing user has
  that membership. Removal or suspension invalidates every key issued by that member
  in that organization; other organizations are unaffected. Keys never mint keys.
- **Installation**: `id` (random UUID generated by the installer and stored in
  `config.json`), `hostname`, `osUser`, `platform`, `arch`, `firstSeenAt`, `lastSeenAt`,
  `toolsEnabled` (organization-admin switch for a staged rollout, §10; default true),
  `hookSha256` (digest of the `hook.js` that produced the latest upload, §6.2).
  Replaces hardware fingerprinting; attribution is by key and installation. Its key
  is `(organizationId, id)` so one machine may connect to multiple organizations.

Every content, receipt, audit, policy and embedding row carries an organization scope.
PostgreSQL composite foreign keys enforce control-plane parent, installation, key and
receipt ownership. Native ClickHouse policies enforce corpus organization, current
publication/generation, visibility and purge; repository writes validate the session
scope before publication. ClickHouse does not provide cross-database foreign keys.
Session identity is unique on organization, harness and canonical native identity.
Jobs contain an organization ID and re-authorize their target before processing.

### 4.2 Session

The following names describe the logical session. PostgreSQL `TraceSessionControl`
holds identity, ownership, lifecycle, parent links, visibility/purge and publication
checkpoints. The native ClickHouse `sessions` table holds versioned display metadata,
observations and counters. Canonical public names are the snake_case columns in §7.4;
physical columns and native types are declared in `packages/traces/src/schema.ts`.

| column                                                         | notes                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                           |                                                                                                                                                                                                                                                                                                             |
| `harness`                                                      | `CLAUDE_CODE`, `CODEX`, `GEMINI_CLI`, `PI`                                                                                                                                                                                                                                                                  |
| `harnessSessionId`                                             | native id; Claude subagents `<sessionId>:agent-<agentId>`; unique with `organizationId, harness`                                                                                                                                                                                                            |
| `organizationId`                                               | immutable tenant; taken from authenticated key, never ingest JSON                                                                                                                                                                                                                                           |
| `harnessVersion`, `entrypoint`                                 | from the transcript (`version`/`cli_version`; `entrypoint`/`originator`)                                                                                                                                                                                                                                    |
| `userId`, `ingestApiKeyId`, `installationId`                   | owner from the first ingesting key                                                                                                                                                                                                                                                                          |
| `cwd`, `repoRoot`, `cwdRelative`                               | `git rev-parse --show-toplevel` (worktree root); cwd relative to it                                                                                                                                                                                                                                         |
| `repoUrl`, `repoName`                                          | normalized `host/org/repo` from `origin` with credentials and `.git` stripped; null outside a repo                                                                                                                                                                                                          |
| `branch`, `startCommit`, `endCommit`                           | branch null when detached                                                                                                                                                                                                                                                                                   |
| `observedCommits`, `observedDiffStat`, `dirtyFileCount`        | observations at session end (`startCommit..endCommit`, `git diff --shortstat`); labeled _observed_, not attributed (§12)                                                                                                                                                                                    |
| `model`, `modelsUsed`                                          |                                                                                                                                                                                                                                                                                                             |
| `startedAt`, `endedAt`, `lastActivityAt`                       | `startedAt` uses the normalized source timestamp when available, otherwise first receipt time; publication synchronizes the compact control timestamp for tree ordering and cursors. `lastActivityAt` is server receipt time.                                                                               |
| `status`, `endReason`                                          | `ACTIVE`, `ENDED`, `INACTIVE` (no receipt for 6 h; displayed as inactivity, not death)                                                                                                                                                                                                                      |
| `lifecyclePos`, `lifecycleAt`                                  | persisted source ordering markers for lifecycle replay                                                                                                                                                                                                                                                      |
| `normalizerContext`, `projectedContext`                        | redacted latest source context and last successfully projected context; a pending pi leaf retains the prior projection, and rescan rebuilds that prior branch from redacted raw records; neither context is exposed through `api_ro`                                                                        |
| `title`, `firstPrompt`                                         | Claude `aiTitle` → Codex thread name → first prompt (120 chars); first prompt ≤ 4 KB, redacted                                                                                                                                                                                                              |
| `parentSessionId`, `parentRelation`, `parentNativeRef`         | relation ∈ `SUBAGENT`, `FORK`, `SPAWNED`; `parentNativeRef` keeps the harness's reference when the parent has not been ingested; resolved on parent arrival                                                                                                                                                 |
| `parentToolUseId`                                              | projected identity of the parent's tool call that spawned this child, equal to that call's `tool_use_id` message field; known only from the parent transcript (§5.5) and resolved in either arrival order through `TraceSpawnControl`; null for pi forks, Gemini, env-spawned sessions and roots (ADR 0052) |
| `agentType`                                                    | Claude `agent_type`; Codex `agent_role` when configured, otherwise the hook-reported `agent_type`; Codex nicknames are random display names and are never used                                                                                                                                              |
| `visibility`, `purgedAt`, `purgedByUserId`, `purgeReason`      |                                                                                                                                                                                                                                                                                                             |
| `messageCount`, `toolCallCount`, `inputTokens`, `outputTokens` | maintained from newly accepted records only                                                                                                                                                                                                                                                                 |
| `toolsUsed`                                                    | `text[]`                                                                                                                                                                                                                                                                                                    |

**SessionFile** (`sessionId`, `path` repo-relative, `ops text[]`): from explicit file
tools only (Claude `Read/Edit/Write/MultiEdit/NotebookEdit`; Codex `apply_patch`;
Gemini `read_file/write_file/replace`; pi `read/edit/write`). Shell commands are not
parsed. ClickHouse stores the full path and operations, keyed by its SHA-256 identity
within organization, session, generation and revision; no PostgreSQL text index limits
apply to the corpus.

Relationships are an adjacency list: `parentSessionId` plus `parentRelation`. Root,
depth, and descendants are computed with recursive SQL. Resume is a lifecycle event on
the same session, not an edge. Forks are recorded only from explicit native metadata.

Control identity uses the unique `(organizationId, harness, nativeIdentity)` key and
an index for unresolved parent identity. Native corpus tables use ReplacingMergeTree
keys prefixed by organization and session, with entity identity, generation and
revision. Canonical views choose the newest published, non-deleted version. The native
text index uses the shared English Snowball token expression (§7.1); optional vectors
have native cosine HNSW indexes (§11). There are no PostgreSQL corpus/GIN indexes.

### 4.3 Records and messages

**RawRecord**: `id`, `sessionId`, `pos bigint` (source position: byte offset for JSONL,
array index for JSON documents), `sourceVersion int` (0 for immutable records;
increasing persisted observation version for rewritten JSON messages), `key text` (native record id when present: Claude
`uuid`, Codex `ordinal`, Gemini message `id`, pi entry `id`), `recordType`, `payload`
JSON encoded in native String columns (redacted and, if oversized, sanitized per §4.4), `redactionContext` JSON, `ingestBatchId`, `receivedAt`.
`redactionContext` is server-owned: SHA-256 tool-call identity hashes with durable sensitive-file
classification, plus canonical identity locations needed across rescans. It contains no
original redacted value, is never accepted from the ingest envelope, and is not returned
by the raw endpoint. Sanitization removes identity locations whose payload field was
omitted; sensitive-call classification remains available for later results.
Unique `(sessionId, pos, sourceVersion)` only where key is null; unique `(sessionId, key)` where key is not null, comparing non-null keys through the stable canonical identity digest (§5.2, ADR 0025).
Mutable JSON record keys are `nativeId:sourceVersion:contentHash`; only the latest sourceVersion at
each position contributes to the current message projection and counters. Prior raw
versions remain stored. **Source order is `pos`.** Distinct native keys can reuse a
position after JSONL truncation. Ties sort by sourceVersion and canonical SHA-256
native-key identity (keyless first), preserving each record's block order. This is a
deterministic presentation tie-break, not reconstructed chronology across truncated
files; the reader supplies no generation (ADR 0024). Append-only except redaction rescans
and purge. Repeated identical versions never add counts (ADR 0013).

**Message**: native `id` = UUIDv5(`sessionId`, `rawRecordId`, block index), so the same source
record always yields the same message ids. Receipt-backed resume markers instead use
UUIDv5 with the session namespace and `resume:<batch-id>:0` name. `rawRecordId` is
nullable; `ingestBatchId` is nullable; the canonical projection requires exactly one source,
and receipt-backed rows must be non-searchable `SYSTEM META` with block index 0.
The worker resolves both source references within the same organization and session. `sessionId`, `blockIndex`, `seq` (dense
ordinal assigned by source position/version, canonical native-key identity, then block index, recomputed for the session when an earlier `pos`
arrives late, which the uploader's in-order rule makes rare; resume markers fall after
native blocks at the receipt watermark and before higher positions, with same-watermark
markers ordered by source event time then stable marker ID), `role` (`USER`,
`ASSISTANT`, `TOOL_RESULT`, `SYSTEM`), `kind` (`TEXT`, `THINKING`, `TOOL_USE`,
`TOOL_RESULT`, `META`), `content`, `toolName` (on both use and result), `toolUseId`,
`toolInput` JSON, `model`, `timestamp` (source; null if missing or invalid),
`receivedAt`, `inputTokens`, `outputTokens` (adapter-defined; null when unknown; retries
never add), `agentId`, `searchable`, `searchText` (§7.1). Native text indexing and
latest-version selection share the same expression and publication boundary.

**TraceReceipt** (logical ingest batch): primary key `(organizationId, id)`; `id`, `sessionId`, `apiKeyId`, `userId`, `installationId`, `ip`,
`userAgent`, `behavior`, `startResume` (explicit native resume, default false), `nativeEvent`, `receivedAt`, `recordCount`, `duplicateCount`,
`byteCount`, `redactionCount`, `durationMs`.
`lifecycleApplied` records the server's lifecycle decision from the same transaction:
true for an applied start/end, false for ignored lifecycle events and sync. Clients cannot set it.
Persisted receipt fields `cursor` (SHA-256 digest of the opaque cursor), `acceptedCount`, `sourcePos`, and `sentAt` allow
the server to return the committed result on replay and order lifecycle events.
**RedactionEvent**: `ingestBatchId`, `sessionId`, `policyId`, `count`. Never the value.
**RedactionPolicy**: `id`, `name`, `kind` (`REGEX` | `SECRETLINT_RULE`), `pattern` +
`flags` or `ruleId` + `options` (from a fixed allowlist of preinstalled rules), `replacement`
(default `[REDACTED:<name>]`), `enabled`, `builtin`, `createdByUserId`, timestamps.
**AuditEvent**: §9.3. **MessageChunk**, **SessionEmbedding**: §11 (present, unused when
the flag is off). `EmbeddingDeployment` pins provider/model/dimensions globally.
Organization-scoped `EmbeddingState` stores session source fingerprints and leases;
`EmbeddingBudget` stores UTC-day reservations, actual usage and conservative cost;
`EmbeddingAttempt` records each reserved indexing/query dispatch and outcome (§11).

### 4.4 Full sessions, size, and sanitization

Every source record is stored. Records are parsed before any size handling: redaction
runs on original text, then the shared text boundary replaces unpaired UTF-16 surrogates
with U+FFFD and renders NUL as the six printable characters `\u0000`, because PostgreSQL
text/jsonb cannot store them. This idempotent normalization applies to transcript text,
metadata, unknown object keys and audit detail; valid Unicode remains unchanged.
Declarative policy strings reject incompatible literal characters rather than changing
regex semantics (escaped `\x00` remains supported). See ADR 0026. Redaction
runs first, then if a record's serialized payload exceeds 1 MB, oversized string leaves
are replaced by `[agentcommons: N bytes omitted, sha256 …]` while structure stays valid
JSON. If structure or object keys alone exceed the limit after string replacement,
store a record-wide omission object with the redacted serialized size and hash; source
identity remains in RawRecord columns. Storage is therefore _redacted and sanitized
source_, not byte-exact. Base64 image data URIs, native base64 sources, inline image
data, and image blocks become `[image: mime, N bytes]`. Requests: 10 MB compressed, 50 MB decompressed,
streamed. Harnesses already cap tool output (Claude `Read` 2000 lines, Bash ~30 KB), so
sanitization is rare.

### 4.5 Prisma notes

Prisma owns native identity and compact control models. ClickHouse columns, text/vector
indexes, canonical views, grants and row policies are defined once in `packages/traces`.
PostgreSQL has no trace corpus, pgvector extension, SQL reader roles or trace functions.
Fresh migrations create the final control schema without a corpus backfill.

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
  "start": { "resume": true } | null,              // optional; native source/reason says resume; only on start
  "batchId": "0192…",                             // client UUID; idempotent per batch
  "installationId": "…", "sentAt": "…",
  "hook": { "sha256": "…", "extensionSha256": "…" | null },   // digests of the installed hook.js and pi-extension.mjs (§6.2); stored on the installation
  "sourcePos": 52990,                           // observed source end offset/document length, also required on empty lifecycle batches
  "context": {
    "cwd": "…", "git": { "root": "…", "remoteUrl": "…", "branch": "…", "head": "…" } | null,
    "installation": { "hostname": "…", "osUser": "…", "platform": "…", "arch": "…" },
    "activeLeafId": null,                     // pi active transcript branch; null for other readers
    "transcriptMetadata": null,               // JSON document reader supplies native sessionId/startTime/sourceRecordCount
    "parentHint": { "harnessSessionId": "…", "relation": "SUBAGENT" | "SPAWNED", "agentId": "…", "agentType": "…" } | null
  },
  "records": [ { "pos": 48213, "sourceVersion": 0, "key": "c008375c-…", "line": "{…}" }, … ],   // in source order; sourceVersion defaults to 0
  "cursor": "48213→52990",                        // opaque, echoed back
  "end": { "reason": "exit", "head": "…", "observedCommits": [ … ], "observedDiffStat": { … }, "dirtyFileCount": 1 } | null
}
```

Response `202 { "sessionId", "accepted", "duplicates", "cursor", "publication" }`, with
`publication` equal to `queued` or `published`. The complete redacted batch, immutable
admission, quota decision, durable outbox and audit commit before acknowledgement.
There is no partial batch admission. Projection is asynchronous; queued data is not
claimed searchable. The durable outbox survives queue terminal failures and is removed
only in the transaction publishing the complete ClickHouse revision.
Errors: `401/403` (suspend and report, once the shim has confirmed the rejection with a
second verdict, §6.2 step 3), `409` (session owned by another user, or
tombstoned), `413` (split), `422` (permanently invalid record: quarantined client-side,
other records accepted on resend without it), `429/5xx` (retry with backoff). A server
that could not verify the key answers `503 AUTH_UNAVAILABLE` with `Retry-After` (§9.2),
never a 401: an overloaded server is a retry, not a lost session.

### 5.2 Semantics

- Upsert Session on `(organizationId, harness, harnessSessionId)`; first writer owns it; another user's
  key gets `409` unless admin-permitted (audited). Tombstoned sessions reject appends.
  Session and explicit parent lookups compare canonical native-identity digests using
  indexed expressions. Readable native IDs may become `redacted-<SHA256>` when a policy
  changes; identity, ownership, privacy and tombstones remain the same (ADR 0025).
- Records dedupe on `(sessionId, key)` when `key` is present, else `(sessionId, pos, sourceVersion)`.
  Key comparisons use the same stable canonical digest; rescans redact stored keys too.
  Repeated batches (same `batchId`) return the prior result.
- **Source order is authoritative.** `seq` derives from `pos`, with stable native-key
  tie-breaking at reused positions as defined in §4.3. The uploader never sends
  a later range before an earlier range is acknowledged (§6.2), so late arrival is
  confined to retries of the same range.
- Lifecycle by source order: `start` with a resume source, and `end`, are applied in
  `pos`/time order; a delayed `end` does not override a later resume.
  The envelope's `sourcePos` supplies that observation watermark even when it has no
  records; it must cover every included record position. Never promote an old event to
  the server's newest stored position. Only `start` reopens an ended session; a final
  `sync` after `end` can append output without changing its ended status.
  Only `start` and `end` advance `lifecyclePos`/`lifecycleAt`. A delayed source or
  context-only `sync` must not suppress a native lifecycle event at the same
  position. Normalizer context freshness uses the latest accepted receipt's
  source position and time independently of these lifecycle markers.
- Explicit `start: {resume:true}` creates one fixed `Session resumed.` SYSTEM/META
  message backed by its accepted receipt, even with no new raw records. Startup,
  fork and unknown starts do not create markers. Retries reuse the pending batch ID;
  the shim coalesces duplicate hook delivery before assigning a new intent. Rescans
  reconstruct markers from receipts. A pending pi leaf preserves the last displayed
  branch while adding its resume marker (ADR 0020).
- The JSON-document reader records `transcriptMetadata.sourceRecordCount` on each
  observed rewrite. The Gemini normalizer projects only positions within that current
  document length. A shrinking document removes obsolete derived slots while retaining
  previously accepted raw observations for review; delegation does not imply a child
  session identity when the native tool provides none.
- Metadata idempotency: counters, `toolsUsed`, `SessionFile`, lifecycle markers change
  only for newly accepted records or events. A new mutable-record version replaces
  that position's derived messages and counter contributions; it never adds a second
  copy. An active-leaf change updates pi's displayed branch even without new records.
- Admission uses one PostgreSQL transaction for the ownership/purge check, complete
  redacted batch, record identities, quota ledger, compact receipt, durable outbox,
  queue intent and AuditEvent. `202` means that transaction committed. The transaction
  has two phases. Redaction, parsing, deduplication against the session's admitted
  identities, tool-result masking and shape validation run first under a per-session
  accept lock only, so sessions of one organization redact concurrently and a retried
  or taken-over batch waits for the accept in flight and then replays its receipt; a
  replay takes no organization lock. The writes then take the organization row (the
  membership and key recheck, the free-plan admission count of §9.6 and per-policy
  counters of §5.3 depend on it), the exclusive publication fence and the session
  control row, in that order, so the fence and organization row are held across the
  control-row revision bump, receipt, outbox and queue intent only. Publication takes
  the fence and the control row and never the organization row.
- A `sync` batch that accepts no new record and changes neither lifecycle, normalizer
  context nor parent link creates no revision and no outbox and takes no fence: it
  commits its receipt (revision equal to the accepted revision it observed, published
  when that revision is), the installation digest, `lastActivityAt` and the context
  watermark, its audit row and a projection job; its `publication` reports whether the
  session has published that revision. The worker appends such receipts to ClickHouse
  at the current published revision as a receipt-only publication (fence and control
  row, no rebuild) when no revision is pending, or with the pending publish otherwise,
  so receipt-derived analytics (§10 active windows, the persisted lifecycle decision of
  R-ING-07) see them on the worker's next run like any other receipt. Everything else
  (`start`, `end`, new records, a changed pi leaf or Gemini document metadata, a new
  parent hint) takes the full path.
- A worker claims a bounded source revision and reconstructs the canonical session
  from redacted raw records and receipt observations. It writes only changed native
  messages/files plus the complete header to ClickHouse. Older versions remain
  append-only; deleted derived records receive tombstones. The change set is computed
  against the complete fingerprint manifest of the published revision, paged in the
  identity column's native order with a cursor of the same type, so republishing an
  unchanged session writes no message or file rows regardless of its size; rows of an
  identity below its newest row at or under the published revision are dead once the
  publish commits and may be reclaimed per session. The worker reclaims them after a
  publish that changed at least one message or file row when the published revision is a
  multiple of ten or the publish changed more than 1,000 rows, under the session's
  exclusive sink lock, audited as `trace.revision.cleanup`; readers see the same rows
  before and after.
- Native row policies hide every unpublished revision. Only after every write is
  acknowledged does a PostgreSQL transaction advance the published revision, mark
  receipts published, remove the corresponding outboxes, and schedule embeddings.
  Readers hold a shared publication fence; publication, visibility, purge and redaction
  generation changes take its exclusive counterpart, and accept holds it across its
  control-row revision bump, receipt, outbox and queue intent. Every writer takes the
  fence before any session control row, and the organization row before the fence when
  it needs both. Partial writes and failed publication checkpoints remain invisible and
  retry with stable identities.
- Durable outbox recovery does not depend on a surviving queue job. A failed worker
  leaves the last published revision readable; status exposes queued, waiting-source
  and failed projections separately from completed publication.

### 5.3 Redaction

Applied to **every persisted free-text path**: record lines, envelope git fields, commit
subjects, titles, first prompts, native display names and organization names, and audit
`detail` text. In memory, before any write. Global native display names use the shared
default redactor in native create/update hooks; organization-specific rules cannot
change a global identity shared across organizations. Native authentication identifiers
and credential fields retain their library-owned values.
Local spool and state files on the client are not redacted (they are the transcript's
own machine); they are `0600` in a `0700` directory. Public copy describes server-side
redaction and custom policies.

Rules = shipped secretlint preset + pattern rule (Anthropic, OpenAI, JWTs, connection
strings with passwords, generic `token=…`, `ac_` keys) + `RedactionPolicy` rows,
composed into one secretlint configuration, validated on save (regex compiles, bounded
length, catastrophic-backtracking check). The backtracking analysis runs once when an admin saves a pattern (and over the shipped patterns in the unit suite); stored rows load structurally, so sign-in, session creation and rescans never re-run it. JSON object values retain assignment-name
context for secret scanners. Regex policies additionally scan the unprefixed value,
so anchors have the same meaning on standalone strings, object values and array items.
Matches from both native scans merge before replacement/counting; overlaps count once
and repeat scans preserve terminal replacements (ADR 0039). Ordinary reads cache policies for 30 s.
Transactional ingestion, embedding, rescan, policy changes, moderation and audit redaction
load policies through the active transaction client; their local cache never publishes uncommitted policies to the
shared cache or requests an extra root-pool connection (ADR 0033). Compiled engines are
shared process-wide by organization and the fingerprint of the composed policy set (ADR
0066): every transaction still reads its own policy rows and redacts with exactly the rules
it sees, while the compiled secretlint configuration and its bounded scan memo (repeated
keys and protocol values are scanned once per engine) are reused across accepts, audits
and rescan sessions until a row changes, which selects a freshly compiled engine. Worker audits use their
explicit organization policy set. Admins manage policies from the
dashboard or `/admin/redaction/policies`; `REDACTION_EXTRA_PATTERNS` seeds rows at boot. Each changed organization seeds and
writes one `redaction.policies.seed` audit in the same transaction; restart or concurrent
boot with no new rows writes no extra seed audit.
Regex policies and regex-form scanner allow patterns share the native recheck safety
validator, with a five-second deadline and automatic checker selection. Its NFA-size
threshold is 1,000 and bounded-repeat threshold is 64; these select the analysis
algorithm, not the permitted runtime repetition count. Only a safe classification is
accepted. Unknown, unsupported, thrown, or timed-out analyses fail closed and can be
retried; they are never cached as a permanent unsafe verdict. Safe and known-unsafe
classifications use a bounded 256-entry process cache. See ADR 0032.
Built-ins can be disabled, not deleted. `POST /admin/redaction/test { text }` shows what
would be redacted. Policy names, patterns, options, and effective replacements are
validated against the current redactor before storage; a default replacement derived
from a name cannot introduce literal credentials. Exact configured replacement strings
are terminal output tokens: subsequent scans preserve those validated literals while
still scanning text around them. Arbitrary bracketed strings receive no exemption.

Typed protocol syntax is preserved separately from free text. Adapters declare known
property names, finite discriminator values, and validated timestamps; unknown keys,
unknown values, and every other string still pass through secretlint. Native opaque
identities that match a rule or exceed 256 UTF-8 bytes become `redacted-<SHA256>`.
That prefix with a 64-digit lowercase digest is reserved for server-generated values.
The same canonicalization applies to native session IDs, parent references, and pi
leaf references. Projected tool and tree identities use durable hashes so changing a
policy between batches cannot split an input/result pair or a branch. Raw free text is
never restored after redaction (ADR 0017).

Deleting a custom policy removes its per-policy hit counters in the same transaction;
the deletion audit retains the removed hit total and reason. Disable it to retain
the policy and its counters. Policy mutations, ingestion, moderation, and rescans take
the organization lock before session locks. Ordinary reads may retain a deleted policy
in another process's 30-second cache until expiry. Transactional writes use their current
policy rows and ignore that shared cache; only extant policy rows receive per-policy
counters. Deleting a policy does not undo already-redacted stored text.

**Ledger.** Under the per-receipt counters sits a per-message ledger, `redaction_hit`:
one row per receipt, policy and message position (`seq`, the anchor the session page
selects at `/app/sessions/:id#<seq>`), with the count, the time and `run_id` naming the
rescan that applied it (null at capture). The accept records which raw record each hit
landed on (`redactions` in the outbox payload, with a null record for hits on the
envelope, context and native identities); the projection, which alone knows the record's
messages, lands a record's hits on the first message projected from it and keeps hits
on metadata or on a record that projects no message at a null position, then writes the
rows in the publish transaction, for accepts and rescans alike. Rows hang off their
counter (`ON DELETE CASCADE`): deleting a policy or purging a session removes them with
the counters, and a hit whose counter is gone by publish time is dropped as the counter
was. Each rescan target also records the redactions the run applied to it
(`redaction_run_session.redaction_count`), so a run lists the sessions it changed. No
redacted text is stored anywhere in the ledger. Admin reads, each one audited and one
scan per relation (§7.6): `GET /admin/redaction/summary` (totals and distinct sessions
from the counters, 7- and 30-day windows from receipt arrival and target checkpoint
times split into capture and rescan, per-policy counts, the run tally), `GET
/admin/redaction/rescan` (runs with progress and changed-session counts), `GET
/admin/redaction/rescan/:id/sessions` (a run's targets, changed ones by default) and
`GET /admin/redaction/hits` (the ledger newest first, filterable by run, session, policy,
source and `q`, a case-insensitive match of 1 to 200 characters on the applying policy's
name, resolved as a semi-join in the same statement; sorts on `redacted_at`, `count` and
`seq`; offset cursors with `LIMIT n+1` for the next-page flag; CSV); the Redaction page
shows them (§10).

**Sensitive files.** Tool results whose input path matches `**/.env*`, `**/*.pem`,
`**/*.key`, `**/id_rsa*`, `**/credentials*`, `**/.npmrc`, `**/.netrc` are replaced
wholesale, including copies in the raw record (such as `toolUseResult` and
`resultDisplay`). Adapters identify result locations; one shared redaction path patches
them. Results are paired to inputs by `(sessionId, toolUseId)` in the same batch or
already stored. Before generic redaction can remove path evidence, the server records
sensitive classification against a hash of the native call ID. Classification is ORed
across historical versions and retained through rescan; a later redacted path or tool
name cannot weaken it. Adapters replace entire result containers, including unknown
fields inside those containers, while preserving only identity and necessary typed
structure. Redaction hit counters count pattern/scanner matches; whole-file masking
is a separate protection and does not invent a policy row. An unpaired result is not persisted: return `422` with its record
position/key and code `UNPAIRED_TOOL_RESULT`. The uploader uses its durable quarantine
mechanism to retain this record locally, resends the remainder, and retries deferred
unpaired records once after each subsequently acknowledged source batch. Permanent
invalid records remain quarantined. This preserves fail-closed behavior while allowing
an input arriving later to complete the result without an unredacted server copy.

**Rescan (complete by construction).** `POST /admin/redaction/rescan { policyIds?,
since?, reason }` snapshots non-purged target session IDs and enqueues a native
pg-boss job in the request transaction. `since` selects sessions with an ingest receipt
at or after that instant; `policyIds` identifies and validates the policy changes
prompting the scan. Every active policy is applied even when IDs are supplied.
Per session, the worker re-applies policies to every `RawRecord.payload` and its
redaction context, then re-derives Message, SessionFile, title, first prompt, and
(if enabled) chunks from the rewritten raw records. Envelope observations retained
on the session and its organization-scoped installation are re-redacted too. Pending tree leaves do not prevent a rescan:
`projectedContext` retains the last displayed branch so it can be rebuilt safely.
New policy hits add to the originating receipt's RedactionEvent counters and appear
in one audit row per session touched. The session rewrite, audit, target checkpoint and
progress counters commit together per session, serialized with ingest. A job claims up to
`min(3, cores − 1)` (at least one) unprocessed targets in one transaction under the
organization row, publishes them concurrently (the fence and control rows serialize only
the commits), records one progress audit per batch and repeats until the run completes or
its 60 s budget ends, when it enqueues its successor in the same transaction as that
audit (ADR 0066). A target whose re-redacted records, header and control text equal the
published generation (no policy hit, identical fingerprints) is checkpointed without a
rebuild: its claimed revision is published with no sink write, no new generation and no
fence, since readers select `revision <= published_revision` within the current
generation and no row exists at the new revision; its progress, per-session audit
(`unchanged: true`) and authority recheck are those of a rebuilt target, and current
embeddings stay current. A claimed target another publisher is finishing is awaited while
its projection lease is held; a target that reached no checkpoint fails the job, which
retries from the committed checkpoints.
The worker rechecks current membership/key authority for each batch and skips
tombstoned targets. It stores no request headers or credentials in job data.
`GET /admin/redaction/rescan/:id` exposes organization-scoped progress as specified in
§7.6. Completed and failed progress is retained for `AUDIT_RETENTION_DAYS`. See ADR 0016.

### 5.4 Normalization

`Normalizer { harness, toMessages(records), sessionDelta(records), links(records), spawns(records) }`
selected by the envelope's `harness` (no detection). `links` reads a child's own record
of its parent; `spawns` reads a parent's record of the calls that started its children. Permissive: unknown record types
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
`function_call_output`/`custom_tool_call_output` → `TOOL_RESULT`, `reasoning` → `THINKING`. `turn_context` sets
model; `event_msg token_count` sets usage (adapter rule: treat as cumulative, store
deltas). A second `session_meta` in the same file = resume. Codex 0.153.4
`token_usage_record` duplicates cumulative event usage and remains raw-only.
Claude streamed blocks with the same native `message.id` repeat usage; allocate
usage once per native message, not once per raw block.

**Gemini CLI**. `~/.gemini/tmp/<project>/chats/session-<ts>-<id8>.json`: one
JSON document rewritten in full on every change (`writeFileSync`, verified); shape
`{ sessionId, projectHash, startTime, lastUpdated, messages: [{ id, type: "user" |
"gemini", content, thoughts[], toolCalls[], tokens, model, timestamp }] }`; large tool
outputs spilled to `tool-outputs/session-<id>/`. Live capture confirmed an existing
message gains `toolCalls` at the same id, array index, and timestamp. Raw versions use
`id:sourceVersion:contentHash` keys and persisted increasing sourceVersion; projection uses the latest
version. User content is an array of `{text}`, assistant content a string. Inputs are
`toolCalls[].args`; results are `toolCalls[].result[].functionResponse.response`.
`AfterTool` can run before result persistence; `AfterAgent` and `SessionEnd` drain the
final document. Duplicate `SessionEnd` events were observed.
Native `generalist` delegation can temporarily append child messages to this same
document and then shrink it (observed five → two → four messages). Preserve every
accepted raw version; project only positions within the latest observed document
length. The delegation call/result remains a parent tool trace. Hooks provide no
separate child-session identity, so no child session or parent link is fabricated.

**pi**. `~/.pi/agent/sessions/--<cwd-encoded>--/<ts>_<uuid>.jsonl`, append-only
tree JSONL: header `{ type: "session", version: 3, id, timestamp, cwd, parentSession? }`,
entries with `id`, `parentId`, `timestamp`, `type` ∈ `message`, `model_change`,
`thinking_level_change`, `compaction`, `branch_summary`, `custom`, `custom_message`,
`label`, `session_info`. `message.role` ∈ `user`, `assistant`, `toolResult`,
`bashExecution`, `custom`; `toolCall` blocks; `toolResult` with `toolCallId`. All
entries stored with `parentId`; the pi extension sends the active leaf id with each
sync so the transcript view can follow it. `session_tree` changes the active leaf
without appending transcript bytes and therefore always requests a sync. A fork's
`parentSession` is the parent transcript file path; resolve its native session ID from
that header or the observed filename, never infer a relationship from timing.

### 5.5 Links

| relation                                                                                 | Claude Code                                                                                                                                   | Codex                                                                                                                                                       | Gemini CLI                     | pi                     |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------- |
| `SUBAGENT`                                                                               | child path known from `SubagentStart` (`agent_id`) via the verified layout; shipped with `parentHint`; `SubagentStop` confirms                | child rollout `session_meta.source.subagent.thread_spawn.parent_thread_id`; hooks verified by name, payloads captured during implementation                 | captured during implementation | none                   |
| `FORK`                                                                                   | none (no native metadata)                                                                                                                     | `forked_from` marker when present                                                                                                                           | n/a                            | header `parentSession` |
| `SPAWNED`                                                                                | env `AGENTCOMMONS_PARENT_SESSION_ID`                                                                                                          | same                                                                                                                                                        | same                           | same                   |
| spawning call (`parentToolUseId`)                                                        | parent `Agent` result record: `toolUseResult.agentId` beside the `tool_result` block's `tool_use_id`; child ref `<sessionId>:agent-<agentId>` | parent `event_msg item_completed` `SubAgentActivity` `kind: started`: `item.id` is the `spawn_agent` `call_id`, `item.agent_thread_id` the child rollout id | none (delegation is inline)    | none (forks only)      |
| Native metadata outranks env hints; conflicts are recorded, never relinked silently.     |
| Unresolved parents stay in `parentNativeRef` until the parent arrives. Native references |
| and hook hints use the same redaction-aware identity mapping as session creation.        |
| A spawning call is evidence the parent holds about a child. Ingest canonicalizes the     |
| child reference exactly as the child's own upload does and digests the call id to the    |
| projected `tool_use_id`; the claim is stored per (parent, child identity) and applied    |
| when the child is linked to that parent, whichever side arrives first. A claim never     |
| relinks a child that names another parent; such claims are recorded as conflicts.        |
| Graph updates serialize per organization before any session row lock; concurrent         |
| opposing hints cannot introduce a cycle or deadlock. Self-links and cycle-forming        |
| edges are recorded as conflicts without replacing an established parent.                 |

---

## 6. Hook shim and installer

### 6.1 Install

```
curl -fsSL https://agentcommons.example.com/install.sh | sh -s -- --key ac_…
```

POSIX sh, idempotent. Re-running it is needed only on a fresh machine or to change the
key: installed hooks update themselves (§6.2, **Self-update**).

1. Require `curl` and Node ≥ 20; record the absolute `node` path (hooks run without the
   user's shell PATH).
2. Fetch `/hook/manifest.json` `{ version, sha256, url, extensionSha256, extensionUrl }`
   (served `no-cache`); download `hook.js` and `pi-extension.mjs` to temp files; verify
   each sha256; atomic rename into `~/.agentcommons/`. Artifacts are versioned and
   immutable (`/hook/<version>/hook.js`, `/hook/<version>/pi-extension.mjs`; `version`
   is `0.1.0-<16 hex of the content hash>`) so caches cannot serve a mismatched pair.
3. Write `config.json` (0600): server, key, `installationId` (generated once), node
   path, `realtime`, `syncIntervalSeconds` (10), `syncBytesThreshold` (65536),
   `disabledPaths`. Existing values preserved.
4. `node hook.js install`: for each harness present, merge hooks into its config keyed by
   an exact marker (`agentcommons-hook` in the command); register the MCP server (`claude
mcp add -s user -t http … -H "Authorization: Bearer <key>"`, `codex mcp add …
--bearer-token-env-var AGENTCOMMONS_API_KEY`, Gemini `mcpServers` entry with
   `headers.Authorization: Bearer <key>`); the Claude and Gemini entries carry the key
   literally, never an env placeholder, because IDE extension hosts read these 0600 files
   without a shell (Appendix A, Gemini Code Assist); Codex reads the variable by design
   through its own flag; a reconcile run (§6.2 **Reconfiguration**) rewrites an existing
   entry, so installed machines heal on their next hook run after a bundle swap; each
   harness is wired independently, so a `claude mcp add` that fails (the CLI missing
   from the detached uploader's PATH) is reported as a notice while the Gemini and Codex
   entries are still rewritten, and only a harness whose files could not be written, or a
   run that wired nothing, exits non-zero; write the marker-delimited
   `AGENTCOMMONS_SERVER`/`AGENTCOMMONS_API_KEY` exports into `~/.bashrc`, `~/.zshrc` and,
   when fish is installed or configured, `~/.config/fish/config.fish` unless
   `--no-shell-rc` (Codex reads the key from the environment, so every login shell needs
   it; the installer tells the user to open a new terminal before starting Codex); write the
   §8.3 guidance block into each configured harness's global instructions file
   (`instructionsPath` in `HARNESSES`: `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`,
   `~/.gemini/GEMINI.md`; pi's extension adds the same text to its system prompt), replacing
   the marker-delimited block in place so a self-update carries new text, and name the
   files in the output. The installer itself adds nothing to repositories: the uploader
   writes the repository variant of the block (§8.3, ADR 0069, ADR 0071) into a checkout's
   `AGENTS.md` on the first captured session there (§6.2 **Repository guidance**), and
   `node hook.js guidance [--repo <path>]` (no configuration needed) does the same at once
   for one checkout; both create `CLAUDE.md` and `GEMINI.md` as symlinks to it when absent,
   add the block to them when they already exist as files and leave a symlink that points
   elsewhere alone (`repositoryInstructionsFile` in `HARNESSES`), so a team commits it
   once. `--off` removes the block from a checkout and records that its repository is left
   alone from then on. Fields the
   native CLI cannot express are merged into the entry it wrote: Claude Code's entry gets
   `alwaysLoad: true`, because Claude Code 2.1.x otherwise defers every MCP tool behind
   `ToolSearch` (Appendix A) and the budgeted catalog (ADR 0053, R-MCP-09) is cheap to
   load eagerly. `doctor` checks every field of the expected entry.
5. `node hook.js doctor`: `GET /api/v1/me`, harness config check; nonzero exit on failure.
   Persist the authenticated organization id and credential fingerprint. Existing spools
   remain pinned to their original server and organization; key rotation verifies `/me`
   before sending them and cannot migrate them into another organization.
6. Prints: Codex runs no hooks until trusted on next interactive launch (verified).

`--uninstall` runs the **installed** `hook.js uninstall` (no download), removes only
entries carrying the marker, keeps `config.json`. Exit codes: hooks always exit 0 (fail
open); `install`/`doctor`/`uninstall` exit nonzero on failure.

### 6.2 Shim: one durability state machine

One file, no dependencies, two modes.

**State** (`~/.agentcommons/state/<harness>-<sha256(sessionId)>.json`, versioned):
`{ v, harness, sessionId, transcriptPath, server, organizationId, credentialHash,
context, contextSentAt, ackedCursor, source, pending, cleanup, intent, phase, children, processed, lastSyncAt,
suspended, retryGeneration }`. The cursor contains its reader kind. Child entries name
independent state files with the same locking and pending-batch protocol. A pending
batch records its file, id, start/end cursor, source snapshot, originating intent,
quarantine replay files, and any unsent split continuation.
The acknowledged transition also persists a bounded `cleanup` list of consumed files
and intent IDs. The lock owner deletes those files idempotently, then clears the list;
restart completes retained cleanup before sending. A crash after local acknowledgment
therefore cannot leave acknowledged plaintext spools or processed intent files behind.
The next split pending file is never part of its predecessor's cleanup.

Native callbacks publish immutable intent files in `<state>.intents/`; only the uploader
writes the cursor state. Filenames index source watermark, event time, kind and hashed
intent id, so hook mode reads at most the highest source and latest start/end payloads
even during an outage; the uploader reads and deduplicates the full journal. This prevents a callback from overwriting an acknowledgment
while the uploader awaits the network. A complete fsynced file is published exclusively
with an atomic hard link, then the directory is fsynced; atomic replacement uses rename.
Owner sidecars include PID, process birth identity, acquisition time, and a random token.
Recovery serializes on the old token, rechecks it before unlinking, and waits for an
expired live owner to terminate before claiming the session (ADR0023).

The uploader retains the latest native context observation timestamp in `contextSentAt`.
An older callback cannot replace that context or its transcript path, even if newer raw
bytes are available when it drains. Source/context sync and deferred replay carry the
retained context timestamp; lifecycle receipts retain their own immutable event time.
This preserves pi's selected branch when detached callbacks arrive out of order.

**Hook mode** (`hook.js <harness>`, run by the harness on every event, under 150 ms): read
stdin, map the native event to a behavior via `HARNESSES` (§6.3), publish a durable
intent beside the state file: `start` → create state, register `context`; `sync` → set `intent = "sync"` if due
(prompt/turn end: always; tool: ≥ `syncIntervalSeconds` since `lastSyncAt` or ≥ 64 KB
pending); `SubagentStart` → add a child source using the event mapping's captured
path semantics; `end` → persist the end reason and set `intent = "end"`.
Then, if no live owner holds the lock, spawn `hook.js upload <state>` detached
(`detached: true, stdio: 'ignore'`, `.unref()`) and exit 0. Never any network I/O.
A hook that cannot record its event (a state file this bundle cannot read, a fault in the
release) still exits 0 and, when no uploader is live for the session, spawns one anyway:
the uploader's update check runs whatever its drain does (**Self-update**, below), so the
release that fixes the fault reaches the machine instead of every later hook of the
session failing the same way in silence.
On an event flagged `hint` in `HARNESSES` hook mode also reads the repository's cached
recall data (**Recall hint**, below) and prints the harness's documented context output,
`{"hookSpecificOutput":{"hookEventName":"<event>","additionalContext":"…"}}`, and
nothing else (ADR 0069, ADR 0070). The repository is the state's git context or, before
the uploader has recorded one, `remote.origin.url` read from the working tree's `.git`
(directory, or a worktree's `gitdir:` pointer and its `commondir`), so the first event of
a session and a fresh clone of an indexed repository are hinted too. Before any hint the
shim reads the harness's own MCP configuration (`mcpConfigPath`, in the installer's
`--config-home` or the home directory, at most on the start event and the first prompt,
files over 1 MB skipped): when the `agentcommons` entry is missing or still carries an
unexpanded `${…}` placeholder the harness has dropped the server (Appendix A), so the only
context that session receives is one repair notice naming the file, the cause and `node
<data directory>/hook.js install`, and no instruction to search (R-CAP-24). Otherwise:

- `hint: "start"` (Claude Code and Gemini `SessionStart`; Codex documents no such output):
  once per session state, the **session overview**: "AgentCommons has N indexed sessions
  on <repo_name>; newest: "<title>" (<age>, get <session_id>); …" for up to three newest
  root sessions, then the search-first instruction. A resume's `SessionStart` is silent
  (R-CAP-23).
- `hint: "prompt"` (Claude Code and Codex `UserPromptSubmit`, Gemini `BeforeAgent`): when
  cached sessions match the prompt (title or branch shares two words, or one identifier
  or path, with the prompt; stopwords ignored; prompt bounded to 4 KB), the **matched
  hint** names them with title, age and `get <session_id>`, each session once per
  session; otherwise the count-and-repository nudge "<N> prior AgentCommons sessions
  touch <repo_name>; search them before changing code (search, get, sql over MCP)." on
  the first prompt of a session that had no overview and then every 25 prompts
  (R-CAP-20).

Either kind also carries, once per repository, the line announcing a block the uploader
wrote into the checkout (**Repository guidance**, below; R-CAP-26), alone when no hint is
due and never in a session that received the repair notice.

The per-session state is `<state>.hint`, written by hook mode (the uploader owns the state
file): prompts seen, the prompt of the last hint, whether the overview and the repair
notice were given, the sessions already named and the registration verdict. Reading a few
small files and writing one keeps the 150 ms budget. This is the only stdout a hook ever
writes: Claude Code adds plain stdout on these events as context too, and Gemini parses
stdout as JSON (Appendix A). pi has no shell hook and gets no hint.

**Upload mode** (`hook.js upload <state>`, always a detached child):
Git context and end observations are collected here with 500 ms per-command timeouts,
so hook mode retains the 150 ms bound even when git is slow. For Codex 0.153.4,
SubagentStart's transcript_path names the child and must not replace the parent's path;
SubagentStop confirms the child through agent_transcript_path.

1. Acquire the lock: write `owner {pid, since}` with `O_EXCL`; if held by a live pid,
   exit; if held by a dead pid or older than the bounded uploader lifetime (5 min), take
   over.
2. Loop: if `pending` exists, resend it (same `batchId`, same cursor range); else if
   intent is set or the source grew, read from `ackedCursor` with the reader, write the
   batch file, set `pending`, send. On `202`: `ackedCursor = cursorEnd`, delete the batch
   file, clear `pending`, `lastSyncAt = now`. On `end` intent with nothing pending: send
   the `end` envelope. A `sync` intent whose read finds no record past `ackedCursor` and
   whose context (cwd, git, pi active leaf, transcript metadata, parent hint) the server
   already holds completes locally without a request: it is marked processed and its
   journal file removed, cursors unchanged. Only lifecycle intents (`start`, `end`) and
   context changes ship an empty `records` array, so the `end` batch never queues behind
   empty syncs and each such intent costs no server round trip. Repeat for each
   registered child source. Continue while intent changed during the loop or the source
   grew again; then clear intent, release the lock, exit.
3. Failures: `429/5xx/network` → backoff (1 s, 5 s, 30 s) up to three tries, then leave
   `pending` in place and exit (the next hook or sweep resumes). `401/403` → a rejection
   only when confirmed: the body carries the server's error `code` and a second request,
   `GET /api/v1/me` with the same credential, reaches a verdict consistent with it
   (401/403 for a 401; for a 403 any verdict, 200 or 401/403, since the server reaches a
   403 only after resolving the credential). A confirmed rejection suspends the session
   (state `suspended` with status and code), writes to `hook.log` and exits; an
   unconfirmed one (no code in the body, or a 5xx, 429, network failure or timeout on
   the confirmation) is retried through the same backoff and then left pending, so a
   server that answered a valid key wrongly under load never parks a session. `409` →
   suspend at once (the server resolved the session). The first credential check of a
   state (`GET /api/v1/me` when no organization is verified yet) follows the same rule:
   a 401/403 is confirmed with a second `/me` before suspending, and a server that could
   not answer leaves the spool for the next hook. `413` → split
   the pending batch. `422` → durably quarantine the named record before rewriting
   pending, then resend the remainder; `UNPAIRED_TOOL_RESULT` quarantines are retried
   after the next successful source batch, through the same single pending-batch path.
   An individually oversized source record is retained in a private local quarantine;
   its cursor range is skipped only after an empty/remainder batch receives `202`.
   An incomplete oversized JSONL tail is retained but its cursor is not advanced.
4. After its own session: flush spooled pending batches of at most one other session
   (oldest `lastSyncAt` first) whose intent is set or whose source grew (**sweep**).

Lifecycle receipts carry the hook-time source watermark and event time independently
of later raw-record reads. Duplicate lifecycle deliveries use a stable intent/batch id
based on the owning native process PID/birth identity and preceding lifecycle phase;
a later process launch or an intervening shutdown produces a distinct resume. The pi
bridge additionally assigns each native event object a shared observation id and monotonic
callback timestamp; duplicate observers share them, and detached callback arrival order
cannot invert lifecycle order or merge distinct empty resumes. JSONL
watermarks observe source bytes; mutable documents use a monotonic observation watermark
plus per-index hashes/source versions. Accepted batch cursors, including split prefixes,
are the only authority for advancing source progress.

**Post-turn settle.** Harnesses fire their turn-end hooks before the final record is
on disk: Claude Code appends the assistant's final `text` record up to 400 ms after
`Stop` and the child's final record 15–20 ms after `SubagentStop` (Appendix A). Events
flagged `settle` in `HARNESSES` (Claude/Codex `Stop` and `SubagentStop`, Gemini
`AfterAgent`, pi `agent_end`) therefore make the detached uploader, after it has drained
and acknowledged everything readable, poll the source every 250 ms and upload whatever
appears, until the source has been quiet for 2 s, never more than 5 s per drain. A hook
published during the wait is picked up immediately. The wait happens only in upload
mode, after the `202` for the previous batch has advanced `ackedCursor`, so killing the
uploader during a settle loses nothing and duplicates nothing; hook mode keeps its 150 ms
budget and no timer runs after the settle ends.

Guarantees, stated honestly: uploads are event-triggered. During activity, new content
is sent within about `syncIntervalSeconds`. An idle session with pending content waits
for its next hook or another session's sweep; after the post-turn settle there is no
timer. Nothing is lost while the disk survives: `ackedCursor` only advances on `202`,
and the server dedupes.

**Recall hint.** After its drain, the uploader refreshes the recall data of the session's
repository, so the hook can hint from the cache without a request. The repository name is
`repositoryIdentity(remote)`, the same `repo_name` the server derives, so the cache key and
the list filter agree. One request, `GET /api/v1/sessions?limit=10&roots_only=true&filters={"repo_name":"<repo_name>"}`
with the installation key (10 s timeout), whose `total.sessions` comes from the page's own
scan (§7.6) and whose ten newest root sessions become the recent list; at most every 15
minutes per repository. The cache is `recall/<sha256(repo_name)>.json` in the data
directory, `{ v: 2, repoName, sessions, fetchedAt, recent: [{ id, title, startedAt, branch }] }`
(titles bounded to 100 characters; a v1 count-only cache stays readable until its
refresh); the attempt is recorded before the request so a failing server is asked again
only after the interval. Failures are logged to `hook.log` and ignored; nothing here
touches `pending` or `ackedCursor`. No request is made for a session outside a repository
with a remote, and a newly indexed session reaches the cache after at most one refresh.
The data is the caller's visibility (row policies): the hint carries only what the same
key already reads through the list endpoint, and the file paths a session touched are not
in it (the list endpoint does not return them; ADR 0070 follow-up).

**Repository guidance.** After its drain, the first uploader run of a session inside a
checkout writes the §8.3 repository block into the checkout's instructions files, so a
repository carries the guidance from its first captured session without anyone running a
command (ADR 0071). The checkout is the state's git root (`git rev-parse --show-toplevel`,
recorded by the first drain): a session in a nested directory writes at the enclosing
root, a linked worktree (its own `.git` file) counts as a checkout, and a bare repository,
which has no working tree root, is never written. The write is `writeRepositoryGuidance`,
the same code the command runs: `AGENTS.md` receives the marker-delimited block (through a
symlink only when it points at a regular file inside the checkout; a link that leaves the
checkout is never followed and skips the whole write), `CLAUDE.md` and `GEMINI.md` are
created as symlinks to it when absent (a regular file carrying the block where the
platform refuses symlinks), receive their own block when they are regular files and are
left alone when they are symlinks; everything outside the markers is kept byte for byte.
The gates are data: `guidance.auto` in `config.json` (default `true`),
`AGENTCOMMONS_GUIDANCE_AUTO` in the environment (`0` off, `1` on, overriding the file), and
a per-repository decision in `guidance/<sha256(key)>.json` in the data directory, keyed by
`repositoryIdentity` of the checkout's `origin` as it is now, read from its `.git/config` on
every run (every clone on the machine shares it; the state's `remoteUrl` dates from the
first drain and outlives a renamed remote), and by the resolved root path otherwise: `{ v:
1, repository, root, decision:
"written" | "declined", blockHash, files, announce, at }`, read loosely like `update.json`.
A recorded `declined` (written by `hook.js guidance --repo <path> --off`, which also
removes the block and unlinks a `CLAUDE.md`/`GEMINI.md` link to `AGENTS.md` the removal
left dangling) or a `written` whose `blockHash` is this bundle's block text ends the step
before any repository file is read; a differing hash (a release changed the text) compares
each file's block with the new text by `blockText` (trailing whitespace and blank lines
aside) and rewrites, once, only a block whose words differ. A root that is missing,
read-only, inside `node_modules` or without its own `.git` is skipped quietly and nothing is
recorded, so a later session looks again. A block already present that says the same thing
(a teammate committed it, prettier reformatted it) is adopted: recorded, not rewritten, not
announced. The block is written in `markedBlock`'s layout, the one prettier's markdown
printer produces (a blank line after the begin marker and after the heading, the end marker
on the line after the text, one blank line before the block, a single final newline), so a
formatter run on the file changes nothing. The files that changed are named in `hook.log`.
The next hinted hook event (**Recall hint**) then adds, once per repository, "AgentCommons
guidance was added to AGENTS.md (with CLAUDE.md/GEMINI.md); commit it so every teammate's
agent reads it." to its context: hook mode reads the decision file and clears `announce`,
and never touches a repository file. Nothing here leaves the machine: the block is the same
text for every server and the uploader writes it without a request. `hook.js guidance`
without `--off` records `written` (no announcement) and lifts a `declined`.

**Self-update.** A shim's identity is the sha256 of its own `hook.js` bundle (and of
`pi-extension.mjs`), the same digests the server publishes in `/hook/manifest.json`
(§6.1). Every envelope carries them as `hook: { sha256, extensionSha256 | null }`
(`hookIdentitySchema`, §5.1); the server stores `sha256` on the installation
(`installation.hook_sha256`) on every upload, and the installations listing
(`api_ro.installations`, `installationSchema.hook_sha256`) exposes it so Admin → Status
can compare each machine with the manifest (§10). Hash identity needs no version
registry: an installation is current when its digests equal the manifest's.

Only upload mode updates; hook mode never touches the network and never updates. At the
end of an uploader run, whatever the drain's outcome (a failed send, a rejected
credential, a corrupt state file or an interrupted checkpoint all still reach this step,
so a bundle whose drain fails still receives the release that fixes it), at most once per
hour per installation (`update.json` in the data directory records the last check), the
detached uploader GETs `/hook/manifest.json` from the configured server. If the manifest digests differ from the installed files it:

1. downloads the artifacts from the manifest URLs resolved against the configured
   server origin (same origin only; any other origin is refused), with an 8 MB cap per
   file and a 30 s timeout;
2. verifies each sha256 against the manifest;
3. runs the new bundle once as `node <tmp> version` and requires it to print its own
   digest, then once in hook mode (`node <tmp> <harness>` with a synthetic event on stdin
   and `AGENTCOMMONS_DISABLE=1`, so nothing is recorded) and requires exit 0 with no
   output (self-test). A release that starts but cannot run as a hook is refused here:
   once installed it would never start the uploader that fetches the release fixing it;
4. atomically renames the files over `~/.agentcommons/hook.js` and `pi-extension.mjs`.

An update lock with liveness (the same lock module as the uploader, upload mode step 1)
prevents concurrent updaters. Harness settings keep pointing at the stable path, so the
next hook invocation runs the new version; running processes are unaffected. Any failure
(network, size, timeout, digest mismatch, failed self-test, rename) is written to
`hook.log` and ignored; pending batches and `ackedCursor` are untouched, and the next
hourly check retries. A staged file whose write fails (a full disk) is removed at once,
and an exclusive publish that fails half-way leaves no claim file, so a full disk never
accumulates partial artifacts beside `hook.js`; when one rename succeeded and a later one
failed, the log names the files that were replaced and the next hourly check fetches only
what still differs. The swap writes only `hook.js`, `pi-extension.mjs`, `update.json`
and `hook.log`: a batch left pending by the failed run before it is delivered by the next
run, byte for byte, from the same state file. `update.json` is read loosely, so a field a
newer bundle adds survives an older uploader's read-modify-write instead of failing the
parse and dropping the wiring record. `install.sh` is unchanged and remains a manual
reinstall; `hook.js doctor` is unchanged.

**Reconfiguration.** Wiring follows the bundle and the machine automatically. `hook.js
install` records its flags (`--config-home`, `--no-shell-rc`) in `config.json` and the
digest plus harness set it wired in `update.json`. On every uploader run, and only when
`config.json` carries the install flags (a directory the installer never set up is left
alone), the shim compares that record with the installed digest and the supported CLIs
present on `PATH`; after a swap, when a newly supported or newly installed harness
appears, or when the wiring record is missing (an older uploader's strict read of
`update.json` dropped it), it runs the installed bundle's own `install` with the recorded
flags (always with `--no-shell-rc`, since the shell
exports only change with the key). The installer adds or replaces only entries carrying
the `agentcommons-hook` marker, backs up each config file once, and restores the MCP entry
if a native registration fails, so a background run cannot remove or overwrite what the
user configured. Failures are logged to `hook.log` and retried at most hourly; a success
clears the throttle. Deploying a server version that adds a harness therefore wires every
machine that has that CLI within an hour of its next session.

### 6.3 Harness table

| behavior                                                                                               | Claude Code                                               | Codex                | Gemini CLI                               | pi                                                  |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | -------------------- | ---------------------------------------- | --------------------------------------------------- |
| `start`                                                                                                | `SessionStart`                                            | `SessionStart`       | `SessionStart`                           | `session_start`                                     |
| `sync`                                                                                                 | `UserPromptSubmit`, `PostToolUse`, `Stop`, `SubagentStop` | same                 | `BeforeAgent`, `AfterTool`, `AfterAgent` | `input`, `tool_result`, `agent_end`, `session_tree` |
| child source                                                                                           | `SubagentStart` (+ `SubagentStop` confirms)               | `SubagentStart/Stop` | —                                        | —                                                   |
| `end`                                                                                                  | `SessionEnd`                                              | `SessionEnd`         | `SessionEnd`                             | `session_shutdown`                                  |
| `hint` (model context)                                                                                 | `SessionStart` (start), `UserPromptSubmit` (prompt)       | `UserPromptSubmit`   | `SessionStart` (start), `BeforeAgent`    | —                                                   |
| repository instructions file (the §8.3 block, written once by the uploader)                            | `CLAUDE.md`                                               | `AGENTS.md`          | `GEMINI.md`                              | `AGENTS.md`                                         |
| Readers: `jsonl-append` (byte offset) and `json-document` (per-index content hashes and                |
| source versions; acknowledged only with the pending batch). Each entry also carries config path, hooks |
| key, timeout unit (Gemini: ms), and MCP registration shape.                                            |

### 6.4 Environment

`AGENTCOMMONS_SERVER`, `AGENTCOMMONS_API_KEY`, `AGENTCOMMONS_PARENT_SESSION_ID`,
`AGENTCOMMONS_DISABLE=1`, `AGENTCOMMONS_DIR` (optional private config/state directory;
default `~/.agentcommons`), `AGENTCOMMONS_GUIDANCE_AUTO` (`0` keeps the uploader from
writing the §8.3 block into repositories, `1` forces it on; otherwise `guidance.auto` in
`config.json` decides). Installer `--config-home` selects an isolated native settings
root for canaries without changing the user home; `--no-shell-rc` suppresses exports.

---

## 7. Search, read, SQL (the backbone)

Three operations, one index, one vocabulary. Field names in every output are the
`api_ro` column names (`repo_name`, `user_email`, `tool_name`, `content`, `seq`), so a
result from one operation is a valid input to the next.

### 7.0 From a keystroke to a hit

A prompt is appended to the transcript and fires a hook (≈50 ms: map event, mark
intent, spawn uploader). The uploader ships the new records with their source positions.
The server authenticates and redacts the complete batch, then commits admission,
its durable outbox and audit before returning `202`. The worker normalizes source
records into native messages and publishes a complete revision. Search validates its
shared schema, ranks caller-visible native messages, and fetches bounded context and
headers concurrently inside the same publication fence. It merges overlapping windows
and returns match-centered excerpts carrying `session_id` and `seq`.

### 7.1 Ingest decides what is searchable

| message                                | searchable | `searchText`                                                                |
| -------------------------------------- | ---------- | --------------------------------------------------------------------------- |
| `USER` / `ASSISTANT` / `SYSTEM` `TEXT` | yes        | whole text                                                                  |
| `TOOL_USE`                             | yes        | tool name + first 1 KB of input                                             |
| `TOOL_RESULT`                          | yes        | first 2 KB **and last 2 KB** (test and compiler failures appear at the end) |
| `THINKING`, `META`, images             | no         | stored, returned by `get`, never ranked                                     |

The native text-index expression lowercases and tokenizes `searchText`, then normalizes
each token's English inflection with a fixed, ordered rule table built from standard
string functions (`englishInflectionRules` in `packages/traces/src/views/search.ts`):
plural `-s`/`-es`/`-ies`, `-ed`/`-ing` including a doubled consonant, consonant + `-y`,
and a final `-e`. Query tokens use the identical expression. Tokens containing digits or
non-ASCII text stay literal. ClickHouse's `stem()` is not used: it is an experimental
function that ClickHouse Cloud locks off, and ADR 0056 records that removing it kept the
golden top-three hit rate at 30/30. All nonempty query tokens must match; ranking weights
are defined in §7.2. Literal substrings outside the ranked portion remain available
through SQL `LIKE` on `content`. PostgreSQL tsvectors and a query-language translation
layer are not retained.

### 7.2 `search`

Input (`packages/core/schemas/search.ts`):

```jsonc
{
  "query": "rate limiter", // token search, English inflections normalized; may be "" if filters given
  "filters": {
    "repo_name": "cunningham",
    "branch": ["feat/x", "main"],
    "user_email": "…",
    "tool_name": "Edit",
    "file_prefix": "src/auth/",
    "file_operation": "edit",
    "role": "USER",
    "session_id": "…",
    "since": "2026-08-01T00:00:00Z",
    "until": "2026-09-01T00:00:00Z",
    "where": [
      { "field": "tool_name", "op": "contains", "value": "search" },
      {
        "field": "tool_input",
        "path": ["query"],
        "op": "contains",
        "value": "auth",
      },
    ],
  },
  "context": 1,
  "limit": 5,
  "cursor": null,
}
```

- Filters: scalar or array (OR within, AND across); enums on scalars and array items;
  unknown key or empty array → 400 listing valid keys. `repo_name` accepts the canonical
  `host/org/repo`, the `org/repo` pair an agent reads off a remote, or the bare repository
  name; the last two resolve through the `repos` view to the one repository whose name
  ends with them (400 `AMBIGUOUS_REPO` when several do; ADR 0070). `user_email` exact.
  `ingest_api_key_id` exact (the key that uploaded the session; the Install page uses it
  to list one machine's sessions, §10). `tool_name` matches tool-use/result messages themselves. `file_prefix` selects
  _sessions_ that touched the path. `file_operation` (`read`, `edit`, `write` or
  `delete`, the values normalizers record in `session_files.ops`) selects sessions where
  a file carried that operation; given together with `file_prefix`, both must hold on the
  same `session_files` row, so "edited a file under `src/auth/`" never matches a session
  that only read it. `since` inclusive / `until` exclusive on **message
  time** (UTC). `session_id` searches within a session. Structured conditions below
  cover partial text and tool parameters; more complex queries use SQL.
- Every input, filter and output field carries a one-line `.describe()` meaning in the
  shared zod schema, so the MCP tool schema, OpenAPI and the generated dashboard client
  say what each field is. Output fields that are `api_ro` columns take their text from the
  shared view catalog (`packages/core/schema-catalog.ts`), the same source as
  `schema_columns`; names never change, only their explanations are added.
- `filters.where` is an optional array of 1–10 AND conditions, combined with all ordinary
  filters. Each condition names a static field and `eq`, `contains`, `starts_with` or
  `exists`. Text fields are `tool_name`, `tool_use_id`, `content`, `role`, `kind`, `model`
  (message fields), and `harness`, `title`, `repo_name`, `branch`, `user_email`, `status`
  (session fields). Values are live stored data, not a generated tool-name allowlist.
  `eq` is exact and case-sensitive; a null value matches SQL null. `contains` and
  `starts_with` are case-insensitive literal string operations, including literal `%`,
  `_` and backslash. They do not interpret SQL, wildcards or regex. `exists` requires a
  non-null text field and has no value. String values are bounded to 4,096 characters;
  partial/prefix values must be nonempty. Unknown fields/operators and excess conditions
  are rejected before querying.
- The additional field `tool_input` requires a `path` array of 1–8 JSON object keys or
  array-index strings (each at most 256 characters). Path traversal uses the full stored,
  redacted JSON, independently of the 1 KB full-text indexing prefix. `eq` compares a
  JSON primitive with its original type (string, number, boolean or explicit JSON null);
  a missing path does not equal JSON null. `contains`/`starts_with` match JSON strings
  only; `exists` accepts any present JSON value, including null. `path` on other fields
  and values on `exists` are invalid. All paths and values are SQL parameters. No raw
  WHERE clause, arbitrary SQL expression, regex or harness-specific interpretation is
  added. Multiple message conditions must hold on the same message. Matching neighbors
  remain context, not additional filtered hits. A condition-only search is valid.
- The same predicate compiler serves lexical search, embedding eligibility and session
  lists/exports. In session lists and exports, a session-only condition can match a session
  with no messages; message conditions require a matching message. Search results still
  require an anchor message, including condition-only searches. Cursors bind all conditions. The dashboard's
  basic chips remain, with a compact advanced condition form shared with the MCP schema.
  GET requests can JSON-encode `filters` to preserve primitive types and literal JSON
  path keys; the generated dashboard client uses that encoding.
- `limit` = hit messages before window merging (default 5, max 50), with at most 3 hits
  per session so one noisy session cannot fill a page. `context` 0–3 (default 1) counts
  normalized non-thinking messages either side.
- Pipeline: shared structured filters → native ClickHouse text-index candidates → latest
  published message identity. Query and indexed text use native lowercase tokenization
  and the shared English inflection rule table of §7.1; no experimental ClickHouse
  function is involved, so the same DDL runs self-hosted and on ClickHouse Cloud. Every
  query token must match; punctuation separates tokens. The search box is a text query, with structured filters for conditions; SQL
  uses native ClickHouse syntax. PostgreSQL websearch operators are superseded by ADR0047.
  Rank is weighted matching-token frequency divided by `1 + log(1 + token_count)`;
  weights are user text 1.0, assistant text 0.4, tool input 0.2 and tool result 0.1.
  Embeddings, when enabled, fuse native cosine neighbors with lexical rank. Ordering is
  `(rank desc, session_id, seq)`. Batched neighbor/header queries form and merge touching
  message windows. The unchanged golden corpus must retain its top-three hit rate.
- Empty `query` with filters: one most-recent anchor message per matching session.
- Output: blocks `{ session_id, title, harness, model, repo_name, branch, user_email,
started_at, messages: [{ seq, role, kind, tool_name?, tool_use_id?, content, hit,
truncated, truncated_fields }], truncated_fields }`,
  `cursor` (opaque, query-bound; same in REST and MCP), `truncated_response`, and
  `total: { sessions, hits }`: the distinct sessions and the matching messages of the
  whole query under the caller's visibility, counted over the same filtered candidate
  set as the page before the per-session cap, the cursor and `limit`, in the same read
  callback as the page so the two never drift apart. The text rendering opens with
  `N hits in M sessions` from these totals.
  `content` is a match-centered excerpt (~300 chars around the first match; tool text
  300 chars); when it is an excerpt, `content_range` gives its `{start, end, total}` in
  UTF-8 bytes of the full content (the unit `get` cursors use) and the text rendering
  shows `[truncated <start>-<end> of <total>]` after `[hit]` with an ellipsis at each cut
  end, so a mid-message fragment is recognisable and readable on with
  `get(session_id, cursor: {seq, offset: start})`; a complete message has
  `content_range: null`. No scores or timings in the agent-facing text. Response budget 32 KB
  (transport cap 256 KB). Block title, model, repository, and branch previews, plus
  message tool name and tool identity previews, are bounded to 256 UTF-8 bytes,
  including an ellipsis when shortened. Each object's `truncated_fields` identifies
  shortened metadata. Full stored values remain available through SQL.

### 7.3 `get`

`{ session_id, from?, to?, cursor?: {seq, offset}, kinds? }`; inclusive `seq` bounds;
`to < from` → 400. Cursor offsets count UTF-8 bytes and must fall on character boundaries;
REST encodes the cursor object as JSON in its query parameter. Same behavior
with or without a range. `kinds` selects the message kinds returned; by default a read
returns the conversation (`TEXT`, `THINKING`, `TOOL_USE`, `TOOL_RESULT`) and leaves out
`META`, the harness's housekeeping records (deferred tool listings, skill listings,
reminders), which were 94% of the bytes an agent paged through in production; a caller
lists `META` to read them, and the CSV export carries every kind because a file is not a
context window. `seq` counts every kind, so a default read shows gaps where META records
sit and `message_count` in the header still counts them. Returns a header with every session-level fact: `session_id`,
`title`, `harness`, `harness_version`, `entrypoint`, `model`, `models_used`,
`user_email`, `installation_id`, `installation_hostname`, `repo_name`, `repo_url`, `branch`, `cwd_relative`,
`start_commit`, `end_commit`, `started_at`, `ended_at`, `status`, `visibility` (`PUBLIC`/`PRIVATE`), `end_reason`,
`message_count`, `tool_call_count`, `input_tokens`, `output_tokens`, `tools_used`,
`file_count`, `observed_commit_count`, `reuse_count`, `agentcommons_search_calls`, `reuses_made`, `agent_type`, `parent_tool_use_id`, `parent` ref and `children` refs
that the caller may see (each ref carries `parent_tool_use_id`), `root_session_id`; then the selected messages in order, thinking and tool results included, each
`content` bounded to a quarter of the page budget (META records to one thirty-second)
with `content_cursor` for the rest, total page budget `page_bytes` (default 32 KB, so
8 KB slices and 1 KB META previews), `next` cursor `{ seq, offset }`.
A bounded message does not end the page: the page continues with the following messages,
so a whole session reads as one bounded preview per message, and `next` names the next
message, or the rest of the last message when the range ends inside it. The rest of one
message is read with `from` and `to` set to its `seq` and `cursor` set to its
`content_cursor` (ADR 0061). The text form an agent reads (§8) carries the full header,
without `organization_id` and `installation_id`, on the first page of a read and one line
(`session <id> | title | harness | N messages | continued`) on a continuation page (a call
with a cursor); each message shows its seq, role, kind, timestamp, model, tool fields,
content, `message_id`, token counts when recorded, `content_cursor` when bounded and
`truncated_fields` when any. `raw_record_id`, `ingest_batch_id` and the omitted header
fields stay in the JSON. REST callers may raise `page_bytes` up to the 256 KB page cap, and the
dashboard reads at that cap (§10). The header is the expensive part of a read (one
`sessions` scan carrying the row with its parent and child refs, plus the parent and
root links from control); a REST caller that already holds it passes
`header=false` and gets `header: null` with the messages, its visibility checked against
the light session state instead, so a whole transcript computes the header once. The MCP
tool advertises neither `page_bytes` nor `header` and rejects both, so agents always read
32 KB pages with the header (ADR 0061). Full file lists, commits, and trees come from SQL.
The header includes at most ten visible child references, exact `child_count`, and
`children_truncated`. `truncated_fields` names any free-text or array fields shortened
to keep the header within 12 KB; complete values remain queryable through SQL. Header
size must never prevent transcript pagination. Message tool name, tool identity,
model, and agent identity previews use the same 256-byte metadata bound as search;
each message includes `truncated_fields`. Oversized metadata must not block content
pagination, and stable database IDs are never shortened (ADR 0022).

### 7.4 `sql`

`{ sql }`: one read-only ClickHouse `SELECT` over `api_ro`.

- Canonical views expose the snake_case session, message, file, tool, repository,
  installation and analytics fields. `schema_columns` reads actual native column
  names, types and ordinals. Descriptions use native column comments when present,
  otherwise the shared view catalog (`packages/core/schema-catalog.ts`: one purpose
  per view and one short meaning per column, kept as data and embedded in the view),
  otherwise the column name with underscores replaced by spaces. A migration-added
  column on a canonical view appears without rebuilding the catalog.
  `schema_functions` describes parameterized search views.
  Both hide embedding capabilities unless available to the current organization.
- `search_messages(q='words')` returns an uncapped `(session_id, seq, rank)` relation.
  It composes with ordinary predicates and aggregates. With embeddings enabled,
  `similar_sessions(source='session UUID',max_rows=5)` returns visible sessions and
  cosine distance. Named literal parameters are native ClickHouse syntax.
- Response `{ columns: [{name, type}], rows: [[…]], row_count, capped, truncated_cells:
[[row, col]], duration_ms }`. Native column types and duplicate column order survive.
  Fetch 501 to set `capped`; Int64/UInt64 and decimals retain the driver's lossless
  representation. Decimal constants requiring explicit precision use native string
  conversion, such as `toDecimal128('1.234567890123456789',18)`. Text cells are cut at
  2 KB; total output is at most 256 KB. A capped result's text form ends its count line
  with "Add LIMIT/OFFSET to page." Errors contain a stable code, a safe message and a
  position, mapped in one place for REST, MCP and dashboard tiles: `SQL_REJECTED` and
  `EMBEDDINGS_DISABLED` from the guard, `SQL_RESULT_TOO_WIDE`, and for a query ClickHouse
  refused `QUERY_INVALID` (unknown column, table or function, type mismatch, syntax,
  alias, aggregate and parameter errors; the message names the class of mistake and
  points to `schema_columns`; `apps/api/src/repositories/sql-guard.ts`). The §7.5 limits
  and availability use the read codes every trace read shares
  (`apps/api/src/repositories/read-failure.ts`, below in §7.5): `READ_TIME_LIMIT`,
  `READ_BUSY`, `TRACE_QUERY_UNAVAILABLE` (all 503 with `retry_after`), while a caller's
  own SELECT outgrowing the memory or result limit is its own to narrow: `400
QUERY_MEMORY_LIMIT` and `400 QUERY_RESULT_LIMIT`.
  `500 QUERY_FAILED` covers an unclassified native error, logged with its cause. Native
  error numbers never appear as codes, and messages never echo the SQL or its values.
  Native SQL bodies and errors containing values are not logged.

### 7.5 Security, silently

1. Better Auth verifies the key/cookie, immutable organization and current membership.
   Admin visibility requires an owner/admin membership and `admin:*` on a key; a
   read-only key owned by an admin remains an ordinary reader.
2. A native ClickHouse principal binds organization, user, effective authority,
   operator embedding capability and SaaS mode. Its credentials derive from the private
   reader secret. Grants permit only canonical views; the default role has no vector
   views. Native settings require read-only queries, a five-second deadline, 256 MiB
   memory and a 32 MiB internal result limit. Hitting a limit is a documented, stable
   failure on every read path (`search`, `get`, lists, tree, reuse, similar, events, CSV
   exports, `sql`, dashboard tiles), REST and MCP alike, classified once in
   `apps/api/src/repositories/read-failure.ts` at the single funnel every read shares
   (`readOperation`, before the audit row). A server-authored query exceeding the
   reader's limits or a control database that could not answer is a server condition,
   so every such failure is a `503` with `detail.retry_after` and a `Retry-After` header
   and a message that says what to do next: the five-second deadline (ClickHouse
   `TIMEOUT_EXCEEDED`, or the read budget around it) is `READ_TIME_LIMIT` (retry; narrow
   the time range or filters; for text search run `sql` over `search_messages(q=…)`);
   the memory limit is `READ_MEMORY_LIMIT` and the result limit `READ_RESULT_LIMIT`
   (narrow the range); a PostgreSQL lock or statement timeout, serialization failure,
   deadlock or exhausted pool during the read is `READ_BUSY` (retry); an unreachable,
   cancelled or saturated trace database is `TRACE_QUERY_UNAVAILABLE`. A caller's own
   SQL (`sql`, dashboard tiles) keeps `400 QUERY_*` for what only the caller can fix
   (`QUERY_INVALID`, `QUERY_MEMORY_LIMIT`, `QUERY_RESULT_LIMIT`); its time limit and busy
   databases are the same 503s. Only a failure outside these classes is
   `500 OPERATION_FAILED`, logged with its cause and request id. An MCP tool failure
   carries the same code, message and `retry_after` in its `isError` text (§8.1).
3. Native row policies protect every underlying corpus table and PostgreSQL-engine
   control metadata table. Each policy reads the caller's organization's current
   publication, redaction generation, visibility, purge and embedding entitlement once
   per guarded table read from the PostgreSQL control source (a scalar subquery over the
   `control_session_scope` engine table, whose organization filter runs in PostgreSQL,
   hashed against each row's session with `transform`; ADR 0062), never once per
   scanned row. The control table's own row policy admits only the caller-visible
   sessions, so every policy scalar in one query context shares one control read, and the
   session views read their per-session metadata (parent link, lifecycle, ownership,
   member email and name, machine hostname) by joining that control read once per query,
   never through a per-row dictionary lookup; the few remaining keyed lookups
   (installation policy, audit retention) keep the fresh direct dictionaries. A view scans
   each base table once, and a public view is one query context rather than a stack of
   `api_ro` views. A missing or
   unavailable control source fails closed. Published rows require their current
   generation and an accepted publication revision. Vector rows additionally require
   the completed vector epoch whose source equals the published trace revision.
   Purged content is invisible even to admins; admins retain only a sanitized control
   skeleton. DEFINER views alone are not a security boundary because native optimizer
   evaluation may precede their WHERE clause. Derived counts and parent fields use
   only caller-visible rows. Hidden parents appear null in headers; the explicit tree
   endpoint marks hidden-node gaps.
4. A shared PostgreSQL publication lock covers the complete bounded reader callback;
   publication, visibility and purge mutations use its exclusive counterpart. Compact
   graph reads use that same transaction. This prevents a single response combining
   two publication generations without acquiring nested PostgreSQL connections. A read
   request scans each relation at most once inside that callback: page totals are window
   aggregates of the row scan itself, a session's header row and its parent and child
   references are one query, parent and root links come from compact control in the
   same transaction, and any later query of a request reads only the ids the first one
   returned (context rows, headers and payloads of a page), never the base view again.
5. The shared official `@clickhouse/parser` guard accepts one SELECT/CTE, canonical
   relations and reviewed scalar/aggregate functions, at most 20 KB. It serializes the
   vetted AST without comments. Writes, settings, caller query parameters, external
   databases, system catalogs, arbitrary table functions, files, networks and output
   destinations are rejected. Only the named canonical search views accept table
   parameters. Native grants independently deny underlying tables and mutations.
6. SQL executes inside `SELECT * FROM (<validated sql>) q LIMIT 501`. Search/get use
   named typed parameters on the same readers. Rate limits are 300/min for search/get
   and 60/min for SQL per key. Services write one redacted audit event per operation.

### 7.6 REST

All under `/api/v1`, zod-validated, OpenAPI at `/api/docs`; application routes anywhere
under `/api` without complete Zod response schemas and a summary fail boot. The reserved
`/api/docs` namespace belongs to the native Scalar Fastify reference plugin and its
locally served assets. Scalar renders the live `/api/docs/json` document generated from
the same shared Zod route schemas as the checked-in OpenAPI artifact. It provides operation
search and request/response schema inspection without handwritten OpenAPI, a CDN bundle,
or an external request proxy. The public reference contains no tenant records and does
not bypass authentication when trying API operations. Its browser rendering is checked
under an explicit Content Security Policy (ADR 0040). Params and query schemas are declared on every application route;
body schemas are declared for methods that support a body. Fastify rejects body
validation schemas on GET/HEAD routes. List requests with `format=csv` return the
same bounded page as JSON, with `X-Next-Cursor` when another page exists.
`GET /sessions/:id?format=csv` instead streams the whole requested range as one
attachment named `session-<id>.csv`: one row per message in `seq` order, the `get`
message columns except `content_cursor`, a message split across pages rejoined into its
row. Its pages are `get` reads (the same audit rows, budgets, redaction and visibility)
at the 256 KB REST page cap whatever `page_bytes` the caller passed, the header computed
on the first page only (`header=false` afterwards), and the rows stream as each page
arrives. The first page is read before the response starts, so a caller who cannot read
the session receives the JSON error and no file. Full filtered
dashboard exports follow JSON cursors. REST and dashboard exports use one shared CSV
formatter with formula escaping, JSON serialization for structured cells, and empty
cells for null values. Table exports retain duplicate SQL column labels and their order.

| method          | path                                                                                                       | permission        | notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST            | `/ingest`                                                                                                  | `sessions:ingest` | §5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| GET/POST        | `/dashboards`                                                                                              | read              | list dashboards (built-ins first), `default_id`, the definition JSON Schema and tile templates; create or update (`id` + `revision` for updates) (§10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| POST            | `/dashboards/render`                                                                                       | read              | run the data tiles of a saved (`id`) or inline (`definition`) dashboard with `variables` and an optional `tiles` subset; each tile returns rows or its error; saved results are cached for an hour per caller scope unless `refresh` is set                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| GET/DELETE      | `/dashboards/:id`                                                                                          | read              | definition; delete by creator or organization admin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| POST            | `/dashboards/:id/default`                                                                                  | admin             | make a saved dashboard the organization's Home default; the Team overview's id restores the shipped default and any other built-in is refused (409)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| POST            | `/search`                                                                                                  | `sessions:read`   | = `search`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| GET             | `/sessions/:id`                                                                                            | read              | = `get`; `?from=&to=&cursor=&page_bytes=` (32 KB default, at most 256 KB); `?header=false` answers messages only for a caller that holds the header; `?format=csv` streams the whole range as one CSV file (§10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| POST            | `/query`                                                                                                   | read              | = `sql`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GET             | `/schema`                                                                                                  | read              | `schema_columns`, `schema_functions` as JSON                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| GET             | `/sessions`                                                                                                | read              | list with the §7.2 filters, no text; `total: { sessions, messages }` counts the sessions the filters, `roots_only`, `searched` and `used_prior_work` match under the caller's visibility and sums their `message_count`, over the whole set rather than the page, computed as window aggregates of the page's own scan (one query) in the same read callback. `searched` (optional boolean) keeps only sessions with `agentcommons_search_calls > 0` (true) or `= 0` (false); `used_prior_work` does the same over `reuses_made`; both are predicates on that scan                                                                                                                                                    |
| GET             | `/sessions/:id/events`                                                                                     | read              | SSE `event: session`, data `{session_id,status,message_count,last_received_at}`; `last_received_at` is the server receipt timestamp exposed in SQL as `last_activity_at`; initial snapshot then changed snapshots, checked every 5 seconds. IDs are connection-local counters; reconnect sends a fresh snapshot, not a replay. Each tick reauthenticates current membership/key and reads through tenant visibility views; loss of access closes the stream. One read audit records the subscription. A `: keepalive` comment every 30 seconds keeps idle-timeout proxies (Cloudflare closes idle responses after 100 s) from cutting a quiet stream. Dashboard falls back to polling every 5 seconds while `ACTIVE`. |
| GET             | `/sessions/:id/raw`                                                                                        | read              | paginated redacted raw records; oversized payloads are canonical JSON string fragments with `payload_fragment: { offset, next_offset }`; concatenate UTF-8 fragments before parsing. Raw pages order observations by `(pos, sourceVersion, id)`; the opaque cursor includes this complete identity and binds a fragment's redacted payload digest, rejecting continuation if a rescan changes it. Ordinary complete payloads have `payload_fragment: null`.                                                                                                                                                                                                                                                           |
| GET             | `/sessions/:id/tree`                                                                                       | read              | paginated visible tree containing the session, `{ nodes, cursor }`, limit default 50/max 100: ancestors to the root and all descendants, each node `{ session_id, title, harness, agent_type, parent_relation, parent_session_id, parent_tool_use_id, user_email, started_at, status, message_count, gap }`, via a recursive CTE over `parent_session_id`; hidden nodes are omitted and their visible children attach to the nearest visible ancestor with `gap: true`                                                                                                                                                                                                                                                |
| GET             | `/sessions/:id/similar`                                                                                    | read              | registered only when embeddings are enabled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| GET             | `/me`                                                                                                      | cookie or key     | user, role, key metadata                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| GET             | `/me/organizations`                                                                                        | cookie session    | current user's memberships only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| POST            | `/me/organization`                                                                                         | cookie session    | switch to an organization with active membership; invalidate dashboard caches and live streams                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| GET/POST/DELETE | `/me/keys`                                                                                                 | cookie session    | create/revoke own keys; a key cannot mint keys                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| POST            | `/me/keys/:id/reveal`                                                                                      | cookie session    | return `{ key }` for the caller's own active key in the current organization from its encrypted copy (ADR 0051); an API-key caller gets 403 `KEY_REVEAL_SESSION_REQUIRED`; another member's, another organization's or a revoked key is 404; audited as `keys.reveal` with the key id and no secret                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET             | `/repos`, `/installations`                                                                                 | read              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GET             | `/health`, `/ready`                                                                                        | none              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GET             | `/install.sh`, `/hook/manifest.json`, `/hook/<version>/hook.js`, `/hook/<version>/pi-extension.mjs` (root) | none              | §6.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| GET             | `/auth/config` (root)                                                                                      | none              | enabled login methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Mode-gated registration.** A running instance registers only the route groups its mode
and configuration activate, so the live `/api/docs/json` document lists active routes
only; the checked-in `openapi.json` artifact registers every group for the generated
client. `INSTANCE_MODE=saas` activates `/onboarding`, `POST /me/organizations`,
`GET /billing`, `POST /billing/checkout` and `POST /billing/portal`; customer and public
instances answer 404 for them. `POST /admin/domains` is registered only when Google is
the sole login provider and signup is not `closed` (§9.1). `/sessions/:id/similar` is
registered only with embeddings enabled (§11). Everything else, including
`GET /billing/config`, `GET /admin/domains`, `/organization/embeddings` and the dashboard
routes, exists in every mode. MCP tools are not mode-specific.

`GET /billing/config` is public in every mode and returns mode/enabled, shared plan prices
and record allowances, nullable per-1,000 usage rates, checkout availability and an
optional Cal.com URL. It contains no organization data. `GET /billing` (SaaS only)
requires active membership and read authority. It returns plan, billing period,
records_used, included_records, remaining, overage_records, embedding_messages_used,
estimated usage charges, pending/reconciliation meter counts and owner action
availability. Owner-cookie `POST /billing/checkout` accepts `{plan: "pro" | "pro_embeddings"}`;
`POST /billing/portal` accepts an empty object. Both return `{url}` on credential-free HTTPS
`checkout.stripe.com` or `billing.stripe.com`. A completed native in-place plan update
returns `{url: null}` and the client refetches authoritative state; it never grants access
from a browser return. Organization references, prices and fixed return URLs are server-owned.
Missing complete Stripe price/meter/rate configuration disables checkout with typed
`503 BILLING_UNAVAILABLE`. See §9.6.

`GET /sessions/:id/reuse` requires read permission and accepts `direction=by|from`
(default `by`), `limit` (default 50/max 100), an opaque cursor, optional `reader_user_id`,
and `sort=read_at|reader_email|source_title|target_title` with `order=asc|desc`. It returns
`{items, cursor}`, one latest read per visible peer session. Both directions use the
shared reuse edge shape: `source_session_id` (reading session), `target_session_id`
(read session), `source_title`, `target_title`, `reader_user_id`, `reader_email`,
`reader_harness`, `read_at`, `audit_id`, and `truncated_fields`. The `by` direction
fixes the target; `from` fixes the source. Titles and reader email previews are bounded
to 256 UTF-8 bytes. Pages default to read time descending; text sorting uses the first
256 characters in PostgreSQL's `C` collation, nulls always last, with source/target UUID
ties ascending. Home reuse feeds use this same query and cursor implementation. A snapshot
time and query/organization/authority-bound keyset cursor retain bounded sort values, so
hiding the preceding page's anchor does not skip the next visible peer. Hidden or purged peers never leak
through lists or counts; the requested session must also be visible.

`GET /sessions` sorts by any list column of `api_ro.sessions`: `title`, `harness`,
`harness_version`, `model`, `repo_name`, `branch`, `user_email`, `installation_hostname`,
`started_at` (the default), `duration_seconds`, `message_count`, `tool_call_count`,
`observed_commit_count`, `reuse_count`, `agentcommons_search_calls`, `reuses_made`, `status`
or `last_activity_at`, ascending or
descending with nulls last and ties broken by `session_id` (ClickHouse's UUID order, stable
but not the text order), as one `ORDER BY` on the page's own scan. Its cursor is an offset bound to the sort, order, filters, `roots_only`, `searched` and `used_prior_work`, so a
page continues the same order without repeating or skipping a row, and a cursor issued for
one sort or order is refused (`INVALID_CURSOR`) under another.

`agentcommons_search_calls` and `reuses_made` are the reading side of the stored reads
(§10, ADR 0060): per session, the `search` and `sql` calls credited to it while it was
active, and the distinct earlier sessions it read through `get` (a self read is none).
`reuse_count` remains the read side (later sessions that read this one). The `sessions`
view computes all three in one pass over `session_reads`, crediting every stored read to
the session that made it and every edge also to the session it read, so the list, the
header and the tiles pay one small aggregate and no per-row lookup. Members see only reads
whose source and target they may see, so a member's `reuses_made` excludes private targets
that an admin's includes.

`GET /installations` and `GET /repos` use the shared list envelope with server-side
sort/order, limit/cursor, and filters. Installations sort by hostname, OS user, platform,
architecture, first/last seen, session count, or tools enabled; filters accept a literal
case-insensitive hostname substring and tools-enabled boolean. Each installation
carries `hook_sha256`, the digest of the `hook.js` that produced its latest upload
(§6.2, **Self-update**). Repositories sort by
name, session/user count, first seen, or last activity and filter by a literal
case-insensitive repository substring. Catalog metadata previews are bounded to 256
UTF-8 bytes and identify shortened fields in `truncated_fields`.

Key responses include `user_email` and `user_name` for the issuing identity, joined only
through the current organization's key attribution. Both are null if that identity no
longer exists. `user_id` remains the stable identity binding and filter; the dashboard
shows the email/name as the owner label.

Admin (`/api/v1/admin`; current organization owner/admin + key `admin:*`, or organization admin cookie session):
`/users` (list, add emails, role, suspend/remove), `/keys` (list, revoke), `/sessions` (the
moderation list of every control session, §9.5), `/sessions/:id/visibility`,
`/sessions/:id/purge`, `/audit`, `/redaction/policies` (CRUD), `/redaction/test`,
`/redaction/rescan` (POST start, GET list runs), `/redaction/rescan/:id` (GET progress),
`/redaction/rescan/:id/sessions` (GET a run's changed targets), `/redaction/summary`,
`/redaction/hits` (GET the per-message ledger, §5.3), `/installations/:id/tools`
(`POST`, `{ enabled, reason }`, returning `{ installation_id, tools_enabled }`),
`/status` (current organization queue/backlog/spend snapshots), and `/metrics/:group`
(historical §10 metric groups with the shared `filters: {date_from, date_to, repo_name?, metric?}`
and server pagination/sort/CSV fields).
`GET /admin/domains` returns `{enabled,items,cursor}` for the current organization's
native Google bindings. Query fields are `limit` (default 50/max 100), opaque `cursor`,
literal domain substring, `sort=domain`, and `order=asc|desc`. `POST /admin/domains`
accepts `{domain}` and returns `{organization_id,domain,provider_id,verified}` with
`verified: true` immediately (ADR 0049); repeating it reaffirms the same binding. There is
no verify route and no DNS record. Owner/admin cookies are required for writes. Domains
have labels of at most 63 characters and at most 253 characters total.
Rescan progress is organization-scoped and admin-only: `{job_id, state, total_sessions, processed_sessions, redaction_count, error}`. State is `queued`, `running`, `completed`, or `failed`; error is nullable, redacted safe text. Progress reads are audited. The persisted run ledger and per-session completion receipts survive retries (§9.5, ADR 0016).
`/users` operates on organization membership, never another organization's membership
or the global identity. `/users` accepts manually entered email addresses and a role,
with at most 100 emails per request and per-email results. It provisions Better Auth identities
without a password when needed and organization membership. No CSV import or invitation emails.
Membership writes and password setup require an admin cookie session, following
Better Auth's native member-management API; admin keys may list members. Keys never
impersonate a user session.

---

## 8. MCP

### 8.1 Transport

`POST /mcp`, the official `WebStandardStreamableHTTPServerTransport` with its
`@hono/node-server` Node bridge, stateless (`GET`/`DELETE` → 405), raw request via
`reply.hijack()`. Bearer API key. The SDK response is retained until the logical
operation or protocol rejection has one audit row. SDK schema/transport rejections
and unsupported methods are audited before any response bytes; audit failure returns
503 instead of an unaudited protocol response. Clients may cache `tools/list`; nothing
depends on re-listing.

Handshakes are not operations (ADR 0073). An MCP message that invokes no tool
(`initialize`, `notifications/initialized`, `ping`, `tools/list` and every protocol
rejection, such as Claude Code's `server/discover` probe) is audited once per identical
handshake per window, where identity is the API key, the client program (`User-Agent`),
the action, the method and the status. The first handshake of a window writes its row at
once; repeats inside the window are counted in the process and write nothing; the
handshake that opens the next window carries `repeats` and `repeats_since` in its detail.
Two harnesses sharing an installation key differ in `User-Agent` and keep separate rows.
The window is `MCP_HANDSHAKE_WINDOW_SECONDS` (default 300; `0` audits every handshake).
Every `tools/call` writes exactly one row for the operation it performed (`search`, `get`,
`sql`, ..., or `mcp.call` when the call failed), and a `tools/list` that fails is audited
per event. Measured on a client that reconnected every 2.4 s for five minutes (the
Gemini Code Assist agent's crash-restart loop, Appendix A): 125 handshakes wrote 375 rows (4,500 per hour, the production figure) with the window off
and 3 rows (36 per hour) with the default window, and process CPU per handshake fell from
125 ms to 100 ms.

A tool failure is an `isError` result whose text is the same
`{ code, message, detail }` the REST route would answer, so an agent sees the §7.5 read
codes (`READ_TIME_LIMIT`, `READ_BUSY`, …) with their hint and `retry_after`, the
`QUERY_*` codes for its own SQL, and `OPERATION_FAILED` only for an unexpected failure;
a credential the server could not verify is an HTTP `503 AUTH_UNAVAILABLE` (§9.2), never
a tool result.

### 8.2 Catalog: static, permission-filtered

The default catalog is the read tools and nothing else. User tools (`sessions:read`):
`search`, `get`, `sql`, exactly as §7.2–7.4; discovery of views and columns is
`schema_columns` via `sql`, so no further tool is needed to write a query. The organization
dashboard tools `dashboard_list`, `dashboard_get`, `dashboard_render`, `dashboard_save` and
`dashboard_delete` (§10) form the `dashboards` tool group, listed only for keys whose
`permissions.tools` names it (ADR 0068). A tool group is data on the key and on the tool
definition (`group`), never a code path: `tools/list` filters by it and every call checks
it again (`403 TOOL_NOT_GRANTED`, naming the grant), so a cached catalog cannot call a tool
the key does not expose. The install flow creates keys with `sessions: [ingest, read]` and
no tool group; the key form offers the group as an unchecked option any member may grant.
Keys created before the group existed keep the read tools and lose the dashboard tools
from their catalog; permissions are immutable, so a new key grants them. Schemas generated
from the shared zod. If the key's installation has `toolsEnabled = false` (staged rollout,
§10), `tools/list` is empty for that key and calls return a clear error; ingest is
unaffected. Admin tools, listed only when the caller has effective admin authority (§7.5)
and each authorized again on invocation: `set_visibility (session_id, visibility, reason)`,
`purge(session_id, reason)` (`destructiveHint`), `audit(filters, limit, cursor)` (exact
ids, UTC bounds) and `status()`; `dashboard_set_default(id)` needs admin authority and the
`dashboards` group together. The `administration` tool group (ADR 0072) needs admin
authority and `admin:*` on the key: it lists one `admin_<resource>_<verb>` tool per active
`/admin` route (§7.5, §9), derived at boot from the route table
(`apps/api/src/routes/admin-routes.ts`) by one helper, `toolFromRoute`: the route summary
is the description after one shared instruction sentence, params, query and body merge into
one strict input without the REST `format` switch, and a call re-parses the parts with the
route's schemas and runs the service the REST route runs. Routes a standing admin tool
already covers (`set_visibility`, `purge`, `audit`, `status`) derive nothing. Catalog order
is read tools, dashboard tools, admin tools, `dashboard_set_default`, administration tools.
No data-derived schema content. The `sql` description lists the
views by name with one line each and the discovery query; it does not enumerate every
column. Every `search` filter carries its one-line meaning in the advertised input schema,
and the `search` description says how filters combine and gives one example call using the
files filters (`file_prefix` with `file_operation`); the `get` description names what the
header and messages carry and how to continue with `next`. The catalog advertises the
compact `searchToolInputSchema`, whose `where` item is one object (`field`, `op`, `path`,
`value`) with the operator meanings on `op`, instead of the four-variant union; calls are
still parsed with the strict `searchInputSchema`, and a unit test proves every condition the
compact shape accepts also parses under the strict one.

Installation attribution uses the key's latest accepted ingest receipt within its bound
organization, ordered by server `receivedAt` and then receipt id. Keys with no accepted
ingest have no installation attribution and keep tools enabled. Shared keys follow their
latest installation; this is not an immutable per-device key binding. Replaying an old
batch does not replace the latest receipt. Every list and call refreshes this decision,
so cached tool catalogs cannot bypass a disabled installation.

The read tools' descriptions are data in `packages/core/format/tool-descriptions.ts`,
action-first, and each ends with one worked example that a core unit test parses with the
schema the call is validated against (R-MCP-12, ADR 0070): `search` opens with the
questions it answers ("has anyone…", "why does…", "how did we…"), tells the agent to put 2
to 4 specific words from its task in `query` because every word must match, names the
accepted `repo_name` forms and points at `get`; `get` opens the best hit; `sql` answers
what search cannot. Each description with the governing sentence stays under 1,200 bytes
(measured 2026-09-11: 1,086, 871 and 1,160; the default catalog is 9,398 bytes). Claude Code 2.1.266 hands the model a tool
result's `structuredContent` JSON, not its text rendering (Appendix A), so the text form
serves other clients and people; guidance for the agent belongs in the descriptions and
the hint, not in result text.

Search, get, SQL and administrative history descriptions open with this governing sentence:
_"Use this to check prior work before changing code, and whenever the user asks about
earlier sessions; run long investigations in a subagent that returns only findings with
session ids."_ The `search` description then names the trigger concretely (start with the
test name, file path or error you were given; an earlier session often holds the root
cause, the library the team chose or the exact value). `initialize` returns the same
guidance as the server `instructions` field, which Claude Code places in its system
prompt; the transport contract test asserts both. Recall has to be organic: an agent given
an ordinary task ("the auth test is flaky again") must decide to look on its own, so no
description says "only when the user asks" (the previous wording, which stopped every
harness from searching; §16.2 organic recall stage).

Dashboard tools instead open with "Use this when the user asks to view, build or change
dashboards." They retain the same current-organization authorization; `dashboard_save`
describes the tile types, the ECharts allowlist, typed `{name:Type}` parameters and the
template → render → save workflow.

The catalog is sized for the client, not only for validation. Claude Code defers every MCP
tool behind a search step once deferrable tool definitions approach 10% of its context
window across all servers, which would hide `search` at the "have we done this before?"
moment the product exists for. `tools/list` therefore stays under 12 KB for the default
catalog (measured 8.4 KB on 2026-09-11, ADR 0068), 20 KB with the `dashboards` group and
25 KB for the complete catalog of an effective admin key with the group, leaving headroom
for future tools: no `outputSchema` is shipped (results still carry
`structuredContent`, validated server-side); input schemas omit the draft `$schema` URL and
regex `pattern`s that only restate a `format`; and the dashboard tools advertise the compact
tool-facing definition (`dashboardDefinitionToolSchema`: variables and tiles as described
JSON objects whose text is derived from the strict schema, naming the allowlisted ECharts
keys and pointing at `dashboard_list`, whose `structuredContent.definition_schema` carries
the complete schema and whose text names the templates)
instead of inlining the style allowlist once per series. Every call is still parsed with the
strict shared schema, so validation is unchanged. No advertised schema contains `$ref` or
recursion, which the Gemini API rejects. The `administration` group is the exception to the
small catalog and is never granted by default: an admin key with it lists under 40 KB, and
the administrator install's key (both groups) under 48 KB (measured 2026-09-11: 32,132 and
40,305 bytes, ADR 0072), about 10,000 tokens that the `alwaysLoad` entry of §8.4 keeps in
Claude Code's context on every turn. The contract test measures all five catalogs.

### 8.3 Global agent instructions

Written by the installer into each configured harness's global instructions file
(`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, one `instructionsPath`
per `HARNESSES` entry) between `<!-- agentcommons-hook begin -->` and
`<!-- agentcommons-hook end -->` markers, replaced in place on every install and self-update
reconfiguration and removed on uninstall; the pi extension adds the same text to pi's
system prompt on `before_agent_start`. It, the
governing sentence and the server instructions carry the same guidance in three places the
agent reads at different moments (global instructions, `initialize`, `tools/list`):

```
## AgentCommons

Past agent sessions for this organization are indexed in AgentCommons (MCP server
`agentcommons`: search, get, sql). This session is recorded automatically. Before you
change code, search it for the test, file or error you were given: an earlier session
often holds the root cause, the library the team chose or the exact value. Use it too
when the user asks about prior work; anything beyond a quick lookup runs in a subagent
that brings back only findings and session ids.
```

**Repository block.** The same guidance framed for a project (`repositoryInstructions`,
`agentInstructionsFor("repository")`, inside the same markers) reaches teammates whose
machines have no install, and ADR 0057's measurement showed agents with git history
available never searched without it. It reaches a repository three ways through one
implementation (`writeRepositoryGuidance`): the uploader writes it into a checkout's
`AGENTS.md` on the first captured session there and links `CLAUDE.md` and `GEMINI.md` to
it (§6.2 **Repository guidance**, ADR 0071; `hook.js guidance --repo <path> --off` removes
it and keeps that repository out, `guidance.auto: false` in `config.json` or
`AGENTCOMMONS_GUIDANCE_AUTO=0` keeps a machine out); `hook.js guidance [--repo <path>]`
writes it at once (§6.1 step 4); and the Install page shows the block to paste, with the
instruction to commit it, for a machine without the install. The README points at all
three (ADR 0069). It tells an agent without the `agentcommons` server to say so once:

```
## AgentCommons

Past agent sessions on this repository and across its organization are indexed in
AgentCommons (MCP server `agentcommons`: search, get, sql). Sessions on machines with
the AgentCommons hook are recorded automatically. Before you change code, search it for
the test, file or error you were given: an earlier session often holds the root cause,
the library the team chose or the exact value. Use it too when the user asks about prior
work; anything beyond a quick lookup runs in a subagent that brings back only findings
and session ids. If this machine has no `agentcommons` MCP server, tell the user once
that the AgentCommons install is missing and continue without it.
```

The recall hint (§6.2) is the fourth surface, from the capture hook: a session overview
naming the newest indexed sessions of the repository at session start, the sessions
matching a prompt when there are any, the count nudge every 25 prompts otherwise, and a
repair notice instead of all of these when the harness has no usable `agentcommons`
registration.

### 8.4 Client configuration

`claude mcp add -s user -t http agentcommons <URL>/mcp -H "Authorization: Bearer ac_…"`;
`codex mcp add agentcommons --url <URL>/mcp --bearer-token-env-var AGENTCOMMONS_API_KEY`;
Gemini `mcpServers` entry `{ httpUrl: <URL>/mcp, headers: { Authorization: "Bearer ac_…" } }`.
The key is literal in the Claude and Gemini entries: `${AGENTCOMMONS_API_KEY}` is expanded
by the Gemini CLI from the shell but not by the Gemini Code Assist extension host, which
sent the placeholder verbatim and was refused every few seconds (Appendix A); Codex alone
reads the variable, through its own `bearer_token_env_var`. A key that reaches the server
as an unexpanded `${…}` placeholder is refused with a 401 that says so (§9.2). Claude user
MCP entries live in `~/.claude.json`, separately
from the hooks in `~/.claude/settings.json`; Codex and Gemini use their hook config files.
The Claude entry carries `alwaysLoad: true` (§6.1 step 4): without it Claude Code loads
the tools only through `ToolSearch`, so the model never sees the governing sentence
before it decides whether to look for prior work.

pi has no MCP client by design, so the installed capture extension is also its tool
bridge (ADR 0054). At load the extension POSTs `tools/list` to the configured server's
`/mcp` with the installation key from `config.json` (3 s timeout) and registers every
returned tool as a native pi tool named `agentcommons_<tool>`, with the server's JSON
Schema as its parameters, the server's description (governing sentence included) and a
one-line prompt snippet. Each call POSTs `tools/call` (60 s timeout, pi's abort signal
honored) and returns the text content with `structuredContent` as details, or fails the
tool when the server answers `isError`. The catalog is therefore the same
permission-filtered, installation-gated list every other client sees; nothing is
redeclared by hand, dashboard tools appear only for keys granting the `dashboards` group,
and admin tools only for keys with effective admin authority.
A missing, unreachable or rejecting server registers no tools, appends one line to
`hook.log`, and leaves capture untouched. The bridge speaks only the stateless
JSON-response subset of Streamable HTTP that §8.1 configures.

---

## 9. Auth, audit, moderation

### 9.1 Login

Better Auth (Prisma adapter; `admin`, `organization`, `apiKey`, `genericOAuth`, `sso`, `openAPI`). Configure
email/password and/or one social or OIDC provider (Appendix B); the server refuses to
boot with none. Optional `AUTH_ALLOWED_EMAIL_DOMAINS`. `AUTH_SIGNUP_MODE` `invite`
(default) | `open` | `closed`. **Bootstrap**: `pnpm db:seed --admin <email>` prints a
one-time credential; there is no "first matching email becomes admin". Password
initial setup links are shown to authorized admins in the dashboard for manual delivery.
Customer/public mode sends no invitation emails. SaaS verification and welcome email
are defined in §9.6; adding members remains the same email-list workflow.

Bootstrap accepts `--organization <slug>` and `--name <name>` to create an organization
and its first owner; omitted organization options select the default organization for
self-hosting. Existing accounts receive membership without resetting their password.
Bootstrap is idempotent and never exposed as a public route. Public password signup
is disabled outside SaaS mode through Better Auth's `emailAndPassword.disableSignUp`;
customer password identities are provisioned by an authorized admin. `AUTH_SIGNUP_MODE` controls verified
SSO identity creation (`open`) or admission of pre-provisioned identities (`invite`),
with `closed` admitting existing identities only. SSO signup grants no organization or
corpus access by itself, except for the explicit verified-domain enrollment below. Members can belong to multiple
organizations. Cookies use a server-validated active organization; API keys always use
their bound organization and ignore browser selection.

Owners/admins enter one or more email addresses and a role in a text form. Better Auth
identities and memberships form the organization access list; do not duplicate it in a
custom allowlist table. Existing memberships are reported without changing their role.
New identities have no password until setup. Verified email from a configured trusted
SSO provider may link to the provisioned identity. Password access requires an
admin-provided, expiring, single-use Better Auth setup link or one-time credential;
knowing an allowed email address is insufficient. General signup cannot overwrite an
existing provisioned identity or claim its membership. Email addresses are normalized
and validated. No email delivery, CSV import, or separate acceptance flow is required.
An organization admin can issue or reissue initial setup only while the identity has
no authentication accounts and belongs to exactly that organization. An unclaimed
identity cannot join a second organization until password setup or verified SSO
establishes it. Establishing an account invalidates outstanding initial setup tokens.
Organization admins cannot reset an established global identity, including an SSO
identity. Global account recovery is an instance-operator CLI operation,
`pnpm db:recover --email <email>`, using Better Auth's native expiring reset token
and manual delivery. User and organization locks serialize provisioning and changes.
Role changes and member removal/suspension take effect on the next request, including
API-key calls. Only owners grant owner authority; no operation can remove, suspend, or
demote the last active owner. Better Auth owns identity and membership lifecycle;
services enforce these constraints and audit them. Operators configure email/password
and/or the existing instance login provider; SCIM, group sync, and per-organization
identity-provider configuration beyond native Google domain access is outside this spec.

**Sign-in domains (ADR 0049).** Organization owners and administrators manage Google
sign-in domains on Settings: list the current organization's domains and add an exact
domain. Allowlisting by an owner/admin is the approval: `POST /admin/domains {domain}`
registers the native Better Auth SSO domain binding for the current organization and
marks it verified in the same audited transaction. There is no DNS TXT proof, no
`/admin/domains/verify` route and no `dns_record`. The operator CLI (`pnpm db:domain`)
calls the same audited service with a real owner/admin cookie. Better Auth owns
registration and ordinary `member` provisioning; Google continues to use
`/auth/callback/google`. Writes require a real owner/admin cookie and current
organization authority; API keys cannot allowlist domains. Lists are bounded, filtered,
sortable and paginated. The write route is registered, and `GET /admin/domains` reports
`enabled: true`, only when Google is the sole configured login provider and signup is not
`closed`; otherwise the service refuses with `DOMAIN_ENROLLMENT_DISABLED`.

An allowlisted domain admits matching Google-verified identities under
`AUTH_SIGNUP_MODE=invite` as well as `open`. A nonempty operator email-domain allowlist
still restricts admission; `closed` disables new identities and domain provisioning.
Unverified emails, wrong or sub-domain matches and ambiguous multi-organization matches
never gain access. Existing roles are unchanged, and a password email suffix alone grants
no membership. Settings explains Google sign-in domains separately from adding people by
explicit email on Users. Accepted risk and mitigations are recorded in ADR 0049.

Removing a member retains a native membership marked `removedAt` and suspended, so a
later matching Google login cannot silently restore access. Removed memberships are
absent from application lists, organization selection and member denominators, and
confer no cookie, key or worker authority. They remain visible to the SSO plugin's
existing-member check. Explicit authorized add-people can restore access with the
requested permitted role; ordinary login cannot. Suspension and restoration retain their
existing key-authority semantics. Better Auth models and additional fields are generated,
never hand-edited. See ADR 0035.

Removing an unclaimed identity invalidates its outstanding initial password-setup
tokens before it can join another organization. It does not invalidate global recovery
tokens for established identities.

### 9.2 Authorization

`authenticate` accepts a cookie session or an API key (`Authorization: Bearer` /
`x-api-key`). `requirePermission`. Visibility lives in the `api_ro` views and the
repository layer, never in handlers. Read scopes cannot mutate; keys cannot mint keys.
Key permissions are three groups: `sessions` (`ingest`, `read`) authorizes REST and MCP
reads and uploads; `tools` (`dashboards`, `administration`) exposes an opt-in MCP tool group
on top of `sessions:read`; `dashboards` is grantable by any member, while `administration`
(ADR 0072) is valid only with `admin: ["*"]` on the same key, which the shared permissions
schema enforces, so only owners and admins can mint it and it is effective only while they
keep that membership; `admin` (`*`) is grantable only by owners and admins and effective
only while the issuing user keeps that membership (§7.5). Cookie sessions hold every group
their membership allows. A group absent from a stored key is
absent from its parsed permissions, so keys created before a group existed simply lack it.
Key names contain 1–128 characters; optional `expires_in` is 1–31,536,000 seconds.
Omitting expiration creates a non-expiring key. Native Better Auth settings enforce
the same bounds as the shared input schema.

**Verification failures are not rejections.** `authenticate` answers `401`
(`INVALID_API_KEY`, `SIGN_IN_REQUIRED`, `INVALID_AUTHENTICATION`) or a `403` gate only
when the lookup completed and found no matching, enabled, unexpired key or session, or a
closed membership gate. Any failure to verify (a PostgreSQL error, statement or lock
timeout, pool exhaustion, a Better Auth error other than an explicit 401/403 verdict) is
`503 AUTH_UNAVAILABLE` with `detail.retry_after` and a `Retry-After` header, the same
retryable shape as `429` and `AUDIT_UNAVAILABLE`, classified by one helper
(`apps/api/src/auth/failure.ts`) behind every adapter (REST, MCP, SSE re-authentication),
logged with its cause and request id, and audited as `auth.failure` with status 503 and a
null organization. Better Auth's `verifyApiKey` reports an exception inside its own lookup
as `INVALID_API_KEY`, indistinguishable from a missing key, so that negative is confirmed
against the stored key digest: a missing row is a rejection, an existing row or a failed
confirmation is `AUTH_UNAVAILABLE`. The shim therefore never suspends a session on a
server that could not check its key (§6.2 step 3).

**Recoverable keys (ADR 0051).** Better Auth keeps only the hash for verification; the
plaintext of every key is also stored encrypted in `api_key_secret`, written in the
transaction that creates the key: AES-256-GCM, a random 12-byte IV per row, the key id as
associated data, and a key derived once per process from `BETTER_AUTH_SECRET` with
HKDF-SHA256 (`agentcommons/api-key-reveal/v1`). `POST /me/keys/:id/reveal` returns
`{ key }` for the caller's own active key in the current organization. Only cookie
sessions may call it: a request authenticated with an API key receives 403
`KEY_REVEAL_SESSION_REQUIRED`, and another member's key, another organization's key or a
revoked key is 404. Every reveal writes one `keys.reveal` AuditEvent with the key id as
resource and no secret in detail. Revocation, own or admin, deletes the encrypted row in
the same transaction, so a revoked key can never be recovered. The encrypted copy is never
used for authentication and no MCP tool exposes it. The dashboard offers "Copy key" on
each active key, and the Install page fills the installer command with an existing key
instead of asking for a value the person saved.
Every service receives `organizationId`. Repository reads/writes, cursor signatures,
cache keys, SSE subscriptions, policy caches, rate limits, and background-job budgets
include it. Unrelated-organization IDs behave as missing resources. User-level keys,
client-supplied organization overrides, and stale or suspended memberships are rejected.

### 9.3 Audit

`AuditEvent`: `id`, `organizationId`, `ts`, `requestId`, `userId`, `apiKeyId`,
`installationId` (the installation most recently seen ingesting with this key in this
organization, so agent reads can be attributed to the session active on that machine),
`authMethod`, `ip` (trusted-proxy chain resolution), `userAgent`, `transport` (`rest` |
`mcp` | `web`),
`action`, `resourceType`, `resourceIds`, `statusCode`, `durationMs`, `detail` jsonb
(redacted; ≤ 8 KB). Written in the mutation transaction for writes, before the response
for reads; authentication failures audited (rejections and `503 AUTH_UNAVAILABLE` alike,
as `auth.failure` with the status and code, §9.2); health and static assets not. Retention
`AUDIT_RETENTION_DAYS` (default 365). Append-only otherwise. MCP handshake rows fold per
window (§8.1, ADR 0072); operation rows never do.
Failures before an organization can be authenticated have a null organization and are
visible only to instance operations, never through organization audit queries. All
identified operations, including membership and invitation changes, carry their scope.
Audit writes resolve installation attribution in the same transaction as mutations, so
the first accepted ingest can attribute its own audit row. Cookie operations, keys with
no accepted ingest, and historical rows without attribution have null installation ids.
The composite installation foreign key prevents cross-organization attribution. The audit
projection worker, which copies audit rows into ClickHouse, also credits each successful
key-authenticated MCP/REST `search`, `get` or `sql` row to the sessions active on its
installation at that instant and stores those `session_reads` rows in the same flush; the
reuse relations of §10 read them (ADR 0060). A one-time backfill derives the rows for the
audit history retained when the table is introduced and records completion.

### 9.4 Public exposure

helmet, CORS to `PUBLIC_URL`, rate limits (ingest 600/min per key; read 300; `sql` 60;
MCP 120; auth 20/min per IP), secure cookies, CSRF origin checks, body limits, versioned
immutable client artifacts, optional AWS WAF in prod. `ac_` prefix for secret scanners. The exact
`POST /auth/stripe/webhook` endpoint accepts server-to-server delivery without a browser
Origin; the official Stripe signature over the untouched raw body remains mandatory.
Browser checkout and portal mutations retain the normal Origin check. Request logs omit
query values and native password-reset token path segments.

### 9.5 Private and purge

**Private**: hidden from members everywhere (lists, search, SQL, `get`, MCP), including
from the uploader's own key; organization-admin-only; reversible. Named "admin-only" in the UI.
**Purge**: one control transaction serializes against ingest and readers, installs the
irreversible tombstone, clears normalization contexts and records a durable cleanup
outbox and audit. Native row policies hide the corpus immediately, including from
admins; admin session views expose only the retained identity skeleton. Subsequent
appends return `409`, and all workers check the tombstone.

The response reports `cleanup: queued` until physical ClickHouse deletion is complete.
Native deleted-row counts are nullable while pending. The worker captures an exact
manifest before deletion, removes raw records/messages/files/vectors across every
revision and generation, and records completion. Failed deletion stays hidden and
retries with the original manifest; repeated purge requests retain its counts. Compact
identity, admission/usage ledgers, receipts and redacted audit survive. PostgreSQL
redaction-event rows are deleted in the initial transaction. Backups are outside the
manifest and documented as such.

**Moderation list.** `GET /admin/sessions` lists every session the organization holds in
`trace_session_control`, whatever its publication, visibility or purge state, so an admin
sees exactly the set `/admin/sessions/:id/visibility` and `/admin/sessions/:id/purge` act
on. The reader views (`api_ro.sessions` and everything built on it) admit only sessions
with a published revision, so a capture whose projection is `queued`, `waiting_source`
(the native transcript never arrived) or `failed` is absent from every list a member
endpoint serves; here it appears with that state. Each row carries identity from control
(harness, harness session id, user email, hostname, start, last activity, status),
`visibility`, `purged_at`, `published` (a published revision exists), `projection_state`
and the parent link, plus the published title, repository and message count of the page's
published rows from one id-bounded read of `api_ro.sessions` inside the same publication
fence. Filters are user email, harness, status, visibility, purged, published, one session
id, a `started_at` window and `roots_only`; sorting is by start, last activity, user,
harness, status, visibility or purge time; paging uses offset cursors to the end;
`total.sessions` is the window count of the page's own control scan (§7.5 item 4). The
route requires effective admin authority and audits `sessions.moderation`. The dashboard's
Moderation page reads only this route: visibility, purge and publication are columns and
filters, and the matching count is shown beside them.

**Where the actions live.** The session page offers organization owners and admins (the
membership role the admin routes enforce) the same visibility and purge actions from its
header, through the same admin routes and the same confirmation dialog as the Moderation
page, so the audit rows do not change. Members see no control. The page shows the result
at once: a Private badge in the header, a purge notice, the purged skeleton's empty
transcript.

---

### 9.6 SaaS signup, usage and billing

`INSTANCE_MODE=saas` enables the hosted product in the same application. Customer remains
the default and public mode adds only public discovery. SaaS uses the same organization,
permission, ingest, search and audit services. It does not relax tenant isolation.

**Signup.** SaaS permits public email/password and configured Google/OIDC signup through
Better Auth. A password signup must verify its email using Better Auth's native expiring
verification link before creating an organization or accessing a corpus. SaaS corpus authority
requires current email verification for both cookies and keys, including identities
provisioned before SaaS was enabled. Native implicit account linking requires the local
email to be verified in SaaS, preventing an unverified public password preclaim from
inheriting a later Google identity. Customer linking remains unchanged. A trusted
provider's verified email satisfies verification. Existing memberships and provisioned
identities retain the §9.1 protection against account takeover. A verified user without
an eligible organization submits an organization name to create one organization and become
its owner through Better Auth's organization API; the URL slug is derived from the name
on the server and suffixed until unique, and the UI has no slug field. Onboarding is serialized and idempotent;
retries or simultaneous initial requests cannot create additional organizations. An existing
eligible membership, including verified-domain enrollment, goes to the organization picker
or dashboard instead. SaaS users with verified native cookie sessions can explicitly create
another organization from that picker. Each new organization has its own owner membership,
keys, sessions and billing allowance. `POST /me/organizations` uses the same name and
result schemas as onboarding. Automation may pin a slug; retrying an existing slug owned
by the caller then returns the same organization without renaming it, and other pinned
slug collisions return 409. Removed or
suspended memberships cannot be restored through this action. Customer/public organization
creation remains operator-only. See ADR 0043. SaaS public
signup does not require a global domain allowlist; an explicit native verified-domain
binding is the allow rule for optional domain enrollment. Suspended/removed memberships
are never restored by signup or login.

**Email.** SaaS native verification/reset hooks use a configured email transport. Emailed
SaaS password recovery is an explicit exception to §9.1 operator-only global recovery;
customer recovery remains manual. Welcome email
is queued durably after verified signup and successful onboarding, once per identity,
with the application URL and setup guidance. Delivery failure retries independently and
cannot undo an account or grant membership. A persisted delivery marker plus pg-boss job
idempotency prevents duplicate enqueue; an ambiguous provider response may retry the same
provider idempotency key when supported. Customer member access never depends on outbound
email. Local verification uses an SMTP capture server; production uses a verified sender
through a standard mail/SES library. Real email delivery requires configured credentials
and a verified sender. Test sinks are identified as local delivery, never live delivery.

**Plans and units.** Customer/public deployments do not enforce SaaS allowances or send
billing usage. SaaS Free includes 1,000 newly accepted raw records per organization per
UTC calendar month. Pro costs $100/month and includes 10,000 records per native Stripe
billing period, followed by a configured USD rate per 1,000 records. Optional embeddings
add $50/month and a separate configured rate per 1,000 successfully indexed messages.
The native plans have distinct primary prices (`pro` $100 and `pro_embeddings` $150).
All allowances and usage rates come from shared validated operator configuration; absent
meter prices/rates disable online checkout. Local demonstration rates are labeled as such.

A capture unit is a newly persisted `RawRecord.id`, after the existing harness-neutral
source identity/deduplication algorithm. Retries of the same accepted source key do not
count again. A newly accepted version of a rewritten native document is a new record;
resumes and uploads count only their new records. No separate billing parser interprets
native payloads. Records present before SaaS admission is enabled are grandfathered.
A message usage unit is a `Message.id` whose complete vector chunks were first successfully
indexed. Query vectors, session-summary vectors, chunks, retries and repeat indexing of
that ID are not additional message units. Stale, failed or discarded embeddings do not count.
Immutable admission ledgers survive transcript purge without retaining transcript text.

Free capture admission and its count check share the ingest transaction and organization
lock. A batch that would exceed the free allowance returns typed HTTP
`402 USAGE_LIMIT_REACHED` and commits no records, usage or partial projection. The shim
retains its exact pending batch and acknowledged cursor for retry after upgrade/month
reset. Duplicate-only uploads, lifecycle receipts and authorized reads remain available.
Pro capture has metered overage instead of a hard cap. Paid records use the authoritative
subscription's paid period; upgrading does not retroactively bill Free records.

Paid admissions atomically append a durable Stripe meter outbox event. The official SDK
sends immutable customer/event/value/timestamp/identifier payloads, serialized per customer
and meter. Each attempt reuses the same identifier and idempotency key. Stripe guarantees
identifier uniqueness for at least 24 hours, so an ambiguous event is never blindly retried
after a conservative 23-hour window from its first dispatch. It enters a visible
`reconciliation_required` state for operator investigation. Events older than Stripe's
35-day timestamp window also require reconciliation. Pending and reconciliation counts
are visible in organization usage and operational status; no response timeout is treated
as proof of delivery. See ADR 0046.

**Stripe.** Better Auth's native Stripe plugin owns organization customers, subscription
models and checkout/portal/webhook lifecycle. Only a current, active organization owner
using a browser session may create checkout or portal sessions. References, configured
Pro price and return URLs come from the server, not arbitrary client values. Every
active member can read organization usage. Pro entitlement requires a verified Stripe
subscription matching the configured Pro price in `active` status and its current paid period; cancellation at period end
retains entitlement through that period. Incomplete, past-due, unpaid, expired or canceled
subscriptions do not grant Pro. No paid trial is defined. A checkout return URL never
grants entitlement. Signed raw-body webhooks update native subscription state idempotently;
failed persistence or provider reconciliation must be retryable. Any required correction
to the native plugin is documented and tested, not replaced by a custom billing engine. Existing-subscription
plan changes project the actual returned Stripe status and period through the same native
field mapper used by webhook updates; a returned `past_due` subscription never retains
previously active entitlement. Entitlement commits take the organization publication lock
after remote SDK work, so one bounded trace read cannot straddle a paid-state change.

The usage API/page shows plan, native paid-period or Free UTC-month boundaries, records,
included and overage records, successfully indexed messages, estimated usage charges and
meter delivery status. Owner actions open Stripe Checkout, select the optional embeddings
plan or open its customer portal. The public billing
configuration contains only mode, plan allowances/pricing, checkout availability and an
optional configured Cal.com URL. No tenant usage enters public configuration/discovery.
Absent Stripe credentials disable checkout with a clear setup message; local protocol
tests cannot be represented as live Stripe validation. Test-mode Stripe is used for
end-to-end billing validation when test credentials are supplied; no real charges are made.

**Public SaaS UI.** Landing pricing shows Free, $100/month Pro and Enterprise with a demo
CTA. Primary calls to action lead to `/signup`; authenticated users can reach `/app/billing`.
The operator supplies an HTTPS Cal.com booking URL; an accessible responsive embed and
open-calendar fallback are shown for enterprise/demo actions. Enterprise describes white-glove
on-premises or single-tenant deployment and identity integration services; it does not claim
that an unimplemented LDAP connector already exists. Missing
calendar configuration shows an honest unavailable state. The footer says “Made in San
Francisco.” A SOC 2 logo or attestation claim is only published after the operator supplies
a completed report and approved wording; no certification is implied by the application.
Signup, verification, onboarding, quota/upgrade, portal and demo flows meet §16's browser,
mobile, theme and accessibility requirements. Customer mode hides SaaS pricing and billing.

See ADR 0038. Deployment is still deferred; a local SaaS demo is a separate isolated
runtime using private configuration, native auth and real supported-harness sessions.

## 10. Dashboard

The dashboard is one single-page application. Public pages (`/`, `/docs`, and `/blog` in
public and SaaS modes), account pages (`/login`, `/setup-password`; SaaS adds `/signup`,
`/forgot-password`, `/verify-email` and `/onboarding`) and the authenticated application
under `/app` share one router. Nothing is served at the pre-`/app` paths (`/home`,
`/sessions`, `/installation`, `/usage`, `/s/<id>`): there are no redirects, aliases or
compatibility routes anywhere in the application, and server-generated return URLs
(Stripe, setup links) point at the current paths only (ADR 0048).

**Information architecture.**

| route                                                                                                                                                  | purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/app`                                                                                                                                                 | Home: the organization's default dashboard (the shipped Team overview until an admin picks another) with the dashboard switcher, variable controls and New/Duplicate/Edit actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/app/dashboards/new`, `/app/dashboards/:id`, `/app/dashboards/:id/edit`                                                                               | create, view and edit a dashboard (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/app/sessions`                                                                                                                                        | search box and filter chips mirroring §7.2, two usage selects while the Sessions view is showing (Searched, Used prior work: either, only with, only without) that set the list's `searched` and `used_prior_work`, result blocks exactly as `search` returns them, and the list view of root sessions only (`roots_only`); a root's subagent runs are shown inline inside it, never as separate top-level rows. A hit inside a child run links to its root, `/app/sessions/<root_session_id>?child=<child_session_id>#<seq>`, using the hit's `root_session_id`; the root page opens that run and scrolls to the message. Above the rows the page states how many sessions and messages match the current filters (`total.sessions`, `total.messages` of the list response) and, in the Messages view, how many hits in how many sessions match the words and filters (`total.hits`, `total.sessions` of the search response); the counts come from the same response as the rows, so they always belong to the current query, and a pending query shows a placeholder rather than the previous query's numbers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/app/sessions/:id` (`#<seq>` deep link)                                                                                                               | session detail (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/app/sql`                                                                                                                                             | IDE-style SQL editor (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/app/install`                                                                                                                                         | Install, the first page a developer is sent to, as four steps: create an ingest/read key for the machine (secret shown once; dismissing the reveal keeps that key selected and the page offers no second key until it reloads) or pick an existing recoverable key, one path at a time; read what the installer needs and does (Node 20+, curl, capture hook, MCP registration, per-tool notes); run the served installer command, which appears with its Copy button only once a key is created or picked and is disabled with a hint before that (no placeholder is ever offered to copy), with the note that the key is exported from the shell startup files and Codex needs a new terminal; start a coding agent and watch this machine's sessions arrive: only sessions uploaded with the step 1 key (`filters.ingest_api_key_id` with `user_email`, one scan), each with its installation hostname, and a prompt to choose a key before any polling, since a shared key attributes every machine's sessions to one member. The prepare step says the installer writes the §8.3 guidance into each tool's global instructions file and offers the repository block for teams to commit: the panel says the first captured session in a checkout writes the block itself (§6.2, ADR 0071) and keeps the manual step behind a native details/summary disclosure ("Optional: add it now"): the `hook.js guidance --repo .` command with its copy button, the `--off` and machine-level switches, and the block's text with its own copy button (§8.3, ADR 0069); the default flow is the key and the install command |
| `/app/keys`                                                                                                                                            | Keys: the caller's keys only (create shows the plaintext once with the install command inlined; sort, CSV export, revoke with a reason; keys show their bound organization)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/app/api`                                                                                                                                             | API reference: the live Scalar reference from `/api/docs` embedded inside the application shell with an "Open in a new tab" action; its CSP allows same-origin framing only. Linked from the bottom of the navigation, not from Keys                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/app/billing`                                                                                                                                         | SaaS only: plan, usage, checkout and portal (§9.6). Customer and public instances have no billing route in the router, the API or navigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/app/organizations/new`                                                                                                                               | SaaS only: create another organization from a name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/app/admin/users/:id`                                                                                                                                 | one member: details, activity dashboard and their sessions (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/app/admin/users`, `/app/admin/keys`, `/app/admin/audit`, `/app/admin/moderation`, `/app/admin/redaction`, `/app/admin/status`, `/app/admin/settings` | organization administration (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Organizations.** After login the application lists only the user's memberships. When no
organization is active the first membership is selected automatically, so nobody lands on
an empty picker; the switcher in the top bar changes it, and the choice persists on the
server. With no membership the user sees an access-required state (SaaS users go to
onboarding). Switching clears prior data and closes live streams before
loading the new organization's data. Every data screen shows the active organization.
Members who open an admin URL see an access message before any admin controls render or
admin data requests run; server authority checks remain mandatory. Organization creation
(SaaS onboarding and `/app/organizations/new`) asks only for a name; the URL slug is
derived on the server and suffixed on collision (§9.6). The UI has no slug field.

**Return to the requested page.** A signed-out visit to any `/app` page (a shared session
link with its `#<seq>`, a dashboard) goes to `/login?next=<path>`, where `next` is the
requested pathname with its query and hash; a signed-in account with onboarding pending goes
to `/onboarding?next=<path>` the same way. Sign-in returns to `next` (the password form
navigates there; the provider button passes it as Better Auth's relative `callbackURL`),
the Create-account link carries it to `/signup`, and the SaaS chain keeps it through the
verification link, `/verify-email`, `/forgot-password`, `/setup-password` and
`/onboarding`, which opens `next` instead of Home (or Install after creating an
organization) once the account is ready. `next` counts only as a same-origin relative path
under `/app` (one leading slash, then `/app` at a path boundary; no scheme, host,
backslash or whitespace); one helper in the dashboard (`returnPath` in `lib/routes.ts`)
decides, every consumer goes through it, and anything else falls back to the default
destination. Without `next` nothing changes, and `/app` itself never carries one because
every flow ends there anyway.

**Dashboards (ADR 0048).** A dashboard is an organization-visible object: any member
creates one, the creator or an organization owner/admin edits or deletes it, every member
sees all of them, and admins mark one as the Home default. Two read-only built-ins ship
with fixed ids (`builtinDashboardIds` in `packages/core`; the registry `builtinDashboards`
in `packages/core/dashboards` is the only place the service reads them): "Team overview"
(`…0001`: captured sessions, search adoption and reuse) is the Home default until an admin
picks another, and "Team activity" (`…0002`: active people, sessions, messages, tool calls,
tokens, repositories, session duration and coding tools per person, for managers) is listed
next to it but is never the default, because "no saved default" always means the Team
overview; an admin duplicates Team activity to make the copy the default, and `POST
/dashboards/:id/default` refuses any other built-in with 409. Duplicate copies any
built-in into an editable dashboard. An organization keeps at most 50 saved dashboards.

A definition is `{version: 2, variables, tiles}` validated by the shared Zod schema, which
`GET /dashboards` also serves as JSON Schema so agents and the JSON editor use one
contract: at most 8 variables and 1–24 tiles within 64 KB. Tiles are `stat` (value column,
optional compare column, unit), `chart`, `table` (optional column subset), `text`
(Markdown) and `control` (binds a declared variable), each with an id, title and
`layout {x, y, w, h}` on a responsive 12-column grid rendered and edited with
react-grid-layout. Every data tile is one ClickHouse `SELECT` executed through the existing
guarded query service (§7.4) with the viewer's current visibility at render time;
definitions never store results. Charts are an allowlisted Apache ECharts option: series
types line, bar, pie, scatter, gauge and heatmap, `encode` bindings to result columns,
axes, legend, tooltip, grid, colors, zoom, visual map and polar blocks as style objects.
Style blocks are a bounded, non-recursive type (at most three nesting levels of records
with scalar or scalar-array leaves; no `z.json()`), because JSON carries no functions and
because `GET /dashboards` and `dashboard_list` serve this schema to agents, which the
Gemini API rejects when it is recursive. Unknown keys are rejected. MCP `tools/list`
advertises the compact tool-facing rendering of §8.2 and validates calls with this schema.

Rendering a saved or built-in dashboard runs its data tiles four at a time and caches each
tile's result in the API for one hour, keyed by organization, caller scope (admins share
one entry; each member has their own because row policies show them their private
sessions), dashboard revision, resolved variables and the organization's published-session
version: the counts of published unpurged, purged and private sessions in
`trace_session_control`, one PostgreSQL aggregate read before the cache is consulted
(ADR 0064). A newly published session, a purge or a visibility change therefore misses on
the next render; messages added to an already published session do not move the version,
so a hit may still be up to an hour old in that respect (ADR 0058 had dropped the
activity-based data version because it moved every few seconds). A tile whose query failed is returned with its
error but never cached, so the next request retries it alone while the other tiles come
from the cache; `refresh: true` re-runs the requested tiles and replaces their entries; a
save bumps the revision; inline definitions (editor previews) are never cached. A
`dashboard-prerender` job runs at startup and at the top of every hour: for each
organization it re-renders the default dashboard and every saved dashboard, with default
variables, for up to 20 caller scopes that rendered a dashboard in the last seven days
(taken from `dashboard.render` audit rows, most recently active first), re-validating each
scope's membership and key and skipping, with a 403 audit row, those that lost access;
each scope's run is audited as `dashboard.prerender` by the worker actor, and one
organization's failure does not stop the others. The response reports `rendered_at` (the
oldest returned tile's run) and `cached` (true when no tile ran); the page shows when the
data was rendered under the tiles, and Refresh re-runs them. The MCP dashboard tools render
compact text from `packages/core/format/dashboards.ts` while `structuredContent` carries the
full validated result: `dashboard_list` is one line per dashboard (id, name, tile count,
default/built-in/editable flags, updated_at, description) plus the template ids and where the
definition JSON Schema lives, never a definition; `dashboard_get` and `dashboard_save` show
header facts, variables and tiles as tables and each data tile's SQL once; `dashboard_render`
opens with the tile count, `rendered_at`, its age in words, whether the result came from the
cache and that `refresh: true` re-runs the tiles, then each tile's rows in the `sql` text
format or its error (ADR 0064).

Variables are typed query parameters that a tile may reference as `{name:Type}` only when
the dashboard declares them: `time_range` exposes `{name_from:DateTime}` and
`{name_to:DateTime}` from a preset (24h, 7d, 14d, 30d, 90d, this week, last week, this
month, all) or an explicit range; `repo`, `harness` and `user` expose
`{name:Array(String)}` where an empty array means all; `text` exposes `{name:String}`. The
guard rejects undeclared or mistyped parameters when a dashboard is saved and again when
it renders. Names, descriptions, titles, SQL and chart options are redacted before
persistence. Updates require the saved revision; a stale revision returns 409. Rendering
returns each tile's rows or its error so one broken tile does not blank the page. The
editor offers starter tile templates (captured sessions, sessions that searched, sessions
reusing prior work, reuse rate, weekly reuse trend, sessions per day, harness share, top
tools, top repositories, most reused sessions, active people, messages, tool calls,
sessions per person, activity per person, sessions per day by person, repositories per
person, average session duration per person, coding tools per person, recent sessions),
every one of which is a tile of a built-in dashboard, a tile inspector with the
SQL editor and schema browser, chart option JSON, and a JSON view of the whole definition
with the same validation. No custom scripts or executable chart declarations.

REST: `GET`/`POST /dashboards`, `POST /dashboards/render`, `GET`/`DELETE /dashboards/:id`
and `POST /dashboards/:id/default` (admin). MCP: `dashboard_list`, `dashboard_get`,
`dashboard_render`, `dashboard_save` and `dashboard_delete` for read keys that grant the
`dashboards` tool group and `dashboard_set_default` for effective admins with the group
(§8.2; absent from the default catalog). Both adapters call one service; each
operation writes one audit event. The audit page lists each event with the acting user's email (`user_email`, resolved at read time) beside the action, status and resources, so admins never decode ids. Dashboards are a Prisma `Dashboard` control model
(organization and author foreign keys, immutable authorship, one default per
organization); the personal `DashboardProfile` rows of ADR 0045 are dropped.

**Home KPIs.** Home shows the default dashboard. The Team overview's first row holds the
four counts and rates for the selected time range and repositories: captured sessions,
sessions that queried AgentCommons (a `search` or `sql` call while active), sessions using
prior work, and reuse rate, computed by
stat tiles over `api_ro.sessions`, `api_ro.metrics_search_sessions` and
`api_ro.metrics_reuse_sessions`. There is no dedicated Home API; the reuse, impact and gap
relations remain available through `sql`, the metric API and dashboard tiles.

**Session detail** (`/app/sessions/:id`): a header that shows every field the `get`
header carries with human labels and copyable ids; a Details panel with token totals,
models used, installation, cwd, entrypoint, start and end commits, end reason, and links;
a bounded virtualized transcript whose rows show role, kind, tool name, timestamp, and the
model when it changes, with token counts and raw record id on hover; collapsible tool
blocks and thinking toggle. Organization owners and admins get a Moderate menu in the
header with the Moderation page's visibility and purge actions (§9.5); a private session
shows a Private badge and a purged one a purge notice; members see neither control. The
transcript reads `get` with `page_bytes` at the 256 KB
page cap: a head page from the start (or two messages above a deep link), which is the
only request that computes the session header, then the remaining seq ranges up to
`message_count` with `header=false`, sized from the head page's bytes per message so one
range usually fits one page, with at most three requests in flight and the first sixteen
ranges loading without a reader's action; each range renders as it lands and a "Load
more" control takes over beyond them. An active session's status and count come from the
live stream's own events; a header-only read (`from=0&to=0`) under the stream's
invalidation key is polled every 5 s only while the stream is down; growth extends the
ranges instead of re-reading loaded pages (ADR 0061). Each part of the page fails on its
own with a notice naming it (session header, messages, subagent runs, reuse) and a retry;
a later range failing leaves the header and the messages before it on the page; **subagent runs inline, as a tree**: the root session's page
takes its subagent, fork and spawned child sessions from `/sessions/:id/tree`. A child
whose `parent_tool_use_id` matches exactly one loaded `TOOL_USE` message nests directly
under that tool call as a collapsed "Subagent run" block (relation, agent type, title,
status, a link to its own page) that expands to a bounded page of the child's messages
from `get` with the same load-more paging; its own children nest the same way. Children
whose call is unrecorded (pi forks, Gemini, env-spawned sessions), ambiguous, or not on a
loaded page stay in a "Subagent runs" section after the transcript, and that section
disappears once every child has found its call. So a root session reads as one
investigation, and the UI never invents a spawning link the harness did not record
(ADR 0052). A deep link `?child=<session_id>#<seq>` on the root page opens that run
where it sits (under its call or in the section), loads the child's pages until `seq` is
present and selects that message; the plain `#<seq>` hash keeps selecting the root's own
message. Search hits and `get` child refs carry `root_session_id` and
`parent_tool_use_id`, and the `get` text header lists each child with `spawned_by`, so
a reader or an agent places a child under its call without another call. The sessions
list sends `roots_only`
and offers an "Include subagent runs" toggle; its Subagents column shows `child_count`.
Its six default columns are title, repository/branch, user, started, messages
(`message_count`) and status, the set that reads at 1024 px beside the sidebar; coding
tool, model, hostname, duration, tool calls, commits, reused by, searched
(`agentcommons_search_calls`), used prior work (`reuses_made`) and subagents wait in the
column chooser. The two usage columns show a check mark with the count, or a dash for
zero, and the CSV export carries the counts. Counts and durations are right-aligned, and
every column header except
Subagents sorts on the server in both directions through the list's `sort` and `order`.
The two usage selects beside the filters (either, only with, only without) drive
`searched` and `used_prior_work` on the list, live in the URL like every other filter, are
cleared with the filters, and are shown only while the Sessions view is active because the
Messages view's `search` has no such parameter.
Beside the list controls it shows the response's `total.sessions` and `total.messages`
("128 sessions · 4,210 messages"), and the Messages view heads its results with
`total.hits` in `total.sessions` ("12 hits in 4 sessions"); both are server counts over
everything the current filters or words match under the caller's visibility, never a
count of the rows on the page.
The `get` text header ends with a `subagent_runs` line naming the child sessions so an
agent can follow them; a **Reused by** panel listing every later session that read this one
through `get` (session, user, harness, when) and a "Reused from" list of the sessions this
one read; a Raw tab paging the redacted raw records; a **Download CSV** action beside the
header actions that saves the whole session through `GET /sessions/:id?format=csv`, one
row per message with the `get` message columns (§7.6); live tail over SSE with 5 s polling
fallback while `ACTIVE`; the parent link and a tree view fed by `/sessions/:id/tree` with
the current session highlighted and forks and spawned sessions labeled. Messages stay in
source order, with results nested only under an unambiguous matching recorded tool-use ID.
Messages link to `/app/sessions/<id>#<seq>` and can expand their content. A child session
attaches to its recorded parent session and, when recorded, to its spawning call.
Hidden nodes remain gap markers for admins only and never load messages. Repository,
branch, start SHA and end SHA are visible in the transcript header; validated GitHub,
GitLab and Bitbucket Cloud repositories have clickable branch/commit refs, while other
hosts retain a safe repository link and copyable values (ADR 0041). Missing Git
observations display an unavailable state. "Similar sessions" appears when embeddings are
on.

**Sessions list** columns are title, harness and version, model, repo and branch, user,
host, started, duration, messages, tool calls, observed commits, **reused by** (count) and
status, with a column chooser and CSV export.

**SQL** (`/app/sql`) is an IDE-style editor built on an established editor library: full
width, syntax highlighting, live parser diagnostics and completion from the
caller-authorized canonical schema (tables, columns, functions and descriptions), an
in-flow schema browser from `/schema`, responsive results with CSV export, and a "Copy
for your assistant" action that copies one deterministic Markdown reference for an LLM
(`packages/core/format/schema-context.ts`): a framing paragraph addressed to the
assistant, the rules and limits, every authorized view with its catalog purpose and every
column with type and meaning, the table functions, view relationships, common patterns,
three worked examples and the function allowlist.
Diagnostics are advisory; the service remains the query authority. Ctrl/Command+Enter
runs, Ctrl+Space opens suggestions, and Tab leaves the editor. Completion and diagnostics
remain usable at 320/390 px without horizontal document expansion.

**Admin.** People (adding people by email, password setup links, role changes,
organization membership suspension/removal; each row carries "Last seen", the member's
newest audited dashboard request in this organization from `GET /admin/users`
`last_seen_at`, sortable, "Never" before the first; a row opens the person page
`/app/admin/users/:id`, which shows the member's email, role, status, added and last-seen
times from `GET /admin/users/:id`, their activity as the inline person dashboard
(`packages/core/dashboards/person.ts`: sessions, messages, tool calls, sessions that
searched, sessions reusing prior work, last active, coding tools and repositories, one
guarded read per distinct tile statement with `{person:String}` fixed to the member's
email and a time range starting at everything) and, below, the shared session search of
`/app/sessions` with `user_email` fixed to the member and hidden from the filter controls,
so words, filters, sort, paging and export work over that member's visible sessions
only), Keys, Audit (filters, CSV), Moderation
(every control session from `GET /admin/sessions` with visibility, purge and publication
state as columns and filters, the matching count and paging to the end; visibility and
purge with reason, §9.5), Redaction (policies, test, rescan progress, and the
ledger of §5.3: totals with 7- and 30-day windows split into capture and rescan, counts
per policy, each rescan run expanding to the sessions it changed with their counts and
the messages redacted in each, and the recent redactions as a server-paginated list sorted
by time, count or position, filtered by policy, source, session, run and policy-name search
with the filters kept in the URL and exported as CSV, every session and message a
link to `/app/sessions/:id#<seq>`; counts and positions only, never redacted text), Status and
Settings. **Status** covers operational health only: ingest per day, capture failures,
redaction hits, queue depth, embedding backlog and spend, as charts and tables, with
date/repository filters for historical health; current queue/spend snapshots remain
organization-wide. Its installations table compares each installation's `hook_sha256`
with `/hook/manifest.json` and marks it "Current", "Update pending" (the installed
digest differs; the shim replaces itself within an hour, §6.2) or "Unknown" (no upload
has reported a digest yet). It does not duplicate dashboard adoption, reuse or outcome
panels.
**Settings** holds organization embeddings (§11), sign-in domains (§9.1: list and add an
exact Google domain; no DNS proof) and the default dashboard. The existing Usage,
Outcomes and Reuse metric APIs and SQL views remain available to authorized callers and
dashboard tiles.

_North star: weekly reuse rate._ A session is a reuse session if, while it was `ACTIVE`,
the same installation called `get` on a different session id (attributed via
`AuditEvent.installationId` and the time window). Reuse rate is reuse sessions divided
by all sessions in the ISO week. The Team overview's reuse-rate tile shows it for the
selected time range; its weekly trend tile and the cross-user variant (the read session
belongs to another member) remain available through the metric API, SQL and dashboard tiles.
It is a rate so it is independent of team size, and it moves only when capture, indexing,
search, and an agent's judgment all worked. Related guardrail metrics remain available through the authorized metric API: follow-through
precision (`get` within 10 minutes on an id returned by `search`), zero-result rate, and
capture coverage. The default dashboard does not duplicate these operational panels. The view is `api_ro.metrics_reuse_weekly (week, sessions,
reuse_sessions, cross_user_reuse_sessions, reuse_rate, cross_user_reuse_rate)`, also
exposed to `sql` so an agent or a spreadsheet can read it.

The same concept exists at two finer grains, from the same audit data: per session,
`api_ro.session_reuse (session_id, reuse_count, unique_readers, cross_user_reuse_count,
last_reused_at)`, surfaced as the "Reused by" panel and list column and as `reuse_count`
in the `sessions` view and the `get` header, whose `reuses_made` (distinct earlier sessions
this one read) and `agentcommons_search_calls` are the reading side of the same rows and
back the list's Used prior work and Searched columns and filters (§7.6); per member, `api_ro.member_impact (user_id,
sessions_reused_by_others, distinct_readers, reuses_made)`, available through SQL and
dashboard tiles. Reuse is
recorded only from `get` reads made through MCP or REST by a key whose installation had
an active session at the time; dashboard views by humans do not count. The audit
projection writes the attributed reads once (ADR 0060); these views aggregate them
instead of recomputing the graph from audit rows and receipts on every read.

- _Health_: installations active in the last 7 days over the organization's member
  count; sessions per day per harness and per user; median capture latency (record
  timestamp to `receivedAt`); suspended sessions; redaction hits per policy; queue depth;
  embedding backlog and spend when enabled.
- _Usage_: MCP calls per day by tool; memory-assisted sessions (sessions during which the
  same installation made a `search`, `get`, or `sql` call, attributed by `installationId`
  and time window); follow-through rate (`search` followed within 10 minutes by `get` on
  a returned `session_id`); zero-result rate; cross-user hits (top results owned by
  another member); dashboard weekly actives, searches, session views.
- _Outcomes_, always split by `installations.tools_enabled` so a staged rollout is a
  controlled comparison: tool calls, tokens, and duration per session by repo;
  near-duplicate sessions (same repo, different users, within 30 days, first prompts with
  native ClickHouse UTF-8 three-gram similarity `1-ngramDistanceUTF8() > 0.6`, or cosine when embeddings are on); re-run loops
  (repeated test or build commands with failing output in one session); sessions ending
  with observed commits. Outcome presentations state that numbers are comparisons, not
  causation, and are meaningful only with both groups populated.

**Metric contracts and interpretation.** `GET /api/v1/admin/metrics/:group` accepts
`reuse`, `health`, `usage`, or `outcomes`, the standard server pagination/sort/CSV fields,
and `filters: {date_from, date_to, repo_name?, metric?}`. Dates are inclusive/exclusive
UTC bounds. Rows carry a typed metric name, nullable dimensions, value, numerator,
denominator, unit and explicit truncated metadata fields; an empty denominator gives a
null ratio. Live queue/backlog/current-UTC-day spend remain clearly labeled organization
snapshots on `/admin/status`, rather than fabricated historical or per-repo allocations.

**Search adoption.** The Team overview's "Sessions that searched" tile shows every member
the search-adoption count for the selected window. The authorized Usage metric API exposes
the full measures over its selected date/repo window, including sortable rows and CSV. The
common source is the caller-visible, nonpurged `api_ro.metrics_search_sessions` relation,
one row per captured session: `session_id`, `started_at`, `repo_name`, `harness`,
`user_id`, `agentcommons_search_calls` and `repeat_agentcommons_search_calls`; the
`sessions` view and the `get` header carry the same `agentcommons_search_calls` per
session, and the Sessions page filters and sorts on it (§7.6). A call is a
`search` or `sql` row of `session_reads` credited to the session (ADR 0060, ADR 0067): a
successful key-authenticated MCP/REST call made while the session was active on the
calling installation, the same attribution that defines reuse. `get` reads are reuse, not
search. Transcript tool names play no part, so the count does not depend on how the MCP
server is aliased in a harness; the metric appears when the audit projection flushes.
Repeat calls are those after the first. Selection uses the session's start time. Dashboard
tiles count the selected sessions and the sessions with at least one call; the Usage API
returns those counts, the two call totals and the session-adoption ratio (null for an
empty denominator) under the metric names `agentcommons_search_sessions`,
`agentcommons_search_rate`, `agentcommons_search_calls` and
`repeat_agentcommons_search_calls`. Counts describe successful calls; they do not assert
saved time or causation. The exact transcript tool-identity classification and the
`subsequent_other_search_calls` measure of ADR 0034 are retired; the captured tool
identities remain the normalizers' contract.

Reuse has one canonical `api_ro.reuse_edges` relation, shared by weekly, session and member
aggregates. It is materialized, not derived on read (ADR 0060): the audit projection worker
credits each successful key-authenticated MCP/REST `search`, `get` or `sql` audit row to the
sessions active on its installation at that instant, as `api_ro.metrics_active_windows`
defines activity, and stores one `session_reads` row per pair in the same flush that
projects the audit row; `reuse_edges` is the `get` rows whose target is another session,
and `session_reuse`, `sessions.reuse_count`, `member_impact`, the `metrics_reuse_*` flags
and memory-assisted attribution aggregate those rows. An edge therefore appears when the
projection flushes, and a window is judged from the receipts known at that time. A
one-time backfill derives the rows for retained audit history and records its completion.
Native row policies on the table require the caller's organization, audit retention, and a
published, unpurged, caller-visible source and target, so both reading and read sessions
must be caller-visible and nonpurged. Only
successful key-authenticated MCP/REST gets count. Source-time lifecycle receipt windows
exclude ended/resumed gaps and receipt gaps longer than six hours; start is included and
end excluded. New receipts use their persisted `lifecycleApplied` decision, so equal
source/event/receipt clocks cannot be reordered by client batch IDs. Historical null
decisions use the recoverable receipt-time/ID order and strict source-clock advancement;
their original order within one receipt millisecond cannot be recovered. Each active
observation ends at the next accepted source-ordered transition or six hours, whichever
comes first. An older end cannot close a newer resume when a native clock moves backward.
Stale lower-position lifecycle receipts cannot override newer transitions.
Source clocks and simultaneous sessions on one installation limit attribution; no process
identity is invented. Distinct reading sessions determine `reuse_count`; distinct users
determine `unique_readers`. New search/get audits put ordered returned database UUIDs in
`resourceIds`; search numeric result metadata is preserved within the 8KB audit budget.
These server-owned identities/numbers and declared search audit field names are structural;
condition keys and their schema-declared field/operator tokens are also structural.
Condition values, JSON path components, unknown field/operator tokens, all other user
text and unknown JSON keys remain redacted. The complete `memory_assisted`
field is admin-only; member SQL returns `NULL` rather than an incomplete count.
A bounded redacted query preview
survives detail omission so own zero-result searches do not disappear under large filters.

Health's suspended-session label is **authorization blocked**, based on current key and
membership authority rather than unobservable client spool state. Capture latency uses
native record/timestamp/receipt observations represented by canonical messages; missing
timestamps have no sample and negative clock-skew samples are counted separately from the
median. Coverage is installations per current member, so multiple machines can exceed one.
Outcome cohorts use current `tools_enabled`, which regroups historical sessions on toggle.
Near-duplicate candidates are visible sessions in the same repo within 30 days of each
selected source, with native ClickHouse UTF-8 three-gram or enabled cosine similarity strictly greater than 0.6.
Re-run loops require repeated commands with paired failing text evidence, not inferred
exit statuses. ADR 0028 records exact denominators, time fields and limitations.

**Staged rollout switch.** Organization admins can disable the MCP tools per
installation (`installations.tools_enabled`); capture continues. This is how a team runs
the two-group comparison before enabling tools for everyone.
Both changes require confirmation and a nonempty reason, retained in the redacted audit.
Use one key with ingest and read permissions per machine for this comparison. Shared keys
follow their latest ingest installation; unassociated read-only keys remain enabled.

This is an enterprise operations tool, not a consumer app. No command palette, no
novelty. Quality bar: dense, consistent screens; warm seeded-data lexical search p95 under 1 second including the audit commit
(ADR 0047); every list paginated server-side with TanStack Table sort and filter; CSV
export on every admin table; deep links to `/s/<id>#<seq>` that survive in tickets and
chat; light and dark; skeletons and honest empty states; keyboard reachable;
accessibility (focus rings, ARIA on lists, no color-only meaning); every destructive
action confirms and records a reason.

**Copy.** Every string a user reads lives in `apps/dashboard/src/copy.ts`, which composes
the per-area modules in `apps/dashboard/src/copy/*.ts` (public, app, auth, dashboards,
sessions, keys, sql, admin, settings), and is edited
with the vendored `no-ai-slop` skill (`.agents/skills/no-ai-slop/SKILL.md`) before merge:
lead with the fact, concrete nouns, short sentences, active voice, none of the banned
patterns. The rule covers public-facing text only: the README, dashboard copy, emails,
and error messages shown to users. Internal documents (this spec, CLAUDE.md, ADRs) are
exempt.

### 10.1 Public site and discovery

Public blog content lives in validated Markdown files. Frontmatter supplies slug, title, summary and publication date. One generated catalog supplies the index, post routes, prerendered HTML, canonical/OG/BlogPosting metadata, sitemap and LLM discovery content. Adding a Markdown post requires no route-list edit. Customer instances return404 for blog routes and omit blog navigation and discovery. Article prose lives in Markdown; interface labels remain in copy.ts. Native runtime SSR uses the actual instance mode for identical markup and hydration configuration.

The public site consists of `/` (landing), `/docs` (product guide), `/blog` and its posts,
`/privacy` (Privacy Policy) and `/tos` (Terms of Service). The legal pages are copy-defined
documents rendered by one shared component with a dated `<time>`, a contents list and
section headings; every public footer, the signup and onboarding agreement line ("By
continuing you agree to the Terms of Service and Privacy Policy") and the SaaS account menu
link them; they are prerendered like the other public pages, listed in the sitemap and
`llms.txt`, and, like the blog, absent (404) on customer instances because they describe the
hosted service.

The application serves a public landing page at `/`, login at `/login`, and the
authenticated application under `/app` (§10). The landing
page and bundled `/docs` product guide use the generated logo and explain cross-tool session history, prior-work reuse,
and its relationship to versioned CLAUDE.md, AGENTS.md, and skills. Its calls to action
link to working login and documentation routes. An authenticated landing visit remains on the public page. It resolves
the native session and offers Dashboard or Continue setup as its primary action; public navigation
shows Open dashboard or Continue setup instead of Create account. Anonymous calls to
action offer signup only in SaaS mode. A self-hosted instance (`INSTANCE_MODE=customer`)
serves no landing page: `/` answers 302 to `/app`, which shows sign-in when anonymous and
Home when signed in; `/docs` stays available. Product claims match verified behavior;
illustrative examples are labeled. All visible copy lives in copy.ts.

Landing and dashboard are responsive at mobile and desktop sizes, including forms,
admin tables, transcript controls, touch targets, and navigation. Both themes meet the
existing accessibility and browser verification bar. No horizontal viewport overflow;
tables fit the viewport with a small selectable summary of fields, mobile labeled
records, and an accessible full-record dialog. A table uses a fixed layout whose columns
share the container width by weight, so no table container scrolls sideways at any
supported width; long values wrap or truncate with the full value in a tooltip. The only
sideways scrollers are the SQL results grid and author-written Markdown tables inside a
transcript, each inside its own bounded region. Actions remain visible without horizontal
scrolling. CSV exports include all data fields, independently of the summary selection.
No global overflow clipping may hide an oversized layout.

The landing page is rendered to static HTML at build time so its content is available
without JavaScript. Runtime PUBLIC_URL supplies canonical URLs, title/description,
Open Graph metadata, and structured product metadata with no invented ratings or
usage claims. Authentication and dashboard routes always send noindex headers/meta.

`INSTANCE_MODE=customer` is the default. Customer responses send
`X-Robots-Tag: noindex, nofollow, noarchive`, the HTML has matching robots metadata,
`robots.txt` disallows all crawling, and sitemap/LLM-discovery URLs return 404.
`INSTANCE_MODE=public` or `saas` enables a sitemap containing `/`, `/docs`, `/blog` and published Markdown posts, a robots file
that disallows auth/API/dashboard paths, and generated `llms.txt` plus `llms-full.txt`
from public documentation, published Markdown blog content and static capability contracts. No database query or tenant
record supplies discovery content. Generation and link validity are checked in tests;
customer/public behavior is verified with real HTTP and browser requests. These crawler
hints do not replace authorization. Deployment of customer instances remains deferred
until local verification is complete.

---

## 11. Embeddings (built in v1, disabled by default, internal to search)

`EMBEDDINGS_ENABLED=false` registers no embedding worker, makes no provider calls,
omits the similarity route and SQL discovery entry, and leaves the MCP tool catalog
and search input schema unchanged. Administrative status fields and exact purge deletion
counts retain their stable typed schemas, including zero/inactive metrics or old derived
vectors retained from an earlier enabled period; disabling does not make cleanup counts
inaccurate. No similarity capability or embedding-specific tool description is advertised.
Auth configuration returns `features: []` without an effectively enabled organization;
effectively enabled organizations include `similar_sessions`. The generated build-time OpenAPI artifact includes
the optional route for the dashboard client; the live generated OpenAPI reference lists only active routes.

Organization administrators additionally control a persisted `embeddingsEnabled` setting,
default false. Effective use requires both this opt-in and the deployment flag. The setting
is read from the database for each operation; no process-local settings cache may delay a
disable. Members inspect `GET /api/v1/organization/embeddings`; effective admins change
`PATCH /api/v1/organization/embeddings` with `{enabled, reason}`. Changes are org-scoped,
locked and audited. Enabling requires a configured operator provider and durably schedules
catch-up for the existing corpus. The response distinguishes stored enablement, configured
availability and effective use, and reports current indexing progress. A configured provider
is not a successful live provider health check; the fake provider is explicitly a test adapter.

Disabled organizations use lexical search, cannot use similarity through REST or SQL, and
have no similarity discovery/configuration feature. MCP schemas remain unchanged. The
public OpenAPI document still describes deployment capabilities. A request that names a
vector capability while it is off (`similar_sessions`, `message_chunks`,
`session_embeddings`, `cosineDistance` or `L2Distance` in guarded SQL, or the registered
`GET /sessions/:id/similar`) fails with `EMBEDDINGS_DISABLED` (400 with the SQL position;
404 for REST) and one shared message that names the capability, the closed gate (no operator
provider, a plan without embeddings, or the organization setting) and who can open it; the
generic "unavailable view/function" guard messages are never used for vector capabilities.
The static `sql` tool description points agents at `schema_functions` to discover the table
functions their organization can use, so the catalog stays identical across states. Queued jobs recheck the
setting before reserving provider work. A reservation committed before disable is already
in flight and may finish; its cost stays charged, but completion discards results if the
settings revision changed, including disable/re-enable. Existing vectors remain hidden and
can be reused after re-enable when their source fingerprint is current. No database
transaction spans provider HTTP. See ADR 0044.

When effectively enabled, `js-tiktoken` (`cl100k_base`) chunks the `searchText` of searchable messages
at approximately 512 tokens with 64 tokens of overlap. Chunk boundaries preserve Unicode
characters, so overlap may be slightly shorter for multibyte characters. One session
vector combines title, first prompt (up to 2048 tokens), last assistant text reply (up to
4096), and sorted file paths (up to 2048), capped at 8191 input tokens. Full searchable
message text remains represented by the message chunks. `MessageChunk` and
`SessionEmbedding` store native Float32 arrays and HNSW cosine indexes. Pending
vectors remain unpublished under a distinct vector epoch and source revision. V1 fixes
`EMBEDDINGS_DIMENSIONS=1024` and `EMBEDDINGS_MODEL=text-embedding-3-small`; other values
fail configuration validation. A persisted deployment profile prevents mixing providers,
models or dimensions. Changing these requires an operator migration that clears derived
chunks, session vectors and embedding checkpoints, updates the profile, and changes the
vector columns/indexes when dimensions change. Raw records and messages are retained.

Adapters are `openai` through the official SDK and deterministic `fake`; other providers
are not implemented. OpenAI receives numeric token arrays, explicit dimensions, and no
SDK retries. Native pg-boss delivers bounded batches, catches up the retained corpus on
enable/startup, and repeats catch-up during maintenance. All API/worker replicas sharing
a deployment use the same flag; an off worker does not enqueue replacement embeddings.
Indexing is organization-scoped
maintenance authority; revoking an old ingestion key does not prevent maintenance of
retained sessions. Every target is checked for a purge and a changed source fingerprint
before committing results. Current redaction policies run again before chunk persistence
and provider dispatch; policy revisions participate in the fingerprint. Projection/rescan changes invalidate vectors and checkpoints
and enqueue replacement work. A leased checkpoint prevents concurrent workers from
issuing the same pending batch; an expired lease permits crash recovery.

`EMBEDDINGS_DAILY_TOKEN_BUDGET` defaults to 5,000,000 **per organization per UTC database
day**, including search-query embedding calls. A database row lock reserves tokenized
input costs before every HTTP attempt. Reserved tokens remain charged after timeout,
provider failure, or a crash with an uncertain result; retries reserve again. Provider
usage is recorded separately. Reservation/prepare and completion are separately audited
transactions; a prepare audit failure prevents dispatch, and a completion audit failure
rolls back vector publication and usage while retaining the already committed reservation
and any unpublished native vector writes for idempotent retry. Query
phases retain the initiating caller, followed by the logical search read audit. Status reports reserved tokens and conservative reserved
cost (OpenAI small: $0.02/million tokens; fake: zero). Index batches take only inputs that
fit the remaining budget and defer to the next UTC day when no pending input fits. An
individual input larger than the configured daily budget stays deferred until the
operator raises that budget. Query embedding unavailability or exhausted budget falls
back to lexical search. Signed cursor positions retain their ranking strategy. Cursors are validated against
query, organization, visibility and pagination inputs before any provider call. Lexical
continuations skip the provider; an RRF continuation whose provider is unavailable
returns recoverable `503 SEARCH_RANKING_UNAVAILABLE`, preserving the cursor for retry.

Search fuses lexical and cosine candidate ranks with reciprocal-rank fusion (`k=60`).
Lexical candidates are uncapped so a noisy session cannot hide later exact matches.
Cosine ranking computes each eligible message’s minimum chunk distance, selects at most
three messages per session, and retains the first 500 messages for fusion. This is exact
filtered cosine evaluation; HNSW indexes are installed, but grouping may require an exact
scan instead of index ordering. The final result applies the same three-hits-per-session
and response budgets. There is no mode field. Both candidate sets apply the same caller
visibility, organization, and filters. `similar_sessions(session_id,max_rows)` and
`GET /api/v1/sessions/:id/similar?max_rows=5` return caller-visible neighbors; `max_rows`
is 1–50. The REST response is `{sessions: SessionHeader[]}`. The database installs the
native parameterized view, but its guarded SQL allowlist, discovery entry, and internal vector
views require the trusted transaction feature flag; off instances expose none of it.
The dashboard shows “Similar sessions” only when the configuration feature is present.
Purge removes all message chunks and session vectors. See ADR 0021.

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
- **Very long sessions**: user reads are bounded and paged. Background projection preserves native whole-session semantics and may materialize full normalization context; a resource failure keeps the durable outbox pending rather than dropping records.
- **Not captured**: what the harness never writes to disk; images.

---

## 13. Infrastructure

Pulumi TypeScript with `@pulumi/awsx`; stacks `dev`, `prod`; region and hostname are
config. VPC (2 AZ; one NAT in dev), ECR, `awsx.ecs.FargateService` behind
`awsx.lb.ApplicationLoadBalancer` (idle 120 s), one-off migration task before service
update, ACM + optional Route53, RDS PostgreSQL 16 (`db.t4g.micro`/`small`, gp3, encrypted,
7/35-day backups, deletion protection in prod), Secrets Manager (`DATABASE_URL`, restricted trace-control and ClickHouse credentials,
`BETTER_AUTH_SECRET`, IdP secrets, embedding keys, Stripe secrets and
credential-bearing SMTP URLs), CloudWatch logs and
alarms, GitHub Actions OIDC (`preview` on PR, `up dev` on main, `prod` behind approval).
Deployment jobs require repository variable `DEPLOYMENTS_ENABLED=true`; it remains
unset until local verification and operator confirmation (ADR 0019).
SaaS mail configuration is explicit: SES requires `sesIdentityArn` for an already verified
sending identity and `EMAIL_FROM`. Only the API task receives `ses:SendEmail`, scoped to
that ARN and exact From address; the migration task and non-SES configurations receive
no mail permission. SMTP credentials remain in Secrets Manager. The image retains the
runtime dashboard SSR renderer and tracked native Stripe patches, so operator-configured
plan allowances are reflected in both served HTML and admission without a rebuild.
The `loadBalancerDnsName` stack output exposes the generated ALB hostname for external
DNS providers; it is the CNAME target, not a fixed application IP address.
ClickHouse uses one private `t3.large` host with an encrypted independent 100 GiB gp3
volume, retained on host replacement and protected in prod. Daily native EBS snapshots
retain 7/35 copies. Only API/migration tasks reach 8123; the host reaches private RDS
control views on 5432. This single-host deployment has snapshot recovery, not replicas.
Both Docker environments and EC2 mount the shared native privacy configuration.
Bootstrap credential rotation replaces the host using the exact new secret version,
retains its separate data volume, and reruns the migration gate. Only the opaque secret
version ID, never its value, appears in those resource dependencies.
Migration tasks receive the ClickHouse administrator and PostgreSQL control credentials;
API tasks receive only the ClickHouse writer/access credentials and their reader secret.
The `clickhouseInstanceId` and `clickhouseVolumeId` outputs identify these operational
resources. No cloud deployment is required to validate the local replacement.
Self-host without AWS: `docker-compose.yml` runs `api`, PostgreSQL and ClickHouse.
Single-node AWS (`deployment: single-node` in stack config; ADR 0055): one arm64 Ubuntu 24.04
`t4g.large` in the default VPC's public subnet with an Elastic IP, a 60 GiB encrypted gp3
root volume, IMDSv2, a security group admitting only 80/443, and SSM Session Manager
instead of SSH. It runs `docker-compose.yml` plus `docker-compose.caddy.yml` (Caddy:
automatic TLS for `PUBLIC_URL`, plain HTTP on the address, `TRUST_PROXY=uniquelocal`).
Stack config becomes SSM SecureString parameters that only the instance role reads;
`infra/scripts/single-node-release.sh` publishes `git archive` of a commit to a private
bucket and applies it through SSM Run Command (pull of the published image, or an on-host
build with `--build` that stamps `AGENTCOMMONS_VERSION` from the archive's `.commit` file,
else the checkout's git HEAD, else `development`, printing the value it used, plus the
revision and created release labels the updater compares; both
migrations, API restart behind Caddy, whose `reverse_proxy` holds a request whose dial
fails and retries it every 250 ms for up to 45 s (`lb_try_duration`) so the container swap
delays hook uploads and MCP handshakes instead of failing them, then a Caddy reload through
its entrypoint rather than a restart, updater install);
`single-node-run.sh bootstrap.sh` seeds the owner organization and enrolls Google sign-in
domains through a native owner session. Seven daily DLM snapshots; no replica, no ALB,
no NAT.
The control database is a stack setting (ADR 0063): `database: { kind: bundled }` (default)
runs the Compose `db` container; `{ kind: aurora-serverless-v2, minCapacity, maxCapacity,
engineVersion, forceSsl }` provisions an encrypted, deletion-protected Aurora PostgreSQL 16
Serverless v2 cluster with one `db.serverless` writer in the host's zone when the cluster's zones include it (a new cluster always does), a subnet group over
the host's VPC subnets, a security group admitting 5432 from the host only, a cluster
parameter group pinning `rds.force_ssl`, and CPU, ACU, memory and connection alarms on the
stack topic. The rendered `.env` then names the cluster endpoint in the three
`DATABASE_*_URL` values (`?sslmode=require&uselibpqcompat=true`) and
`CLICKHOUSE_POSTGRES_HOST`, and `AGENTCOMMONS_DATABASE=external` selects
`docker-compose.external-database.yml`, which parks the `db` service and drops the
migration's dependency on it. `pnpm db:migrate` bootstraps roles and schemas on a TLS-only
PostgreSQL owned by a non-superuser, and ClickHouse (whose container sets `HOME` to a
readable directory) reads the control tables and dictionaries over TLS.
`scripts/self-host/migrate-database.sh` copies roles (from `pg_roles`, without passwords)
and data (`pg_dump -Fc`, `pg_restore --no-owner --role`, one transaction) and compares row
counts; `single-node/migrate-database.sh` performs the cutover and `--rollback`. ClickHouse
Cloud and an Aurora cluster do not combine.
Releases and updates (ADR 0059): `.github/workflows/release.yml` runs after each
successful CI run on `main` (and on manual dispatch from `main`) and publishes one
`linux/amd64` and `linux/arm64` image to `ghcr.io/<owner>/agentcommons` tagged
`sha-<12-hex commit>` and `stable`, with OCI `source`, `revision` and `created` labels,
the commit baked in as `AGENTCOMMONS_VERSION`, and a Sigstore keyless signature on the
pushed digest; its only credential is the workflow token and it touches no cloud account.
`docker-compose.yml` runs `${AGENTCOMMONS_IMAGE:-ghcr.io/agentcommonsdev/agentcommons:stable}`
for `api` and `migrate` and keeps its `build:` block. Every self-hosted install runs
`scripts/self-host/agentcommons-update.sh` from an hourly systemd timer
(`RandomizedDelaySec=15m`, `Persistent=true`): it exits quietly unless the stack's `.env`
says `AUTO_UPDATE=true`, pulls the image Compose resolves, stops when its digest matches
the running API container, and never moves a floating tag backwards: with a container
running and no pin, the pulled image is installed only when it is a later build of another
commit than the running one, judged from the release stamp both build paths write into
the image. The Dockerfile arguments `AGENTCOMMONS_REVISION` (full commit) and
`AGENTCOMMONS_CREATED` (RFC 3339) become the OCI labels `org.opencontainers.image.revision`
and `org.opencontainers.image.created`; the release workflow passes them as build
arguments and `stack_up build` derives them from the archive's `.commit` file, else the
checkout's git HEAD (else the label stays empty and the build says so), and the build time.
A pulled `created` older than or equal to the running one's is held
(`last_result=held-newer-running`), a rebuild of the running commit is not installed
(`same-release`), and a stamp missing or unreadable on either side holds as unknown
(`held-unknown-age`) rather than swapping blindly; each is a completed check (`last_ok`,
`failures=0`) that leaves the stack untouched and records both stamps
(`running_revision`, `running_created`, `pulled_revision`, `pulled_created`) in the state
file. `AGENTCOMMONS_IMAGE` naming a `sha-` tag or a digest is a pin: that image is
installed as configured, older or not. Otherwise the updater tags the running image
`agentcommons:previous`, starts the stack (migration before API), waits for `/ready`, and
on failure restores the previous image with `--no-deps`, exits non-zero and holds that
release until a newer one is published. `--now` forces a check regardless of
`AUTO_UPDATE`; `--status` prints the running version, the configured image (marked when
pinned) and the pulled image, both release stamps, and the last result. Every run
records its outcome in `/var/lib/agentcommons/update-state`: `last_check` on every timer
run (updates enabled or not, so the file proves the timer is alive), `last_result`,
`last_ok` when a check completed (up to date, updated, disabled or a held release
skipped), `failures` (consecutive failed runs, reset by a completed check), the images
involved and the held release. The updater reads `.env` as the last release left it and
never renders or edits it, so it changes the image and nothing else: the database the
stack runs on (ADR 0063), the Compose file list and every other setting stay as applied.
The single-node
apply pulls the image, writes `COMPOSE_FILE` into `.env` so both paths run the same files,
installs the updater and enables the timer; stack setting `autoUpdate` (default `true`)
renders `AUTO_UPDATE`. The updater replaces the image only; checkout changes (Compose
files, mounted configuration) still arrive through the release script or `git pull`.
`GET /admin/status` and the MCP `status` tool report `server.version`
(`AGENTCOMMONS_VERSION`, default `development`), `server.auto_update` and
`server.updater`, the state file read from `UPDATE_STATE_FILE` when
`docker-compose.updater.yml` (part of `COMPOSE_FILE` on a host that runs the timer)
mounts its directory read-only into the API container, null otherwise; Admin → Status
shows the version, the automatic-update setting and the updater's last result, last
check, failure streak and held release, and for a held update both releases (commit and
build time) so the operator sees why nothing moved.
Development runs both databases on loopback with `docker-compose.dev.yml`, plus `pnpm dev`.
`pnpm db:migrate` applies the PostgreSQL control schema before the native ClickHouse schema.

---

## 14. Local development

`docker compose -f docker-compose.dev.yml up -d`; `pnpm install`; `pnpm db:migrate`;
`pnpm db:seed --admin you@example.com` (prints a one-time password setup link);
`pnpm dev` (API 3000, dashboard 5173 proxying `/api`, `/auth`, `/mcp`). Mint an
organization key after signing in, build the hook, then run `pnpm hook:link` with
`AGENTCOMMONS_API_KEY` set to that key. It installs the local shim against
`http://localhost:3000` by default.

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

1. **Real database, real artifacts.** Integration tests run on PostgreSQL and ClickHouse via
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
   contract checks (columns, native types, grants and underlying row policies).
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
   runs with `GEMINI_API_KEY`, pi with a provider key. Before comparing REST and MCP
   headers, the pi canary waits for the installed extension's final native shutdown
   checkpoints for both parent and fork: applied end receipts at the final transcript
   watermarks and matching projected leaves. An earlier end during a fork or native
   process exit alone does not prove that detached uploads have finished. Full header
   equality remains required after that completion barrier.
   Each recorded child must also be independently searchable and readable through
   REST and MCP, with its native parent relation and captured tool-result content.
   The mobile tree must expand that child's messages. A parent link alone does not
   prove child capture. pi forks retain native inherited context; they are not labeled
   as spawned subagents. Gemini's inline delegation stays in its native session.
   After the separate agent check, each MCP-capable harness runs a second hooked
   native session that uses the registration `install.sh` wrote to `search` for the
   earlier capture marker, `get` a returned session, run one `sql` query and
   `dashboard_render` the default dashboard (the canary's installed key grants the
   `dashboards` tool group for this, §8.2; an install-flow key would not list it). The shim must capture that session; its
   transcript must hold `TOOL_USE`/`TOOL_RESULT` rows for all four tools under the
   harness's native names (Appendix A) without an error envelope; the audit log must
   hold `transport=mcp` rows for the installed key (`mcp.tools.list`, `search`, `get`,
   `sql`, `dashboard.render`) and no `mcp.call` failure. The first AgentCommons call
   must be direct, not behind the harness's deferred-tool loader (Claude Code
   `ToolSearch`), and the live catalog must meet the R-MCP-09 byte budget. pi reaches
   the same tools through the extension bridge (`agentcommons_<tool>`, §8.4), driven
   by the scripted mock model or a provider key.
6. **Feature flags**: the suite runs with embeddings off (default) and on with `fake`;
   nothing else is matrixed.
7. **Browser verification**: Playwright over every dashboard route, light/dark, 1440/390/320:
   screenshot baselines, `@axe-core/playwright` (no serious/critical), console or network
   errors fail, layout assertions (no horizontal overflow, no clipped transcript rows,
   empty states have copy). Nightly and on dashboard PRs, an agent with browser control
   walks the core flows as a new user and files a findings report; `blocking` findings
   fail the job.
   For this ClickHouse implementation handoff, the user explicitly owns the external
   Fable review and prohibits invoking it. Complete the deterministic browser suites
   and implementation-agent walkthrough first; do not represent an earlier external
   review as verification of the current branch.
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
Live canary (`scripts/live-canary.ts`, opt-in, real providers): capture, native tool and
organic recall stages per harness. The organic recall stage (R-MCP-10) runs two hooked
sessions on each MCP-capable harness: a scripted decision session that sets
`upstream_timeout_ms` in `config.json` to 8000 with its reason and commits, then an ordinary
task in a fresh repository holding only the wrong value and the §8.3 guidance block (supplied
through the repository file because the canary's harnesses run against the operator's real
home) ("the upstream
client is timing out again after the merge; set the correct value"). The prompt never names
AgentCommons or prior sessions. It passes when the harness calls `search` before the first
tool call that carries the value, the search result includes the decision session, the file
and the reply end with 8000, and `report.json` records the queries under `organic_recall`.

---

## 17. Build order

Dependency order for implementation, not a shipping schedule. Each step carries its §16
verification; the whole spec is done when §16.1 item 8 holds.

1. Scaffold: monorepo, tooling, compose files, Prisma + hand-written SQL, CI, Pulumi.
2. Core: organization-scoped caller schemas, redaction and policies, normalizers (Claude Code and Codex from the
   captured fixtures; Gemini CLI and pi after capturing their contracts live), links,
   metadata, searchable decision, formatter.
3. API: Better Auth organizations and email access lists, SaaS signup/billing and metered admission (§9.6), effective authority, ingest with source identity, services,
   `/search`, `/sessions/:id`, `/query`, `/schema`, admin endpoints, OpenAPI + client,
   installer artifacts.
4. Shim + installer: state machine, readers, harness table for all four, pi extension,
   install/doctor/uninstall.
5. MCP: static registry, six read-permission tools, admin tools, global agent instructions.
6. Embeddings behind the flag: chunker, `openai` and `fake` adapters, jobs, budget,
   fusion inside `search`, `similar_sessions`, catch-up.
7. Dashboard: all screens in §10, browser verification.
8. Deploy, **after explicit operator approval** (ADR 0019): `dev`, IdP, DNS, bootstrap,
   install on machines, canaries green for all four harnesses; then `prod`. Deployment
   remains disabled during this implementation and its local verification. Passing
   infrastructure tests and configured workflows do not claim a completed cloud deployment.

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
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/usr/bin/node /home/u/.agentcommons/hook.js claude",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

**Claude Code 2.1.263** (`fixtures/hooks/claude-code-2.1.263-hook-events.jsonl`)

| event                                                                                   | fields                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionStart`                                                                          | `session_id, transcript_path, cwd, hook_event_name, source`                                                                                                                       |
| `UserPromptSubmit`                                                                      | `+ prompt, prompt_id, permission_mode`                                                                                                                                            |
| `PreToolUse`/`PostToolUse`                                                              | `+ tool_name, tool_input, tool_use_id, prompt_id, permission_mode`; Post `+ tool_response, duration_ms`; in a subagent `+ agent_id, agent_type` (transcript_path is the parent's) |
| `Stop`                                                                                  | `+ prompt_id, permission_mode, stop_hook_active, last_assistant_message, background_tasks[], session_crons[]`                                                                     |
| `SubagentStart`                                                                         | `+ prompt_id, agent_id, agent_type`                                                                                                                                               |
| `SubagentStop`                                                                          | `+ agent_id, agent_type, agent_transcript_path, …`                                                                                                                                |
| `SessionEnd`                                                                            | `+ prompt_id, reason`                                                                                                                                                             |
| Fires in `-p` mode. Subagent path `<slug>/<sessionId>/subagents/agent-<agentId>.jsonl`. |

**Claude Code 2.1.265** (`fixtures/hooks/claude-code-2.1.265-hook-events.jsonl`, captured
2026-09-08 with the same scripted `-p` session: Read, then an `Explore` subagent). The
contract is identical to 2.1.263 with one addition: `PreToolUse`, `PostToolUse`, `Stop` and
`SubagentStop` carry `effort` (the session's reasoning effort). `SessionStart`,
`UserPromptSubmit`, `SubagentStart` and `SessionEnd` are unchanged; `SessionEnd.reason` is
still `other` in `-p` mode and the subagent path convention is unchanged. Unknown fields pass
through the hook schemas, so no normalizer change was needed.

**Gemini Code Assist 2.75.0 restart loop, 2026-09-11.** The code-oss extension
`google.geminicodeassist` spawns `agent/a2a-server.mjs`, whose startup runs a
`discover_tools` phase (3 to 4 s: `initialize` and `tools/list` against every entry in
`~/.gemini/settings.json` `mcpServers`, including the `agentcommons` HTTP entry) before its
Google `onboardUser` call; when that call fails (`429 RESOURCE_EXHAUSTED` or
`UNSUPPORTED_CLIENT`) the agent exits 1 and the extension respawns it at once, with no
backoff: 571 starts in 46 minutes on one extension host, 2,299 in 170 minutes on another,
one handshake per 2.4 s from the machine. Each start is a new process, so no transport
feature could have kept the connection; handshake rows fold per window (§8.1, ADR 0073).

**Claude Code 2.1.265 MCP tool loading, 2026-09-09.** With tool search on (the default),
Claude Code defers every MCP tool behind its built-in `ToolSearch` regardless of catalog
size: a `--print` session against a one-tool HTTP server (about 300 bytes of schema)
still called `ToolSearch` before the tool, as did the live canary against the budgeted
15 KB AgentCommons catalog. The `mcpServers` entry field `alwaysLoad: true` is honored
by 2.1.265 in `--mcp-config` JSON and `~/.claude.json`: the same one-tool session then
called the MCP tool directly. `claude mcp add` has no flag for it, so the installer merges
the field into the entry the CLI writes (§6.1 step 4) and the canary requires the first
AgentCommons call to be direct. Claude Code 2.1.265 also opens each connection with a
`server/discover` request carrying `MCP-Protocol-Version: 2026-07-28`; SDK 1.30.0 answers
400 for the unsupported version and Claude falls back to `initialize` with 2025-11-25,
leaving one `mcp.protocol` 400 audit row per connection before the catalog listing (one
per handshake window since ADR 0073).

**Claude Code 2.1.263 end-to-end canary, 2026-09-08** (`-p` session that read, edited and
committed a file, ran shell commands and spawned an `Explore` subagent; every header
field and message was compared with the native JSONL). Facts the adapter relies on:

- Field sources. `harness_version` (`version`), `entrypoint` (`sdk-cli` in `-p`, `cli`
  interactive), `model`/`models_used` (`message.model`), `started_at` (earliest record
  `timestamp`; subagent files append attachments stamped later than the prompt record
  that follows them, so the first record's time is not the earliest) and `title` come
  from the transcript. `cwd`, `repo_*`, `branch`, `start_commit` come from the hook's
  `cwd` and the uploader's git context; `end_commit`, `observed_commits`,
  `observed_diff_stat`, `dirty_file_count`, `ended_at` and `end_reason` from the `end`
  envelope. `agent_type` exists only in `SubagentStart`/`SubagentStop` payloads and the
  child's `.meta.json` (`agentType`, `description`, `toolUseId`, `spawnDepth`); child
  transcript records carry `agentId` and `isSidechain: true` but no agent type.
- Empty by construction. `SessionEnd.reason` is `other` in `-p` mode; `SubagentStop`
  has no `reason`, so a child's `end_reason` is null. `ai-title` is written
  asynchronously and was absent from every canary run (70 s sessions), so `title`
  falls back to the first prompt. A subagent's `parent_native_ref` is the parent's
  native session id (§4.2); the spawning `tool_use_id` is only in `.meta.json` and in
  the parent's `Agent` result (`toolUseResult.agentId`, verified in
  `fixtures/transcripts/claude-code/parent.jsonl` line 20). The shim never reads
  `.meta.json`; `parent_tool_use_id` comes from the parent's `Agent` result (§5.5).
- Local rows. Assistant records with `isApiErrorMessage: true` (rate limits, `529`,
  stalled streams, expired login) carry `message.model: "<synthetic>"` and zero usage;
  they stay `ASSISTANT TEXT` but contribute no model. `gitBranch` is
  `git rev-parse --abbrev-ref HEAD` and reads `HEAD` when detached; the adapter treats
  that as no branch so the uploader's `symbolic-ref` result (null) stands.
- Record types seen in real transcripts beyond §5.4 (all raw-only): `mode`,
  `permission-mode`, `pr-link`, `file-history-snapshot`, `file-history-delta`,
  `agent-name`, `cost-state`. `system.subtype` values: `turn_duration`,
  `away_summary`, `stop_hook_summary`, `compact_boundary`, `local_command`,
  `informational`, `model_refusal_fallback`. Content block type `fallback` (model
  fallback marker) is raw-only.
- Hook timing (wall clock and transcript size captured at each hook). `Stop` fires
  before the final assistant `text` record is appended (154,133 of 156,438 bytes at
  hook time; the record landed within 400 ms), so a `Stop` sync can only include that
  message if the uploader reads after the append; the message is otherwise shipped by
  the next event. `SessionEnd` fired 300–700 ms after the last append with the file
  complete in three of three runs, and the detached uploader acknowledged exactly the
  final byte count after `claude -p` had exited (and been SIGKILLed with its process
  group). `SubagentStop` fires 15–20 ms before the child's final assistant record is
  appended; the child is drained again by the parent's later `PostToolUse`, `Stop`
  and `SessionEnd` uploads, so the child's `end` receipt may precede a final `sync`.
- Projected `tool_use_id`, `agent_id`, `native_id` and `parent_native_id` are
  `redacted-<sha256>` digests (ADR 0025); raw records keep the native values.

**Codex 0.150.0** (`fixtures/hooks/codex-0.150.0-hook-events.jsonl`)

| event                                                                                     | fields                                                                              |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `SessionStart`                                                                            | `session_id, transcript_path, cwd, hook_event_name, model, permission_mode, source` |
| `UserPromptSubmit`                                                                        | `+ prompt, turn_id`                                                                 |
| `PreToolUse`/`PostToolUse`                                                                | `+ tool_name, tool_input, tool_use_id, turn_id`; Post `+ tool_response`             |
| `Stop`                                                                                    | `+ turn_id, stop_hook_active, last_assistant_message`                               |
| `SessionEnd`                                                                              | `session_id, transcript_path, cwd, hook_event_name, reason`                         |
| `SubagentStart/Stop`, `PreCompact`, `PostCompact`, `PermissionRequest`, `Interrupt`       | present in binary; payloads captured during implementation                          |
| No hooks run without persisted trust (or `--dangerously-bypass-hook-trust`); `SessionEnd` |
| and `Interrupt` timeouts clamped to 3 s; `codex exec` reads stdin unless redirected;      |
| `CODEX_HOME` relocates config; each hooks file loaded fires its hooks once.               |

**Codex 0.153.4** (`fixtures/hooks/codex-0.153.4-persisted-config-events.jsonl`,
`codex-0.153.4-resume-events.jsonl`, and `codex-0.153.4-live-tool-events.jsonl`).
Persisted inline `[hooks]` arrays in user `~/.codex/config.toml` and a unique user
`<profile>.config.toml` both fired SessionStart/UserPromptSubmit/Stop/SessionEnd in real
`codex exec` runs. The installer uses inline user TOML. Identical inline `-c hooks.EVENT`
arrays also fired tool and subagent hooks. Project `hooks.json` discovery did not fire
in this modern capture, so the legacy 0.150 discovery result is not an installer assumption.
`SubagentStart.transcript_path` is the child's path; `SubagentStop.agent_transcript_path`
confirms it while its `transcript_path` is the parent's. Both name the parent in
`session_id` and child in `agent_id`. Resume uses `SessionStart.source: "resume"` with no
event timestamp. Duplicate configured callbacks had distinct handler PIDs but the same
native Codex parent PID and process birth identity. See the capture report for commands.

**Codex 0.153.4 ingestion facts** (live canary 2026-09-08, `codex exec --sandbox
workspace-write` with a subagent; `fixtures/transcripts/codex/edit-with-subagent.jsonl`
and `edit-subagent-child.jsonl`). `session_meta.payload.git` (`commit_hash`, `branch`,
`repository_url`) is present only when `cwd` is inside a repository and is `{}`
otherwise; the shim's own git context stays authoritative for branch and commits. Every
persisted `response_item.message` carries
`internal_chat_message_metadata_passthrough.content_item_kinds`: the human prompt is
`["user.text"]`; `plugins.recommendations`, `environments.environment_context` and
`agents_md.instructions` arrive with the user role and are projected as `SYSTEM META`
so the title and first prompt come from the human prompt (rollouts without kinds fall
back to the wrapper tags). There is no top-level `apply_patch` tool: the model calls
`tools.apply_patch(...)` inside the `exec` script and Codex records an
`event_msg/item_completed` `FileChange` item (`id: exec-…`, `changes: {absolute path:
{type: add|update|delete, unified_diff|content, move_path}}`, `status`, `stdout`,
`stderr`) between the exec call and its output; it is projected as an `apply_patch`
tool use/result pair with `session_files` operations. `CommandExecution` items carry
Codex's own `parsed_cmd` (`read`, `search`, `list_files`, `unknown`); `read` entries
with a `path` (relative to the item's `cwd` file URL) become `session_files` reads on the
owning exec call. `reasoning` items hold `summary: []` plus `encrypted_content`, and
the `Reasoning` item has empty `summary_text`/`raw_content`, so no THINKING text exists
to project (the canary emitted no reasoning records at `model_reasoning_effort="high"`).
The parent rollout records each spawn as `event_msg item_completed` with
`item.type: "SubAgentActivity"`, `kind: "started"`, `id` equal to the `spawn_agent`
`function_call.call_id` and `agent_thread_id` equal to the child rollout's
`session_meta.payload.id` (`parent-with-subagent.jsonl` lines 18–21); `spawn_agent`'s
own output only names `task_name`. That item is the source of `parent_tool_use_id`.
Child rollouts carry `parent_thread_id`, `source.subagent.thread_spawn` (`agent_path`
`/root/<task_name>`, random `agent_nickname` such as `Lagrange`, `agent_role: null`) and
hooks report `agent_type: "default"`, so `agent_type` is the configured role when
present, otherwise the hook value (`default`), never the nickname; the child has no `user.text` message because its
task arrives as `response_item.agent_message` with an `encrypted_content` payload, and
the parent receives the answer as an `agent_message` (`Message Type: FINAL_ANSWER`).
Both are projected as searchable `SYSTEM TEXT`; a subagent title falls back to
`agent_path`. `SessionEnd.reason` is `other` for `codex exec`; `SubagentStop` carries no
reason, so a child's `end_reason` is null. `task_complete` is the final rollout record
and precedes `SessionEnd`; the detached uploader acknowledged the complete parent and
child files (cursor equal to file size), and session token totals equal the final
cumulative `token_count`. Top-level `token_usage_record` and
`inter_agent_communication_metadata` records remain raw-only.

**Gemini CLI 0.35.3** (`fixtures/hooks/gemini-cli-0.35.3-tool-events.jsonl` and
`gemini-cli-0.35.3-resume-events.jsonl`). All lifecycle/tool/agent contracts are live
captured. BeforeAgent/AfterAgent add `prompt` (After also `prompt_response`,
`stop_hook_active`); BeforeTool/AfterTool add tool name/input/context (After also output).
All events include `session_id, transcript_path, cwd, hook_event_name, timestamp`.
Resume sets `source: "resume"`. The transcript is one rewritten JSON document; existing
assistant message objects change as tools finish. Headless captures required the privately
supplied `GEMINI_API_KEY`; the available individual Code Assist login was rejected.
A 2026-09-08 native `generalist` capture adds thirty same-session hook payloads and
five shrinking transcript snapshots under `fixtures/transcripts/gemini-cli/delegation/`.
The child read and parent read are actual tool executions; the child has no separately
identified transcript. See `docs/gemini-delegation-capture-2026-09-08.md` for the method
and the distinction between built-in Gemini delegation and pi's optional, non-persisting
subagent example extension.
Live end-to-end validation (2026-09-08, `gemini-3-flash-preview` and `gemini-2.5-flash`
through the canary) fixed the header contract: Gemini writes **no CLI version and no
entrypoint** into the transcript document or any hook stdin, so `harness_version` and
`entrypoint` stay null for Gemini sessions; `cwd`, git fields, `end_reason` (`exit`),
`ended_at` and end observations come from hook stdin and the shim. `startTime`,
`sessionId` and every message field come from the document. Thoughts are recorded as
`{ subject, description, timestamp }` (`ChatRecordingService.recordThought`) and are
projected as THINKING text `**subject**` + description; `tokens.input` is
`promptTokenCount` (cached tokens included), `tokens.output` is `candidatesTokenCount`
and `tokens.thoughts` is `thoughtsTokenCount` with `total = input + output + thoughts`,
so `output_tokens` counts `output + thoughts` like the other harnesses. `read_file`,
`write_file` and `replace` carry `file_path` and produce `session_files` rows;
`run_shell_command`, `glob`, `grep_search`, `list_directory` and `read_many_files`
(glob `include` patterns) do not. Both duplicate `SessionEnd` deliveries coalesce into
one `end` receipt, and the final assistant message written before `AfterAgent` is
present after exit. Intermediate delegation versions (the child's messages that a
later shrink removes) reach raw storage only when an `AfterTool` sync is due under the
10 s / 64 KB gate (§6.2); the final document is always complete.

**pi 0.73.1** (`fixtures/hooks/pi-0.73.1-cli-events.jsonl` and
`pi-0.73.1-lifecycle-events.jsonl`). Live extension/SDK captures establish six observed
callbacks: `session_start`, `input`, `tool_result`, `agent_end`, `session_tree`, and
`session_shutdown`. The extension reads session id/file and active leaf through
`context.sessionManager`, then spawns `hook.js pi` without returning host mutations.
Tree navigation changes the active leaf without appending source bytes. Fork/resume
produce shutdown/start pairs with `reason: "fork"` or `"resume"`; final shutdown is
`"quit"`. Fork headers keep `parentSession` as the source file path. The git-installable
root package lists the extension source in `pi.extensions`; the one-line installer
registers its bundled Node-only extension file in pi user settings.
The session header (`type: "session", version, id, timestamp, cwd, parentSession?`)
carries no harness version or entry point, so the extension reports them once per
process as `transcript_metadata`: `harnessVersion` is the `@mariozechner/pi-coding-agent`
package version found from the running main script (`<package>/dist/cli.js` for the CLI,
or the nearest `node_modules` copy for an SDK host; absent when neither resolves), and
`entrypoint` is `interactive` or `headless` from `context.hasUI` (false in print, RPC
and SDK modes). The shim forwards it as normalizer context and the pi normalizer maps it
to `harness_version`/`entrypoint`. A 2026-09-08 live run (SDK driver with fork/resume and
`pi -p`) confirmed every other header field is populated from the transcript, the hook
git observations, or the end observation, and that the detached uploads acknowledged the
final `session_shutdown` bytes within seconds of process exit.

**Gemini Code Assist and env placeholders, 2026-09-11 (production).** The VS Code Gemini
Code Assist extension reads `~/.gemini/settings.json` `mcpServers` in the extension host,
which has neither the shell's `AGENTCOMMONS_API_KEY` export nor the CLI's `${VAR}`
expansion: an entry written as `"Authorization": "Bearer ${AGENTCOMMONS_API_KEY}"` was sent
verbatim, and the server logged `POST /mcp` 401 `INVALID_API_KEY` about every 4 s (3,207
rows in two hours on one installation). The Claude Code user entry had the same shape and
only worked because the CLI expands it from a login shell. Both entries now carry the key
literally (the files are 0600); Codex keeps `bearer_token_env_var`, which is how its
`codex mcp add` works, and the shell exports remain for it.

**Prompt-time context from hooks, 2026-09-11.** Claude Code 2.1.266
(`fixtures/hooks/claude-code-2.1.266-prompt-context-events.jsonl`): a `-p` session in an
isolated `CLAUDE_CONFIG_DIR` with `--settings` registering one `UserPromptSubmit` hook
that printed `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":
…}}`; the hook received the documented stdin fields, the model's only output was the
injected sentinel, and the user's configuration was untouched. The transcript stores the
context as an `attachment` record (`attachment.type: "hook_additional_context"`, `content:
[…]`, `hookName`, `hookEvent`, `toolUseID`), not as a user message; the normalizer projects
it as `SYSTEM` text, so a hinted session shows its hint. Claude Code's reference also adds
plain stdout on exit 0 as context for `UserPromptSubmit` and `SessionStart`, so the shim
prints nothing else on those events. Codex 0.153.4: the binary's hook wire schema
(`UserPromptSubmitHookSpecificOutputWire`: `hookEventName: "UserPromptSubmit"`,
`additionalContext?: string`) and the published hooks reference ("added as extra developer
context") document the same shape; not yet exercised live (canary-pending). Gemini CLI
0.35.3: the bundled `docs/hooks/reference.md` documents `hookSpecificOutput.additionalContext`
on `BeforeAgent` ("appended to the prompt for this turn only"), `hookRunner.js` joins the
contexts with blank lines, and exit 0 stdout must be JSON; not yet exercised live
(canary-pending). pi has no shell hook output; the extension's `before_agent_start`
`systemPrompt` is the documented place for a later hint.

**Session-start context and structured results, 2026-09-11 (recall bench, ADR 0070).**
Claude Code 2.1.266 (`fixtures/hooks/claude-code-2.1.266-session-start-context-events.jsonl`):
a `-p` session in an isolated `CLAUDE_CONFIG_DIR` with a `SessionStart` hook that printed
`{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":…}}` received
the documented stdin (`session_id, transcript_path, cwd, hook_event_name, source`), the
model's only reply was the injected sentinel, the transcript stored a `hook_success`
attachment with the stdout and a `hook_additional_context` attachment rendered as
`<system-reminder>SessionStart hook additional context: …</system-reminder>`, and the
user's configuration was untouched; the shim's session overview rides on this. Gemini CLI
0.35.3's bundled `docs/hooks/reference.md` documents `hookSpecificOutput.additionalContext`
on `SessionStart` ("Interactive: injected as the first turn in history. Non-interactive:
prepended to the user's prompt"); implemented against the documented contract,
canary-pending. Codex 0.153.4's binary carries no SessionStart hook output type, so Codex
gets the prompt hint only. In the same bench, Claude Code handed the model each MCP tool
result's `structuredContent` JSON (`{"blocks":[…],"total":{…}}`, `{"header":…}`), not
the text rendering the server also returns; the formatted text is what other clients and
people read, so agent guidance belongs in descriptions and hints rather than result text.
With the installer's guidance block and the prompt hint present, 24 of 24 ordinary tasks
searched before their first edit (both with and without git history); with the hint off,
12 of 12 (ADR 0057 had measured 0 of 6 with history under the old text); with a
placeholder registration, 0 of 6, and the model stopped, guessed or ignored the hint it
could not act on, which is what the repair notice replaces (§6.2).

**Native search tool identities, 2026-09-08.** Seven sanitized native transcripts in
`fixtures/transcripts/tool-identities/` capture Claude `mcp__agentcommons__search`,
`Grep`, `Glob`, `WebSearch`; Gemini `mcp_agentcommons_search`, `grep_search`, `glob`,
`google_web_search`; and pi `grep`, `find`. The pi capture extension registers the
AgentCommons catalog as `agentcommons_<tool>` (ADR 0054, §8.4); an unqualified
third-party `search` name is still not AgentCommons evidence.
Codex stores MCP calls as typed `event_msg/item_completed` `McpToolCall` objects with
`id,server,tool,arguments,status,result|error` and payload start/completion milliseconds.
The adapter projects `mcp__<server>__<tool>` from those fields, without parsing `exec`
source. Its typed `Extension` with `kind:web.search` is projected as `web.search` only
when `action.type:search`; unknown extensions and web open/find actions remain raw-only.
Repeated observations of one invocation and overlapping ordinary call/result records
are deduplicated by native identity. Actual failures retain their error result rather
than fabricated successful output. See `docs/tool-identity-capture-2026-09-08.md` and
ADR 0036 for live methods, successful/rejected captures, and projection rules.

## Appendix B. Configuration

| variable                                                     | default                          | purpose                                                                                                                                        |
| ------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`                                                 | required                         | origin for CORS, cookies, callbacks, installer                                                                                                 |
| `INSTANCE_MODE`                                              | `customer`                       | `public` enables public-site discovery; `saas` additionally enables §9.6; `customer` disables discovery and billing                            |
| `FREE_MONTHLY_RECORDS`, `PRO_INCLUDED_RECORDS`               | `1000`, `10000`                  | SaaS Free UTC-month and Pro native-period record allowances; Free nonnegative, Pro positive and at least Free; shared by pricing and admission |
| `CAL_COM_URL`                                                | empty                            | optional HTTPS Cal.com booking URL for Enterprise inquiries; absence is an explicit unavailable state                                          |
| `DATABASE_URL`                                               | required                         | PostgreSQL application role; no trace SQL reader roles                                                                                         |
| `DATABASE_MIGRATION_URL`                                     | required for migrations only     | privileged migration principal; runtime app never uses it                                                                                      |
| `DATABASE_TRACE_CONTROL_URL`                                 | required for migrations only     | restricted PostgreSQL control-reader URL used by native ClickHouse dictionaries; API does not receive it                                       |
| `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`                      | required, `ac_trace`             | native trace server URL and database                                                                                                           |
| `CLICKHOUSE_WRITER_USER`, `CLICKHOUSE_WRITER_PASSWORD`       | required                         | trace writer principal; no native user-management authority                                                                                    |
| `CLICKHOUSE_ACCESS_USER`, `CLICKHOUSE_ACCESS_PASSWORD`       | required                         | restricted provisioner for per-caller native reader principals                                                                                 |
| `CLICKHOUSE_READER_SECRET`                                   | required, at least 32 characters | key for deriving native reader credentials                                                                                                     |
| `CLICKHOUSE_MIGRATION_USER`, `CLICKHOUSE_MIGRATION_PASSWORD` | required for migrations only     | native ClickHouse schema/access administrator; excluded from API runtime                                                                       |
| `CLICKHOUSE_POSTGRES_HOST`, `CLICKHOUSE_POSTGRES_PORT`       | original control URL             | optional reachable control host/port override when the migrator and ClickHouse use different network routes; TLS policy is retained            |

| `BETTER_AUTH_SECRET` | required | |
| `AUTH_EMAIL_PASSWORD_ENABLED` | `true` | |
| `AUTH_SOCIAL_PROVIDER` + `AUTH_<PROVIDER>_CLIENT_ID/SECRET` | empty | one of Better Auth's built-ins |
| `AUTH_OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET/SCOPES` | empty | generic OIDC |
| `AUTH_ALLOWED_EMAIL_DOMAINS` | empty | |
| `AUTH_SIGNUP_MODE` | `invite` | `open`, `invite`, `closed` |
| `EMAIL_TRANSPORT` | `none` | `none`, `smtp`, or `ses`; customer setup links remain manual. SMTP uses `SMTP_URL`; SES uses the standard AWS credential chain and `AWS_REGION`. Both require `EMAIL_FROM`. |
| `TRUST_PROXY` | ALB CIDRs | trusted proxy chain |
| `REDACTION_EXTRA_PATTERNS` | `[]` | seeds each organization's `RedactionPolicy` rows |
| `AUDIT_RETENTION_DAYS` | `365` | |
| `MCP_HANDSHAKE_WINDOW_SECONDS` | `300` | identical MCP handshakes from one key and client write one audit row per window (§8.1, ADR 0073); `0` audits every handshake |
| `EMBEDDINGS_ENABLED`, `EMBEDDINGS_PROVIDER`, `EMBEDDINGS_MODEL`, `EMBEDDINGS_DIMENSIONS`, `EMBEDDINGS_DAILY_TOKEN_BUDGET` | `false`, `openai`, `text-embedding-3-small`, `1024`, `5000000` | §11 |
| `SEARCH_CONTEXT_DEFAULT`, `SEARCH_LIMIT_DEFAULT` | `1`, `5` | |
| `LOG_LEVEL` | `info` | |
| `AGENTCOMMONS_VERSION` | `development` | the release baked into the image by `release.yml` (12-hex commit); reported as `server.version` by `/admin/status` (ADR 0059) |
| `AUTO_UPDATE` | `true` | read from the stack `.env` by the host's hourly updater and reported as `server.auto_update`; `false` keeps the timer idle |
| `UPDATE_STATE_FILE` | `/var/lib/agentcommons/update-state` | the host updater's state file, reported as `server.updater` by `/admin/status` when `docker-compose.updater.yml` mounts its directory into the container; absent file reads as null |
| Compose `AGENTCOMMONS_IMAGE` | empty, meaning `ghcr.io/agentcommonsdev/agentcommons:stable` | image for `api` and `migrate` in `docker-compose.yml`; a `sha-<12 hex>` tag pins one release |
| client `config.json`: `realtime`, `syncIntervalSeconds`, `syncBytesThreshold`, `disabledPaths`, `installationId`, `guidance.auto` | `true`, `10`, `65536`, `[]`, generated, `true` | §6; `guidance.auto` lets the uploader write the §8.3 block into repositories (§6.2) |

For Google sign-in domains, configure `AUTH_SOCIAL_PROVIDER=google` as the only login
provider, its client credentials and `AUTH_SIGNUP_MODE=invite` or `open`. A nonempty
`AUTH_ALLOWED_EMAIL_DOMAINS` must include the exact domain. Organization administrators
add domains on Settings; the operator CLI does the same with a real owner/admin session.
Save that session's Cookie header value as one line in a file owned by the operator with
mode `0600`. It is a credential; do not put it in command arguments, source control, or
logs.

```sh
pnpm db:domain --organization goodhart-labs --domain goodhartlabs.com --cookie-file /private/owner.cookie
```

The command returns `{organization_id, domain, provider_id, verified: true}`; repeating it
reaffirms the binding with an audit event. There is no DNS proof or verify step (ADR
0049). No provider management route is publicly exposed. The organization slug selects
the target; a native owner/admin session for another organization cannot allowlist its
domain.

## Appendix C. What the agent sees (regenerated by contract tests)

Generated from the real PostgreSQL and ClickHouse and official MCP SDK contract fixture at
`fixtures/contracts/mcp.json`. Regenerate with
`UPDATE_MCP_FIXTURES=1 pnpm exec vitest run apps/api/test/transport.integration.test.ts`.
Identifiers, receipt timestamps, and SQL timings are normalized for reproducibility.

Every `sessions:read` key lists `search`, `get` and `sql`, and nothing else by default. A key
that grants the `dashboards` tool group also lists `dashboard_list`, `dashboard_get`,
`dashboard_render`, `dashboard_save` and `dashboard_delete`; effective admin keys add
`set_visibility`, `purge`, `audit` and `status`, and `dashboard_set_default` when they hold
both (§8.2). An admin key that also grants the `administration` group lists one
`admin_<resource>_<verb>` tool per `/admin` route after those, derived from the route table
(ADR 0072); they are summarized after the JSON below.

`tools/list` as an effective admin key with the `dashboards` group receives it, complete. Output
schemas are not shipped (§8.2); results are validated server-side and returned as
`structuredContent`. The default catalog is the first three tools; every catalog stays within
the byte budgets of §8.2.

```json
[
  {
    "name": "search",
    "description": "Use this to check prior work before changing code, and whenever the user asks about earlier sessions; run long investigations in a subagent that returns only findings with session ids. Find the earlier sessions about a test, file, error, library or value: the first call for \"has anyone…\", \"why does…\" and \"how did we…\" questions and before any change. Put 2 to 4 specific words from your task in query (a test name, file path, identifier, error text or component); every word must appear (English inflections share a stem), so a whole sentence finds nothing while its key words do. Results are message excerpts grouped by session with each session_id; open the best one with get. Filters take one value or a list (any of), all must hold: repo_name is host/org/repo as git names the remote, or org/repo or the bare name when only one repository matches; file_prefix with file_operation selects sessions that touched a file. Example, \"why does the payments client retry the way it does?\": {\"query\":\"payments retry\",\"filters\":{\"file_prefix\":\"src/payments\",\"file_operation\":\"edit\"}}.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Words to find; every word must appear (English stems match). May be empty when a filter is given"
        },
        "filters": {
          "default": {},
          "description": "Narrow by session or message fields. Each key takes one value or a list (any of); every key given must hold",
          "type": "object",
          "properties": {
            "repo_name": {
              "description": "Sessions in these repositories: host/org/repo, or org/repo or the bare repository name when only one repository matches",
              "anyOf": [
                {
                  "type": "string",
                  "minLength": 1
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                }
              ]
            },
            "branch": {
              "description": "Sessions on these git branches (exact)",
              "anyOf": [
                {
                  "type": "string",
                  "minLength": 1
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                }
              ]
            },
            "user_email": {
              "description": "Sessions run by these members (exact email)",
              "anyOf": [
                {
                  "type": "string",
                  "format": "email"
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "format": "email"
                  }
                }
              ]
            },
            "ingest_api_key_id": {
              "description": "Sessions uploaded with these ingest API keys (key id, exact); the Install page uses it to show one machine's sessions",
              "anyOf": [
                {
                  "type": "string",
                  "minLength": 1
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                }
              ]
            },
            "tool_name": {
              "description": "Messages calling or answering these tools, such as Read or Bash",
              "anyOf": [
                {
                  "type": "string",
                  "minLength": 1
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                }
              ]
            },
            "file_prefix": {
              "description": "Sessions that touched a file whose path starts with this text, such as src/auth/",
              "anyOf": [
                {
                  "type": "string",
                  "minLength": 1
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                }
              ]
            },
            "file_operation": {
              "description": "Sessions where a file was read, edited, written or deleted; with file_prefix, the same file must match both",
              "anyOf": [
                {
                  "type": "string",
                  "enum": ["read", "edit", "write", "delete"]
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": ["read", "edit", "write", "delete"]
                  }
                }
              ]
            },
            "role": {
              "description": "Messages with these roles",
              "anyOf": [
                {
                  "type": "string",
                  "enum": ["USER", "ASSISTANT", "TOOL_RESULT", "SYSTEM"]
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": ["USER", "ASSISTANT", "TOOL_RESULT", "SYSTEM"]
                  }
                }
              ]
            },
            "session_id": {
              "description": "Search inside these sessions only",
              "anyOf": [
                {
                  "type": "string",
                  "format": "uuid"
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "format": "uuid"
                  }
                }
              ]
            },
            "since": {
              "description": "Messages at or after this UTC time (inclusive)",
              "anyOf": [
                {
                  "type": "string",
                  "format": "date-time"
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "format": "date-time"
                  }
                }
              ]
            },
            "until": {
              "description": "Messages before this UTC time (exclusive)",
              "anyOf": [
                {
                  "type": "string",
                  "format": "date-time"
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "format": "date-time"
                  }
                }
              ]
            },
            "where": {
              "description": "Up to 10 extra conditions that must all hold, on a message field (tool_name, tool_use_id, content, role, kind, model, or a JSON path inside tool_input) or a session field (harness, title, repo_name, branch, user_email, status)",
              "minItems": 1,
              "maxItems": 10,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "field": {
                    "type": "string",
                    "enum": [
                      "tool_name",
                      "tool_use_id",
                      "content",
                      "role",
                      "kind",
                      "model",
                      "harness",
                      "title",
                      "repo_name",
                      "branch",
                      "user_email",
                      "status",
                      "tool_input"
                    ],
                    "description": "Field to test"
                  },
                  "op": {
                    "type": "string",
                    "enum": ["eq", "contains", "starts_with", "exists"],
                    "description": "eq: exact, case-sensitive, null matches missing; contains and starts_with: literal, case-insensitive; exists: non-null, takes no value"
                  },
                  "path": {
                    "description": "JSON keys or array positions inside tool_input; only with field tool_input",
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  },
                  "value": {
                    "description": "Text for text fields; any JSON primitive for a tool_input path",
                    "anyOf": [
                      {
                        "type": "string",
                        "maxLength": 4096
                      },
                      {
                        "type": "number"
                      },
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                },
                "required": ["field", "op"],
                "additionalProperties": false
              }
            }
          },
          "additionalProperties": false
        },
        "context": {
          "default": 1,
          "description": "Neighbouring non-thinking messages either side of each hit",
          "type": "integer",
          "minimum": 0,
          "maximum": 3
        },
        "limit": {
          "default": 5,
          "description": "Hit messages per page; at most 3 hits per session",
          "type": "integer",
          "minimum": 1,
          "maximum": 50
        },
        "cursor": {
          "default": null,
          "description": "Cursor from the previous page; null for the first page",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": ["query"],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "get",
    "description": "Use this to check prior work before changing code, and whenever the user asks about earlier sessions; run long investigations in a subagent that returns only findings with session ids. Open one session by session_id, usually the best search hit: a header (who ran it, harness, model, repository, branch, start, end, status, message, tool call, token, file, commit and reuse counts, tools_used, root_session_id, parent and child sessions) and its messages in seq order with role, kind, tool_name, tool_use_id and content. Each child ref carries parent_tool_use_id, the tool_use_id of the TOOL_USE message here that spawned it (null when unrecorded), so a subagent run reads in place under its call. Bound a range with from/to; when next is not null, pass it as cursor. Example, the first 40 messages: {\"session_id\":\"01a08fd7-9907-72a3-9135-80162670d93a\",\"from\":0,\"to\":40}.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "from": {
          "description": "First message seq to return (inclusive)",
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "to": {
          "description": "Last message seq to return (inclusive)",
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "cursor": {
          "description": "The next value of a previous page; omit to start at from",
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "seq": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991,
                  "description": "Message position (seq) to continue from"
                },
                "offset": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991,
                  "description": "Byte offset inside that message's content"
                }
              },
              "required": ["seq", "offset"],
              "additionalProperties": false,
              "description": "Position inside a session's messages for continuing a read"
            },
            {
              "type": "null"
            }
          ]
        },
        "kinds": {
          "description": "Message kinds to return, in seq order. Left out: META, the harness's housekeeping records (tool listings, skill listings, reminders); list it to read them. Default TEXT, THINKING, TOOL_USE, TOOL_RESULT",
          "minItems": 1,
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["TEXT", "THINKING", "TOOL_USE", "TOOL_RESULT", "META"]
          }
        },
        "session_id": {
          "type": "string",
          "format": "uuid",
          "description": "Session to read, from a search result or the sessions view"
        }
      },
      "required": ["session_id"],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "sql",
    "description": "Use this to check prior work before changing code, and whenever the user asks about earlier sessions; run long investigations in a subagent that returns only findings with session ids. Answer questions search cannot, with one read-only ClickHouse SELECT over api_ro: who worked on a repository, which sessions touched a file, counts over time. Views: sessions (session metadata); messages (normalized messages); session_files (observed files: path, ops); session_observed_commits (commit observations); session_tools (tool counts); users (visible contributors); installations (visible devices); repos (visible repository counts); schema_columns (column descriptions); schema_functions (function descriptions). search_messages(q='words') returns uncapped session_id,seq,rank. Discover columns with SELECT * FROM schema_columns WHERE view_name = 'sessions' and every table function this organization can use with SELECT * FROM schema_functions. Limits: 500 rows, 5 seconds. Example, the newest sessions of one repository: {\"sql\":\"SELECT session_id,title,started_at FROM sessions WHERE repo_name = 'github.com/acme/orders-api' ORDER BY started_at DESC LIMIT 20\"}.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sql": {
          "type": "string"
        }
      },
      "required": ["sql"],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "dashboard_list",
    "description": "Use this when the user asks to view, build or change dashboards. List the organization's dashboards (id, name, tile count, flags, updated_at, description), which one is the Home default and the starter tile template ids; read a definition with dashboard_get. Two built-ins always exist: Team overview (captured sessions, search adoption and reuse; the default until an admin picks another) and Team activity (sessions, messages, tool calls, repositories and coding tools per person, for managers). The definition JSON Schema travels as structuredContent.definition_schema.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "dashboard_get",
    "description": "Use this when the user asks to view, build or change dashboards. Read one dashboard by id with its full definition: variables, tiles, SQL, layout and chart options.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        }
      },
      "required": ["id"],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "dashboard_render",
    "description": "Use this when the user asks to view, build or change dashboards. Run the queries of a dashboard (by id or an inline definition) with variable values such as {\"time_range\":\"7d\",\"repo\":[\"github.com/org/repo\"]} and return each tile's rows. Pass tiles to render a subset. Saved dashboards are served from a cache that a newly published session invalidates; the result says when it was rendered and whether it came from the cache, and refresh: true re-runs the tiles.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        },
        "definition": {
          "type": "object",
          "properties": {
            "version": {
              "type": "number",
              "const": 2
            },
            "variables": {
              "default": [],
              "maxItems": 8,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {},
                "additionalProperties": {},
                "description": "Variable {name, label?, type, default?}: type time_range (default preset 24h|7d|14d|30d|90d|this_week|last_week|this_month|all) exposes {name}_from and {name}_to as DateTime; repo, harness and user expose {name} as Array(String) where empty means all; text exposes {name} as String."
              }
            },
            "tiles": {
              "minItems": 1,
              "maxItems": 24,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {},
                "additionalProperties": {},
                "description": "Tile {id, title, description?, layout {x 0-11, y, w 1-12, h 1-40}} plus per type: stat {sql, value?, compare?, unit?}; chart {sql, series_by?, unit?, chart}; table {sql, columns?}; text {markdown}; control {variable}. sql: one ClickHouse SELECT over api_ro, declared variables as {name:Type}. unit: count|ratio|seconds|milliseconds|tokens|usd. chart: allowlisted ECharts option with series (1-20; type line|bar|pie|scatter|gauge|heatmap; encode {x?, y?, value?, itemName?, tooltip?} binds result columns; name?, stack?, smooth?, step?, showSymbol?, symbol?, symbolSize?, connectNulls?, areaStyle?, lineStyle?, itemStyle?, label?, labelLine?, emphasis?, barWidth?, barMaxWidth?, barGap?, radius?, center?, roseType?, xAxisIndex?, yAxisIndex?, min?, max?, progress?, detail?, axisLine?, pointer?, splitLine?, axisLabel?, axisTick?, title?) and xAxis?, yAxis?, legend?, tooltip?, grid?, color?, dataZoom?, visualMap?, polar?, radiusAxis?, angleAxis?. Style blocks: plain JSON, at most three levels, scalar or scalar-array leaves. Unknown keys are rejected."
              }
            }
          },
          "required": ["version", "tiles"],
          "additionalProperties": false,
          "description": "Dashboard definition. dashboard_list names the starter templates and carries the complete JSON Schema as structuredContent.definition_schema; dashboard_get on a built-in shows a complete working definition; dashboard_render validates an inline definition and names the failing path."
        },
        "variables": {
          "default": {},
          "description": "Values by variable name: a preset (24h|7d|14d|30d|90d|this_week|last_week|this_month|all) or {from, to} in UTC for time_range; a list of strings for repo, harness and user; text for text.",
          "type": "object",
          "properties": {},
          "additionalProperties": {}
        },
        "tiles": {
          "minItems": 1,
          "maxItems": 24,
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9_]{0,39}$"
          }
        },
        "refresh": {
          "default": false,
          "type": "boolean"
        }
      },
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "dashboard_save",
    "description": "Use this when the user asks to view, build or change dashboards. Create or update a dashboard everyone in the organization can see. Start from dashboard_list templates, validate with dashboard_render on an inline definition, then save. Updates need id and revision; only the creator or an organization admin can change a saved dashboard.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        },
        "revision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        },
        "description": {
          "default": "",
          "type": "string",
          "maxLength": 400
        },
        "definition": {
          "type": "object",
          "properties": {
            "version": {
              "type": "number",
              "const": 2
            },
            "variables": {
              "default": [],
              "maxItems": 8,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {},
                "additionalProperties": {},
                "description": "Variable {name, label?, type, default?}: type time_range (default preset 24h|7d|14d|30d|90d|this_week|last_week|this_month|all) exposes {name}_from and {name}_to as DateTime; repo, harness and user expose {name} as Array(String) where empty means all; text exposes {name} as String."
              }
            },
            "tiles": {
              "minItems": 1,
              "maxItems": 24,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {},
                "additionalProperties": {},
                "description": "Tile {id, title, description?, layout {x 0-11, y, w 1-12, h 1-40}} plus per type: stat {sql, value?, compare?, unit?}; chart {sql, series_by?, unit?, chart}; table {sql, columns?}; text {markdown}; control {variable}. sql: one ClickHouse SELECT over api_ro, declared variables as {name:Type}. unit: count|ratio|seconds|milliseconds|tokens|usd. chart: allowlisted ECharts option with series (1-20; type line|bar|pie|scatter|gauge|heatmap; encode {x?, y?, value?, itemName?, tooltip?} binds result columns; name?, stack?, smooth?, step?, showSymbol?, symbol?, symbolSize?, connectNulls?, areaStyle?, lineStyle?, itemStyle?, label?, labelLine?, emphasis?, barWidth?, barMaxWidth?, barGap?, radius?, center?, roseType?, xAxisIndex?, yAxisIndex?, min?, max?, progress?, detail?, axisLine?, pointer?, splitLine?, axisLabel?, axisTick?, title?) and xAxis?, yAxis?, legend?, tooltip?, grid?, color?, dataZoom?, visualMap?, polar?, radiusAxis?, angleAxis?. Style blocks: plain JSON, at most three levels, scalar or scalar-array leaves. Unknown keys are rejected."
              }
            }
          },
          "required": ["version", "tiles"],
          "additionalProperties": false,
          "description": "Dashboard definition. dashboard_list names the starter templates and carries the complete JSON Schema as structuredContent.definition_schema; dashboard_get on a built-in shows a complete working definition; dashboard_render validates an inline definition and names the failing path."
        }
      },
      "required": ["name", "definition"],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "dashboard_delete",
    "description": "Use this when the user asks to view, build or change dashboards. Delete a saved dashboard. Creators can delete their own; organization admins can delete any.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        }
      },
      "required": ["id"],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    }
  },
  {
    "name": "set_visibility",
    "description": "Use this to check prior work before changing code, and whenever the user asks about earlier sessions; run long investigations in a subagent that returns only findings with session ids. Change session visibility between PUBLIC and PRIVATE with a reason. Private sessions are visible to organization admins only.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "session_id": {
          "type": "string",
          "format": "uuid"
        },
        "visibility": {
          "type": "string",
          "enum": ["PUBLIC", "PRIVATE"]
        },
        "reason": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": ["session_id", "visibility", "reason"],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "purge",
    "description": "Use this to check prior work before changing code, and whenever the user asks about earlier sessions; run long investigations in a subagent that returns only findings with session ids. Permanently remove session contents and retain its tombstone. Supply a reason.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "session_id": {
          "type": "string",
          "format": "uuid"
        },
        "reason": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": ["session_id", "reason"],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    }
  },
  {
    "name": "audit",
    "description": "Use this to check prior work before changing code, and whenever the user asks about earlier sessions; run long investigations in a subagent that returns only findings with session ids. Read this organization's audit events using exact identifiers and UTC time bounds.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": {
          "default": 50,
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "cursor": {
          "default": null,
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "filters": {
          "default": {},
          "type": "object",
          "properties": {
            "user_id": {
              "type": "string",
              "minLength": 1
            },
            "api_key_id": {
              "type": "string",
              "minLength": 1
            },
            "request_id": {
              "type": "string",
              "minLength": 1
            },
            "resource_id": {
              "type": "string",
              "minLength": 1
            },
            "action": {
              "type": "string",
              "minLength": 1
            },
            "transport": {
              "type": "string",
              "enum": ["rest", "mcp", "web"]
            },
            "status_code": {
              "type": "integer",
              "minimum": 100,
              "maximum": 599
            },
            "since": {
              "type": "string",
              "format": "date-time"
            },
            "until": {
              "type": "string",
              "format": "date-time"
            }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "status",
    "description": "Use this to check prior work before changing code, and whenever the user asks about earlier sessions; run long investigations in a subagent that returns only findings with session ids. Read this organization's ingestion, redaction, and background job status.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "dashboard_set_default",
    "description": "Use this when the user asks to view, build or change dashboards. Make a saved dashboard the organization's Home default. Pass the built-in Team overview's id to restore the shipped default; other built-ins must be duplicated first.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        }
      },
      "required": ["id"],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false
    }
  }
]
```

The `administration` group, as the same key with that grant lists it. Each input is the
route's params, query and body merged into one object (the REST `format` switch excluded);
the complete schemas are the route's in the OpenAPI document.

| Tool                           | Does                                                                                       | Fields                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `admin_domains_list`           | List Google SSO domain access.                                                             | `limit`, `cursor`, `sort`, `order`, `domain`                                            |
| `admin_members_list`           | List organization members.                                                                 | `limit`, `cursor`, `sort`, `order`, `filters`                                           |
| `admin_members_add`            | Add people to the organization.                                                            | `emails`, `role`                                                                        |
| `admin_member_get`             | Read one organization member.                                                              | `id`                                                                                    |
| `admin_member_password_setup`  | Issue initial password setup.                                                              | `user_id`                                                                               |
| `admin_member_set_role`        | Change an organization member role.                                                        | `id`, `role`, `reason`                                                                  |
| `admin_member_set_suspension`  | Suspend or restore a membership.                                                           | `id`, `suspended`, `reason`                                                             |
| `admin_member_remove`          | Remove an organization member.                                                             | `id`, `reason`                                                                          |
| `admin_keys_list`              | List organization API keys.                                                                | `limit`, `cursor`, `sort`, `order`, `filters`                                           |
| `admin_key_revoke`             | Revoke an organization API key.                                                            | `id`, `reason`                                                                          |
| `admin_sessions_list`          | List every session of the organization for moderation.                                     | `limit`, `cursor`, `sort`, `order`, `filters`, `roots_only`                             |
| `admin_installation_set_tools` | Enable or disable installation MCP tools.                                                  | `id`, `reason`, `enabled`                                                               |
| `admin_metrics_list`           | Read filtered organization metrics.                                                        | `group`, `limit`, `cursor`, `sort`, `order`, `filters`                                  |
| `admin_policies_list`          | List redaction policies.                                                                   | `limit`, `cursor`, `sort`, `order`, `filters`                                           |
| `admin_policy_create`          | Create a redaction policy.                                                                 | `name`, `replacement`, `enabled`, `kind`, `pattern`, `flags`, `ruleId`, `options`       |
| `admin_policy_update`          | Update a redaction policy.                                                                 | `id`, `name`, `replacement`, `enabled`, `kind`, `pattern`, `flags`, `ruleId`, `options` |
| `admin_policy_remove`          | Remove a redaction policy.                                                                 | `id`, `reason`                                                                          |
| `admin_redaction_test`         | Test organization redaction policies.                                                      | `text`                                                                                  |
| `admin_redaction_summary`      | Read the organization's redaction totals, recent windows, per-policy counts and run tally. |                                                                                         |
| `admin_redaction_hits_list`    | List where redactions landed: session, message position, policy, source and time.          | `limit`, `cursor`, `sort`, `order`, `filters`                                           |
| `admin_rescans_list`           | List redaction rescan runs with progress and the sessions each changed.                    | `limit`, `cursor`, `sort`, `order`                                                      |
| `admin_rescan_get`             | Read redaction rescan progress.                                                            | `id`                                                                                    |
| `admin_rescan_sessions_list`   | List the sessions a redaction rescan run changed, with counts.                             | `id`, `limit`, `cursor`, `sort`, `order`, `filters`                                     |
| `admin_rescan_start`           | Rescan existing organization records.                                                      | `policyIds`, `since`, `reason`                                                          |

`search` text rendering; structuredContent contains the corresponding schema-validated fixture value.

```text
1 hit in 1 session

session_id: 00000000-0000-4000-8000-000000000001 | Investigate the transport session index
repo_name: github.com/rek7/agentcommons | branch: main | user_email: transport-primary@example.com
harness: CLAUDE_CODE | model: null | started_at: 2026-09-07T01:00:00.000Z
seq 0 USER TEXT [hit]
Investigate the transport session index
```

`get` text rendering; structuredContent contains the corresponding schema-validated fixture value.

```text
session_id: 00000000-0000-4000-8000-000000000001 | title: Investigate the transport session index | harness: CLAUDE_CODE
harness_version: null | entrypoint: null | model: null
models_used: [] | user_email: transport-primary@example.com | installation_hostname: transport-fixture
repo_name: github.com/rek7/agentcommons | repo_url: github.com/rek7/agentcommons | branch: main
cwd_relative: . | start_commit: abc123 | end_commit: null
started_at: 2026-09-07T01:00:00.000Z | ended_at: null | status: ACTIVE
visibility: PUBLIC | purged_at: null | end_reason: null
message_count: 1 | tool_call_count: 0 | input_tokens: 0
output_tokens: 0 | tools_used: [] | file_count: 0
observed_commit_count: 0 | reuse_count: 0 | agentcommons_search_calls: 0
reuses_made: 0 | agent_type: null | parent_session_id: null
parent_relation: null | parent_tool_use_id: null | parent: null
children: [] | child_count: 0 | children_truncated: false
truncated_fields: [] | root_session_id: 00000000-0000-4000-8000-000000000001

seq 0 USER TEXT timestamp=2026-09-07T01:00:00.000Z model=null
Investigate the transport session index
message_id: 00000000-0000-4000-8000-000000000003
```

`sql` text rendering; structuredContent contains the corresponding schema-validated fixture value.

```text
1 row
session_id (UUID) | title (Nullable(String))
00000000-0000-4000-8000-000000000001 | Investigate the transport session index
```

Tool failures return `isError: true` and a text JSON error without structuredContent.
