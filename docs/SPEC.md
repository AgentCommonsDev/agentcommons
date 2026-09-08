# AgentCommons — Specification

Status: v5, local ClickHouse acceptance verified 2026-09-08. ClickHouse replaces PostgreSQL trace storage under ADR0047. Current results and external configuration boundaries are recorded in
`docs/VERIFICATION.md`. Completion requires §16.1 item 8 and is not implied by requirement citations.
See `docs/reviews/codex-review-2026-09-07.md`; v2 is retained for comparison. Owner: rek7. First deployment: ZeroPath. Self-hostable with one or more organizations per
instance; each organization is an independent data and authorization boundary
(ADR 0011). Nothing organization-specific is hardcoded.

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
- Three agent tools over MCP: `search`, `get`, `sql`. Admin keys additionally see four
  static admin tools.
- Semantic ranking implemented and shipped behind `EMBEDDINGS_ENABLED=false`, internal to
  `search`; no change to the agent surface when it flips (§11).
- Dashboard: login, search and session list, transcript with live tail, session tree, SQL
  page, keys, admin (users, keys, visibility, purge, audit, redaction policies, status with
  charts).
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
    src/copy.ts                   every user-facing string
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
  `{ sessions: ["ingest" | "read"], admin: ["*"] }`; hashed; prefix `ac_`; a user may
  hold many. `ApiKeyOwner` stores the issuing user's identity and organization as
  immutable attribution alongside the plugin-owned key. `admin:*` is grantable only
  by organization owners/admins and remains effective only while the issuing user has
  that membership. Removal or suspension invalidates every key issued by that member
  in that organization; other organizations are unaffected. Keys never mint keys.
- **Installation**: `id` (random UUID generated by the installer and stored in
  `config.json`), `hostname`, `osUser`, `platform`, `arch`, `firstSeenAt`, `lastSeenAt`,
  `toolsEnabled` (organization-admin switch for a staged rollout, §10; default true).
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

| column                                                         | notes                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                                           |                                                                                                                                                                                                                                      |
| `harness`                                                      | `CLAUDE_CODE`, `CODEX`, `GEMINI_CLI`, `PI`                                                                                                                                                                                           |
| `harnessSessionId`                                             | native id; Claude subagents `<sessionId>:agent-<agentId>`; unique with `organizationId, harness`                                                                                                                                     |
| `organizationId`                                               | immutable tenant; taken from authenticated key, never ingest JSON                                                                                                                                                                    |
| `harnessVersion`, `entrypoint`                                 | from the transcript (`version`/`cli_version`; `entrypoint`/`originator`)                                                                                                                                                             |
| `userId`, `ingestApiKeyId`, `installationId`                   | owner from the first ingesting key                                                                                                                                                                                                   |
| `cwd`, `repoRoot`, `cwdRelative`                               | `git rev-parse --show-toplevel` (worktree root); cwd relative to it                                                                                                                                                                  |
| `repoUrl`, `repoName`                                          | normalized `host/org/repo` from `origin` with credentials and `.git` stripped; null outside a repo                                                                                                                                   |
| `branch`, `startCommit`, `endCommit`                           | branch null when detached                                                                                                                                                                                                            |
| `observedCommits`, `observedDiffStat`, `dirtyFileCount`        | observations at session end (`startCommit..endCommit`, `git diff --shortstat`); labeled _observed_, not attributed (§12)                                                                                                             |
| `model`, `modelsUsed`                                          |                                                                                                                                                                                                                                      |
| `startedAt`, `endedAt`, `lastActivityAt`                       | `startedAt` uses the normalized source timestamp when available, otherwise first receipt time; publication synchronizes the compact control timestamp for tree ordering and cursors. `lastActivityAt` is server receipt time.        |
| `status`, `endReason`                                          | `ACTIVE`, `ENDED`, `INACTIVE` (no receipt for 6 h; displayed as inactivity, not death)                                                                                                                                               |
| `lifecyclePos`, `lifecycleAt`                                  | persisted source ordering markers for lifecycle replay                                                                                                                                                                               |
| `normalizerContext`, `projectedContext`                        | redacted latest source context and last successfully projected context; a pending pi leaf retains the prior projection, and rescan rebuilds that prior branch from redacted raw records; neither context is exposed through `api_ro` |
| `title`, `firstPrompt`                                         | Claude `aiTitle` → Codex thread name → first prompt (120 chars); first prompt ≤ 4 KB, redacted                                                                                                                                       |
| `parentSessionId`, `parentRelation`, `parentNativeRef`         | relation ∈ `SUBAGENT`, `FORK`, `SPAWNED`; `parentNativeRef` keeps the harness's reference when the parent has not been ingested; resolved on parent arrival                                                                          |
| `agentType`                                                    | Claude `agent_type`; Codex `agent_role`/`agent_nickname`                                                                                                                                                                             |
| `visibility`, `purgedAt`, `purgedByUserId`, `purgeReason`      |                                                                                                                                                                                                                                      |
| `messageCount`, `toolCallCount`, `inputTokens`, `outputTokens` | maintained from newly accepted records only                                                                                                                                                                                          |
| `toolsUsed`                                                    | `text[]`                                                                                                                                                                                                                             |

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
Errors: `401/403` (suspend and report), `409` (session owned by another user, or
tombstoned), `413` (split), `422` (permanently invalid record: quarantined client-side,
other records accepted on resend without it), `429/5xx` (retry with backoff).

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
  queue intent and AuditEvent. `202` means that transaction committed.
- A worker claims a bounded source revision and reconstructs the canonical session
  from redacted raw records and receipt observations. It writes only changed native
  messages/files plus the complete header to ClickHouse. Older versions remain
  append-only; deleted derived records receive tombstones.
- Native row policies hide every unpublished revision. Only after every write is
  acknowledged does a PostgreSQL transaction advance the published revision, mark
  receipts published, remove the corresponding outboxes, and schedule embeddings.
  Readers hold a shared publication fence; publication, visibility, purge and redaction
  generation changes take its exclusive counterpart. Partial writes and failed
  publication checkpoints remain invisible and retry with stable identities.
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
length, catastrophic-backtracking check). JSON object values retain assignment-name
context for secret scanners. Regex policies additionally scan the unprefixed value,
so anchors have the same meaning on standalone strings, object values and array items.
Matches from both native scans merge before replacement/counting; overlaps count once
and repeat scans preserve terminal replacements (ADR 0039). Ordinary reads cache policies for 30 s.
Transactional ingestion, embedding, rescan, policy changes, moderation and audit redaction
load policies through the active transaction client; their local cache never publishes uncommitted policies to the
shared cache or requests an extra root-pool connection (ADR 0033). Worker audits use their
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
in one audit row per session touched. The session rewrite, audit, target checkpoint,
progress counters, and next native job commit together, serialized with ingest.
The worker rechecks current membership/key authority for each session and skips
tombstoned targets. It stores no request headers or credentials in job data.
`GET /admin/redaction/rescan/:id` exposes organization-scoped progress as specified in
§7.6. Completed and failed progress is retained for `AUDIT_RETENTION_DAYS`. See ADR 0016.

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

| relation                                                                                 | Claude Code                                                                                                                    | Codex                                                                                                                                       | Gemini CLI                     | pi                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------- |
| `SUBAGENT`                                                                               | child path known from `SubagentStart` (`agent_id`) via the verified layout; shipped with `parentHint`; `SubagentStop` confirms | child rollout `session_meta.source.subagent.thread_spawn.parent_thread_id`; hooks verified by name, payloads captured during implementation | captured during implementation | none                   |
| `FORK`                                                                                   | none (no native metadata)                                                                                                      | `forked_from` marker when present                                                                                                           | n/a                            | header `parentSession` |
| `SPAWNED`                                                                                | env `AGENTCOMMONS_PARENT_SESSION_ID`                                                                                           | same                                                                                                                                        | same                           | same                   |
| Native metadata outranks env hints; conflicts are recorded, never relinked silently.     |
| Unresolved parents stay in `parentNativeRef` until the parent arrives. Native references |
| and hook hints use the same redaction-aware identity mapping as session creation.        |
| Graph updates serialize per organization before any session row lock; concurrent         |
| opposing hints cannot introduce a cycle or deadlock. Self-links and cycle-forming        |
| edges are recorded as conflicts without replacing an established parent.                 |

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
   the `end` envelope. Repeat for each registered child source. Continue while intent
   changed during the loop or the source grew again; then clear intent, release the
   lock, exit.
3. Failures: `429/5xx/network` → backoff (1 s, 5 s, 30 s) up to three tries, then leave
   `pending` in place and exit (the next hook or sweep resumes). `401/403/409` → suspend
   the session (state `suspended` with reason), write to `hook.log`, exit. `413` → split
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

Guarantees, stated honestly: uploads are event-triggered. During activity, new content
is sent within about `syncIntervalSeconds`. An idle session with pending content waits
for its next hook or another session's sweep; there is no timer. Nothing is lost while
the disk survives: `ackedCursor` only advances on `202`, and the server dedupes.

### 6.3 Harness table

| behavior                                                                                               | Claude Code                                               | Codex                | Gemini CLI                               | pi                                                  |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | -------------------- | ---------------------------------------- | --------------------------------------------------- |
| `start`                                                                                                | `SessionStart`                                            | `SessionStart`       | `SessionStart`                           | `session_start`                                     |
| `sync`                                                                                                 | `UserPromptSubmit`, `PostToolUse`, `Stop`, `SubagentStop` | same                 | `BeforeAgent`, `AfterTool`, `AfterAgent` | `input`, `tool_result`, `agent_end`, `session_tree` |
| child source                                                                                           | `SubagentStart` (+ `SubagentStop` confirms)               | `SubagentStart/Stop` | —                                        | —                                                   |
| `end`                                                                                                  | `SessionEnd`                                              | `SessionEnd`         | `SessionEnd`                             | `session_shutdown`                                  |
| Readers: `jsonl-append` (byte offset) and `json-document` (per-index content hashes and                |
| source versions; acknowledged only with the pending batch). Each entry also carries config path, hooks |
| key, timeout unit (Gemini: ms), and MCP registration shape.                                            |

### 6.4 Environment

`AGENTCOMMONS_SERVER`, `AGENTCOMMONS_API_KEY`, `AGENTCOMMONS_PARENT_SESSION_ID`,
`AGENTCOMMONS_DISABLE=1`, `AGENTCOMMONS_DIR` (optional private config/state directory;
default `~/.agentcommons`). Installer `--config-home` selects an isolated native settings
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

The native text-index expression lowercases and tokenizes `searchText`, then applies
ClickHouse's English Snowball stemmer to each token. Query tokens use the identical
expression. All nonempty query tokens must match; ranking weights are defined in
§7.2. Literal substrings outside the ranked portion remain available through SQL
`LIKE` on `content`. PostgreSQL tsvectors and a query-language translation layer are
not retained.

### 7.2 `search`

Input (`packages/core/schemas/search.ts`):

```jsonc
{
  "query": "rate limiter", // token search with English stemming; may be "" if filters given
  "filters": {
    "repo_name": "cunningham",
    "branch": ["feat/x", "main"],
    "user_email": "…",
    "tool_name": "Edit",
    "file_prefix": "src/auth/",
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
  `host/org/repo` or a short name when unambiguous (400 otherwise). `user_email` exact.
  `tool_name` matches tool-use/result messages themselves. `file_prefix` selects
  _sessions_ that touched the path. `since` inclusive / `until` exclusive on **message
  time** (UTC). `session_id` searches within a session. Structured conditions below
  cover partial text and tool parameters; more complex queries use SQL.
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
  and English Snowball stemming. Every query token must match; punctuation separates
  tokens. The search box is a text query, with structured filters for conditions; SQL
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
  `cursor` (opaque, query-bound; same in REST and MCP), `truncated_response`.
  `content` is a match-centered excerpt (~300 chars around the first match; tool text
  300 chars). No scores or timings in the agent-facing text. Response budget 32 KB
  (transport cap 256 KB). Block title, model, repository, and branch previews, plus
  message tool name and tool identity previews, are bounded to 256 UTF-8 bytes,
  including an ellipsis when shortened. Each object's `truncated_fields` identifies
  shortened metadata. Full stored values remain available through SQL.

### 7.3 `get`

`{ session_id, from?, to?, cursor?: {seq, offset} }`; inclusive `seq` bounds;
`to < from` → 400. Cursor offsets count UTF-8 bytes and must fall on character boundaries;
REST encodes the cursor object as JSON in its query parameter. Same behavior
with or without a range. Returns a header with every session-level fact: `session_id`,
`title`, `harness`, `harness_version`, `entrypoint`, `model`, `models_used`,
`user_email`, `installation_id`, `installation_hostname`, `repo_name`, `repo_url`, `branch`, `cwd_relative`,
`start_commit`, `end_commit`, `started_at`, `ended_at`, `status`, `visibility` (`PUBLIC`/`PRIVATE`), `end_reason`,
`message_count`, `tool_call_count`, `input_tokens`, `output_tokens`, `tools_used`,
`file_count`, `observed_commit_count`, `reuse_count`, `agent_type`, `parent` ref and `children` refs
that the caller may see, `root_session_id`; then messages in order, every kind including thinking and tool results, each
`content` bounded to 4 KB with `content_cursor` for the remainder, total budget 32 KB,
`next` cursor `{ seq, offset }`. Full file lists, commits, and trees come from SQL.
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
  2 KB; total output is at most 256 KB. Errors contain a safe code, message and position
  with schema guidance. Native SQL bodies and errors containing values are not logged.

### 7.5 Security, silently

1. Better Auth verifies the key/cookie, immutable organization and current membership.
   Admin visibility requires an owner/admin membership and `admin:*` on a key; a
   read-only key owned by an admin remains an ordinary reader.
2. A native ClickHouse principal binds organization, user, effective authority,
   operator embedding capability and SaaS mode. Its credentials derive from the private
   reader secret. Grants permit only canonical views; the default role has no vector
   views. Native settings require read-only queries, a five-second deadline, 256 MiB
   memory and a 32 MiB internal result limit.
3. Native row policies protect every underlying corpus table and PostgreSQL-engine
   control metadata table. Fresh direct dictionaries read current publication,
   redaction generation, visibility, purge and embedding entitlement. A missing or
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
   two publication generations without acquiring nested PostgreSQL connections.
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
same bounded page as JSON, with `X-Next-Cursor` when another page exists. Full filtered
dashboard exports follow JSON cursors. REST and dashboard exports use one shared CSV
formatter with formula escaping, JSON serialization for structured cells, and empty
cells for null values. Table exports retain duplicate SQL column labels and their order.

| method          | path                                                                   | permission        | notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST            | `/ingest`                                                              | `sessions:ingest` | §5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| POST            | `/search`                                                              | `sessions:read`   | = `search`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| GET             | `/sessions/:id`                                                        | read              | = `get`; `?from=&to=&cursor=`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| POST            | `/query`                                                               | read              | = `sql`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GET             | `/schema`                                                              | read              | `schema_columns`, `schema_functions` as JSON                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| GET             | `/sessions`                                                            | read              | list with the §7.2 filters, no text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET             | `/sessions/:id/events`                                                 | read              | SSE `event: session`, data `{session_id,status,message_count,last_received_at}`; `last_received_at` is the server receipt timestamp exposed in SQL as `last_activity_at`; initial snapshot then changed snapshots, checked every 5 seconds. IDs are connection-local counters; reconnect sends a fresh snapshot, not a replay. Each tick reauthenticates current membership/key and reads through tenant visibility views; loss of access closes the stream. One read audit records the subscription. Dashboard falls back to polling every 5 seconds while `ACTIVE`. |
| GET             | `/sessions/:id/raw`                                                    | read              | paginated redacted raw records; oversized payloads are canonical JSON string fragments with `payload_fragment: { offset, next_offset }`; concatenate UTF-8 fragments before parsing. Raw pages order observations by `(pos, sourceVersion, id)`; the opaque cursor includes this complete identity and binds a fragment's redacted payload digest, rejecting continuation if a rescan changes it. Ordinary complete payloads have `payload_fragment: null`.                                                                                                           |
| GET             | `/sessions/:id/tree`                                                   | read              | paginated visible tree containing the session, `{ nodes, cursor }`, limit default 50/max 100: ancestors to the root and all descendants, each node `{ session_id, title, harness, agent_type, parent_relation, user_email, started_at, status, message_count }`, via a recursive CTE over `parent_session_id`; hidden nodes are omitted and their visible children attach to the nearest visible ancestor with `gap: true`                                                                                                                                            |
| GET             | `/sessions/:id/similar`                                                | read              | registered only when embeddings are enabled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| GET             | `/me`                                                                  | cookie or key     | user, role, key metadata                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| GET             | `/me/organizations`                                                    | cookie session    | current user's memberships only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| POST            | `/me/organization`                                                     | cookie session    | switch to an organization with active membership; invalidate dashboard caches and live streams                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| GET/POST/DELETE | `/me/keys`                                                             | cookie session    | create/revoke own keys; a key cannot mint keys                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| GET             | `/repos`, `/installations`                                             | read              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GET             | `/health`, `/ready`                                                    | none              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GET             | `/install.sh`, `/hook/manifest.json`, `/hook/<version>/hook.js` (root) | none              | §6.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| GET             | `/auth/config` (root)                                                  | none              | enabled login methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

`GET /billing/config` is public and returns mode/enabled, shared plan prices and record
allowances, nullable per-1,000 usage rates, checkout availability and an optional Cal.com
URL. It contains no organization data. `GET /billing` requires active membership and read
authority. It returns plan, billing period, records_used, included_records, remaining,
overage_records, embedding_messages_used, estimated usage charges, pending/reconciliation
meter counts and owner action availability. Non-SaaS returns `unmetered` with null allowance.
Owner-cookie `POST /billing/checkout` accepts `{plan: "pro" | "pro_embeddings"}`;
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

`GET /installations` and `GET /repos` use the shared list envelope with server-side
sort/order, limit/cursor, and filters. Installations sort by hostname, OS user, platform,
architecture, first/last seen, session count, or tools enabled; filters accept a literal
case-insensitive hostname substring and tools-enabled boolean. Repositories sort by
name, session/user count, first seen, or last activity and filter by a literal
case-insensitive repository substring. Catalog metadata previews are bounded to 256
UTF-8 bytes and identify shortened fields in `truncated_fields`.

`GET /home` returns the current ISO week, exactly eight UTC weekly reuse rows (including
empty weeks with zero counts and null rates), and the caller's `member_impact` counters.
`GET /home/:section` uses the shared paginated JSON/CSV envelope. Sections `reused`,
`inbound`, and `outbound` use the session-reuse edge query, sort keys and optional
`reader_user_id` filter above. `reused` covers reads in the current UTC ISO week;
`inbound` and `outbound` cover the caller's lifetime incoming/outgoing reuse. Repeated
reads of the same source/target pair produce one row with the latest read time.
`gap_repos` lists visible repositories whose sessions have never read prior work,
sorted by `sessions` or `repo_name`. `zero_results` lists only the caller's redacted
zero-result searches in the current week, sorted by `searched_at` or `query`. Both gap
lists accept `query` as a literal case-insensitive substring filter, up to 256 characters.
Search text is author-only in `api_ro.metrics_own_zero_results`, including for admins.
Gap metadata previews are bounded to 256 UTF-8 bytes with `truncated_fields`. Their
keyset cursors bind caller, filters, ordering and snapshot time, use bounded sort values
and stable identities, and survive removal of the preceding page's row. Reuse continues
to use the same keyset implementation as session detail. ADR 0029 records these choices.

Key responses include `user_email` and `user_name` for the issuing identity, joined only
through the current organization's key attribution. Both are null if that identity no
longer exists. `user_id` remains the stable identity binding and filter; the dashboard
shows the email/name as the owner label.

Admin (`/api/v1/admin`; current organization owner/admin + key `admin:*`, or organization admin cookie session):
`/users` (list, add emails, role, suspend/remove), `/keys` (list, revoke), `/sessions/:id/visibility`,
`/sessions/:id/purge`, `/audit`, `/redaction/policies` (CRUD), `/redaction/test`,
`/redaction/rescan`, `/redaction/rescan/:id` (GET progress), `/installations/:id/tools`
(`POST`, `{ enabled, reason }`, returning `{ installation_id, tools_enabled }`),
`/status` (current organization queue/backlog/spend snapshots), and `/metrics/:group`
(historical §10 metric groups with the shared `filters: {date_from, date_to, repo_name?, metric?}`
and server pagination/sort/CSV fields).
`GET /admin/domains` returns `{enabled,items,cursor}` for the current organization's
native Google bindings. Query fields are `limit` (default 50/max 100), opaque `cursor`,
literal domain substring, `verified=true|false`, `sort=domain|verified`, and `order=asc|desc`.
`POST /admin/domains` and `POST /admin/domains/verify` accept `{domain}` and return
`{organization_id,domain,provider_id,verified,dns_record}`. The nullable DNS record contains
native TXT `type`, `name`, and `value`. Registration retries recover the pending proof;
verification retries preserve the same binding. Owner/admin cookies are required for writes. Enrollment domains have labels of at most
63 characters and at most 202 characters total, leaving room for the native TXT proof
label within the DNS name limit.
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

### 8.2 Catalog: static, permission-filtered

User tools (`sessions:read`): `search`, `get`, `sql`, exactly as §7.2–7.4, plus personal
`dashboard_list`, `dashboard_save` and `dashboard_delete` (§10). Schemas
generated from the shared zod. If the key's installation has `toolsEnabled = false`
(staged rollout, §10), `tools/list` is empty for that key and calls return a clear
error; ingest is unaffected. Admin tools, listed only when the caller has effective
admin authority (§7.5) and each authorized again on invocation: `set_visibility
(session_id, visibility, reason)`, `purge(session_id, reason)` (`destructiveHint`),
`audit(filters, limit, cursor)` (exact ids, UTC bounds), `status()`. No data-derived
schema content; discovery is `schema_columns` via `sql`. The `sql` description lists the
views by name with one line each and the discovery query; it does not enumerate every
column.

Installation attribution uses the key's latest accepted ingest receipt within its bound
organization, ordered by server `receivedAt` and then receipt id. Keys with no accepted
ingest have no installation attribution and keep tools enabled. Shared keys follow their
latest installation; this is not an immutable per-device key binding. Replaying an old
batch does not replace the latest receipt. Every list and call refreshes this decision,
so cached tool catalogs cannot bypass a disabled installation.

Search, get, SQL and administrative history descriptions open with this governing sentence:
_"Only use this when the user asks about previous sessions or prior work; where possible
run multi-step investigation in a subagent that returns only findings with session ids."_

Dashboard profile tools instead open with a request to view or manage the caller's dashboard profiles. They retain the same current-organization authorization.

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
Gemini `mcpServers` entry. Claude user MCP entries live in `~/.claude.json`, separately
from the hooks in `~/.claude/settings.json`; Codex and Gemini use their hook config files.

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

**Verified-domain enrollment.** Organization owners and administrators manage Google
SSO domain access in Users: list bindings, register an exact domain, copy the native DNS
TXT proof, and verify its current status. The operator CLI calls the same audited service.
Better Auth owns registration, DNS ownership verification, and ordinary `member`
provisioning; Google continues to use `/auth/callback/google`. Writes require a real
owner/admin cookie and current organization authority. No synthetic sessions or manual
provider-table inserts are used. Lists are bounded, filtered, sortable and paginated.

A verified native domain binding permits matching Google-verified identities under
`AUTH_SIGNUP_MODE=invite` as well as `open`. A nonempty operator email-domain allowlist
still restricts admission; `closed` disables new identities and domain provisioning.
Unverified, wrong-domain and ambiguous multi-organization matches never gain access.
Existing roles are unchanged, and a password email suffix alone grants no membership.
The Users form explains Google login and DNS verification separately from adding people
by explicit email. See ADR 0042.

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
Key names contain 1–128 characters; optional `expires_in` is 1–31,536,000 seconds.
Omitting expiration creates a non-expiring key. Native Better Auth settings enforce
the same bounds as the shared input schema.
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
for reads; authentication failures audited; health and static assets not. Retention
`AUDIT_RETENTION_DAYS` (default 365). Append-only otherwise.
Failures before an organization can be authenticated have a null organization and are
visible only to instance operations, never through organization audit queries. All
identified operations, including membership and invitation changes, carry their scope.
Audit writes resolve installation attribution in the same transaction as mutations, so
the first accepted ingest can attribute its own audit row. Cookie operations, keys with
no accepted ingest, and historical rows without attribution have null installation ids.
The composite installation foreign key prevents cross-organization attribution.

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
an eligible organization can submit its name/slug to create one organization and become
its owner through Better Auth's organization API. Onboarding is serialized and idempotent;
retries or simultaneous initial requests cannot create additional organizations. An existing
eligible membership, including verified-domain enrollment, goes to the organization picker
or dashboard instead. SaaS users with verified native cookie sessions can explicitly create
another organization from that picker. Each new organization has its own owner membership,
keys, sessions and billing allowance. `POST /me/organizations` uses the same name/slug and
result schemas as onboarding; retrying an existing slug owned by the caller returns the
same organization without renaming it. Other slug collisions return 409. Removed or
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
CTA. Primary calls to action lead to `/signup`; authenticated users can reach `/usage`.
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

Screens: Login, password setup, organization switcher (only memberships), and a
no-organization state; **Home**, the first screen after login for every member, not only
admins: the selected built-in or personal dashboard profile. The built-in preset
contains the four current-week KPIs described below. The underlying Home API retains
eight-week reuse trends, cross-user reuse, personal impact and bounded reuse/gap feeds
for authorized consumers. Repository gaps mean no outgoing reuse; zero-result searches
are visible only to their author. These feeds do not add panels outside the selected
dashboard profile.
Sessions (search box + filter chips mirroring §7.2, result blocks exactly
as `search` returns them, and a list view whose columns are title, harness and version,
model, repo and branch, user, host, started, duration, messages, tool calls, observed
commits, **reused by** (count), status, with a column chooser and CSV export); Session detail (a header that
shows every field the `get` header carries with human labels and copyable ids, a
Details panel with token totals, models used, installation, cwd, entrypoint, start and
end commits, end reason, and links; a bounded virtualized transcript whose rows show
role, kind, tool name, timestamp, and the model when it changes, with token counts and
raw record id on hover; collapsible tool blocks and thinking toggle; a **Reused by** panel listing every later session that read this one through `get`
(session, user, harness, when) and a "Reused from" list of the sessions this one read; a Raw tab paging
the redacted raw records; live tail over SSE with 5 s polling fallback while `ACTIVE`, parent and children as a linked list plus a tree view
fed by `/sessions/:id/tree`: an expandable session and message outline, with the current
session highlighted, subagents nested under their parent with agent type and status,
and forks and spawned sessions labeled. Expanding a visible session loads a bounded
page of its messages from `get`; earlier/later controls retain its response cursors.
Messages stay in source order, with results nested only under an unambiguous matching
recorded tool-use ID. Messages link to `/s/<id>#<seq>` and can expand their content.
A child session attaches to its recorded parent session; the UI never invents a spawning
message link. Hidden nodes remain gap markers for admins only and never load messages.
Repository, branch, start SHA and end SHA are visible in the transcript header; validated
GitHub, GitLab and Bitbucket Cloud repositories have clickable branch/commit refs, while
other hosts retain a safe repository link and copyable values (ADR 0041). Missing Git
observations display an unavailable state; deep links `/s/<id>#<seq>`;
"Similar sessions" when embeddings are on); SQL page (full-width editor, an in-flow schema browser from `/schema`, and Copy schema
that copies the complete canonical response including types and descriptions for sharing
with an LLM; responsive results and CSV export); Installation (create an ingest/read key,
copy the served installer command, and check actual captured sessions); My keys (create shows plaintext once; install
command with key inlined); Admin: Users, Keys, Audit (filters, CSV), Moderation
(visibility, purge with reason), Redaction (policies, test, rescan progress), Status
(ingest per day, redaction hits, failures, queue depth, embedding backlog and spend,
as charts and tables). Admin Users includes adding people by email, password setup links,
role changes, and organization membership suspension/removal. Every data screen shows
the active organization. Switching clears prior data and closes live streams before
loading the new organization's data. An unselected organization picker uses a neutral
selection prompt when memberships exist. Members who open an admin URL see an access
message before any admin controls render or admin data requests run; server authority
checks remain mandatory. Keys show their bound organization.

**Page purposes.** Home opens with four concise current-week counts/rates: captured
sessions, sessions using AgentCommons search, sessions using prior work, and reuse rate.
These belong to the built-in preset. Selecting a personal profile replaces the entire
dashboard content; Home has no separate activity feed or extra metric panels.
Status covers operational health only: capture failures, redaction, queues, embedding
work and spend. It does not duplicate Home adoption/reuse/outcome panels. Historical
health has date/repository filters; current queue/spend snapshots remain organization-wide.
The existing Usage, Outcomes and Reuse metric APIs and SQL views remain available to
authorized callers and configurable dashboard profiles.

Home's dashboard dropdown selects the built-in preset or a personal profile scoped
to the user and organization (ADR0045). Up to20 profiles, each1–12 number/line/bar/table
widgets, persist through GET/POST `/me/dashboards` and DELETE `/me/dashboards/:id`.
JSON Forms uses the shared Zod-generated versioned declaration schema; JSON editing
uses the same validation. Recharts renders responsive charts. Names, SQL and chart
bindings are redacted before persistence. Updates require the saved revision;
conflicts return409. Each query executes through the existing guarded `/query` service
using current caller visibility. Profiles never store query results. Explicit MCP
`dashboard_list`, `dashboard_save`, and `dashboard_delete` provide the same personal
preferences capability to read keys, without organization-wide mutation authority.
The built-in preset is read-only; create, edit, duplicate, delete and reload are
available in the UI. No custom scripts or arbitrary executable chart declarations.

_North star: weekly reuse rate._ A session is a reuse session if, while it was `ACTIVE`,
the same installation called `get` on a different session id (attributed via
`AuditEvent.installationId` and the time window). Reuse rate is reuse sessions divided
by all sessions in the ISO week. The built-in Home preset shows the current week.
The trailing eight-week trend and cross-user variant (the read session belongs to
another member) remain available through the API and SQL for personal profiles.
It is a rate so it is independent of team size, and it moves only when capture, indexing,
search, and an agent's judgment all worked. Related guardrail metrics remain available through the authorized metric API: follow-through
precision (`get` within 10 minutes on an id returned by `search`), zero-result rate, and
capture coverage. The concise default Home does not duplicate these operational/API panels. The view is `api_ro.metrics_reuse_weekly (week, sessions,
reuse_sessions, cross_user_reuse_sessions, reuse_rate, cross_user_reuse_rate)`, also
exposed to `sql` so an agent or a spreadsheet can read it.

The same concept exists at two finer grains, from the same audit data: per session,
`api_ro.session_reuse (session_id, reuse_count, unique_readers, cross_user_reuse_count,
last_reused_at)`, surfaced as the "Reused by" panel and list column and as `reuse_count`
in the `sessions` view and the `get` header; per member, `api_ro.member_impact (user_id,
sessions_reused_by_others, distinct_readers, reuses_made)`, available through the API
and SQL for personal profiles. Reuse is
recorded only from `get` reads made through MCP or REST by a key whose installation had
an active session at the time; dashboard views by humans do not count.

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

**Transcript search adoption.** Home shows a current-UTC-week search-adoption summary
for every member. The authorized Usage metric API exposes the same measures over its
selected date/repo window, including sortable rows and CSV. The common source is the caller-visible,
nonpurged `api_ro.metrics_search_sessions` relation, one row per captured session:
`session_id`, `started_at`, `repo_name`, `harness`, `user_id`,
`agentcommons_search_calls`, `repeat_agentcommons_search_calls`, and
`subsequent_other_search_calls`. Selection uses the session's start time. Home returns
the selected session count, sessions with at least one AgentCommons search, the three
call totals, and the resulting session-adoption ratio (null for an empty denominator).
The Usage API uses metric names `agentcommons_search_sessions`, `agentcommons_search_rate`,
`agentcommons_search_calls`, `repeat_agentcommons_search_calls`, and
`subsequent_other_search_calls`.

Only actual captured typed tool invocations count. A shared classification reads exact
native tool identities verified in live fixtures; tool results, prose mentioning search,
advertised tool lists and arbitrary shell/program text are not searches. Native invocation
IDs deduplicate repeated observations within a session; a message identity is the fallback
when no invocation ID exists. Repeat AgentCommons searches are calls after its first call
in that session. Subsequent other searches are recognized code/web-search invocations
after that first AgentCommons call in canonical source order. Calls before it are excluded.
The active projected branch is counted, so retries, rewritten documents, forks, rescan,
privacy changes and purge cannot accumulate obsolete observations. Counts describe
attempted calls, including failures; they do not assert a successful response, saved time
or causation. The UI states the captured-tool coverage and keeps server-audit usage
measures available separately. See ADR 0034.

Reuse has one canonical `api_ro.reuse_edges` relation, shared by weekly, session and member
aggregates. Both reading and read sessions must be caller-visible and nonpurged. Only
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

**Copy.** Every string a user reads lives in `apps/dashboard/src/copy.ts` and is edited
with the vendored `no-ai-slop` skill (`.agents/skills/no-ai-slop/SKILL.md`) before merge:
lead with the fact, concrete nouns, short sentences, active voice, none of the banned
patterns. The rule covers public-facing text only: the README, dashboard copy, emails,
and error messages shown to users. Internal documents (this spec, CLAUDE.md, ADRs) are
exempt.

The SQL editor uses an established editor library with syntax highlighting, parser diagnostics, and completion from the caller-authorized canonical schema (tables, columns, functions and descriptions). Diagnostics are advisory; the service remains the query authority. Ctrl/Command+Enter runs, Ctrl+Space opens suggestions, and Tab leaves the editor. Completion and diagnostics must remain usable at320/390px without horizontal document expansion.

### 10.1 Public site and discovery

Public blog content lives in validated Markdown files. Frontmatter supplies slug, title, summary and publication date. One generated catalog supplies the index, post routes, prerendered HTML, canonical/OG/BlogPosting metadata, sitemap and LLM discovery content. Adding a Markdown post requires no route-list edit. Customer instances return404 for blog routes and omit blog navigation and discovery. Article prose lives in Markdown; interface labels remain in copy.ts. Native runtime SSR uses the actual instance mode for identical markup and hydration configuration.

The application serves a public landing page at `/`, login at `/login`, and the
organization dashboard at `/home`, `/sessions`, and the existing detail/admin paths. The landing
page and bundled `/docs` product guide use the generated logo and explain cross-tool session history, prior-work reuse,
and its relationship to versioned CLAUDE.md, AGENTS.md, and skills. Its calls to action
link to working login and documentation routes. An authenticated landing visit remains on the public page. It resolves
the native session and offers Dashboard or Continue setup as its primary action; public navigation
shows Open dashboard or Continue setup instead of Create account. Anonymous calls to
action offer signup only in SaaS mode. Product claims match verified behavior;
illustrative examples are labeled. All visible copy lives in copy.ts.

Landing and dashboard are responsive at mobile and desktop sizes, including forms,
admin tables, transcript controls, touch targets, and navigation. Both themes meet the
existing accessibility and browser verification bar. No horizontal viewport overflow;
tables fit the viewport with a small selectable summary of fields, mobile labeled
records, and an accessible full-record dialog. Actions remain visible without horizontal
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
public OpenAPI document still describes deployment capabilities. Queued jobs recheck the
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
5. MCP: static registry, six read-permission tools, admin tools, snippet.
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

**Native search tool identities, 2026-09-08.** Seven sanitized native transcripts in
`fixtures/transcripts/tool-identities/` capture Claude `mcp__agentcommons__search`,
`Grep`, `Glob`, `WebSearch`; Gemini `mcp_agentcommons_search`, `grep_search`, `glob`,
`google_web_search`; and pi `grep`, `find`. The pi capture extension has no MCP tool
bridge, so an unqualified third-party `search` name is not AgentCommons evidence.
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
| `EMBEDDINGS_ENABLED`, `EMBEDDINGS_PROVIDER`, `EMBEDDINGS_MODEL`, `EMBEDDINGS_DIMENSIONS`, `EMBEDDINGS_DAILY_TOKEN_BUDGET` | `false`, `openai`, `text-embedding-3-small`, `1024`, `5000000` | §11 |
| `SEARCH_CONTEXT_DEFAULT`, `SEARCH_LIMIT_DEFAULT` | `1`, `5` | |
| `LOG_LEVEL` | `info` | |
| client `config.json`: `realtime`, `syncIntervalSeconds`, `syncBytesThreshold`, `disabledPaths`, `installationId` | `true`, `10`, `65536`, `[]`, generated | §6 |

For verified-domain enrollment, configure `AUTH_SOCIAL_PROVIDER=google`, its client
credentials and `AUTH_SIGNUP_MODE=invite` or `open`. A nonempty
`AUTH_ALLOWED_EMAIL_DOMAINS` must include the exact domain. Organization administrators
can also register and verify the same DNS proof in Users. Bootstrap the organization owner and sign in normally.
Save that real session's Cookie header value as one line in a file owned by the
operator with mode `0600`. It is a credential; do not put it in command arguments,
source control, or logs.

```sh
pnpm db:domain register --organization goodhart-labs --domain goodhartlabs.com --cookie-file /private/owner.cookie
pnpm db:domain verify --organization goodhart-labs --domain goodhartlabs.com --cookie-file /private/owner.cookie
```

Registration returns `dns_record` with the native TXT `name` and `value`. Add that
record before verification. Repeating registration reuses an active verification
token; repeating successful verification is a no-op with an audit event. A verified
binding returns `verified:true` and `dns_record:null`. No provider management route is
publicly exposed. The organization slug selects the target; a native owner/admin
session for another organization cannot register or verify its domain.

## Appendix C. What the agent sees (regenerated by contract tests)

Generated from the real PostgreSQL and ClickHouse and official MCP SDK contract fixture at
`fixtures/contracts/mcp.json`. Regenerate with
`UPDATE_MCP_FIXTURES=1 pnpm exec vitest run apps/api/test/transport.integration.test.ts`.
Identifiers, receipt timestamps, and SQL timings are normalized for reproducibility.

Read keys list `search`, `get`, `sql`, `dashboard_list`, `dashboard_save`, and
`dashboard_delete`; effective admin keys also list
`set_visibility`, `purge`, `audit`, and `status`.

`tools/list` input contracts (output schemas are present in the fixture):

```json
[
  {
    "name": "dashboard_list",
    "description": "Use this when the user asks to view or manage their dashboard profiles. List your personal dashboard profiles in the current organization and the versioned declaration schema.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "$schema": "https://json-schema.org/draft/2020-12/schema",
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
    "description": "Use this when the user asks to view or manage their dashboard profiles. Create or update your personal dashboard with number, line, bar or table widgets over guarded SELECT queries. Use id and revision to update an existing profile.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
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
        "definition": {
          "type": "object",
          "properties": {
            "version": {
              "type": "number",
              "const": 1
            },
            "widgets": {
              "minItems": 1,
              "maxItems": 12,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^[a-zA-Z][a-zA-Z0-9_-]{0,39}$"
                  },
                  "title": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 80
                  },
                  "sql": {
                    "type": "string"
                  },
                  "display": {
                    "type": "string",
                    "enum": ["number", "line", "bar", "table"]
                  },
                  "x": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 128
                  },
                  "y": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 128
                  },
                  "unit": {
                    "type": "string",
                    "enum": ["count", "ratio", "seconds", "tokens", "usd"]
                  }
                },
                "required": ["id", "title", "sql", "display", "unit"],
                "additionalProperties": false
              }
            }
          },
          "required": ["version", "widgets"],
          "additionalProperties": false
        }
      },
      "required": ["name", "definition"],
      "$schema": "https://json-schema.org/draft/2020-12/schema",
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
    "description": "Use this when the user asks to view or manage their dashboard profiles. Delete one of your personal dashboards in the current organization.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": ["id"],
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    }
  },
  {
    "name": "search",
    "description": "Only use this when the user asks about previous sessions or prior work; where possible run multi-step investigation in a subagent that returns only findings with session ids. Search previous coding-agent messages with words and structured filters. All query tokens must match; English inflections share a stem. Results contain message windows grouped by session; use session_id and seq with get or sql.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string"
        },
        "filters": {
          "default": {},
          "type": "object",
          "properties": {
            "repo_name": {
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
              "anyOf": [
                {
                  "type": "string",
                  "format": "email",
                  "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "format": "email",
                    "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
                  }
                }
              ]
            },
            "tool_name": {
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
            "role": {
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
              "anyOf": [
                {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  }
                }
              ]
            },
            "since": {
              "anyOf": [
                {
                  "type": "string",
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
                  }
                }
              ]
            },
            "until": {
              "anyOf": [
                {
                  "type": "string",
                  "format": "date-time",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
                },
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "format": "date-time",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
                  }
                }
              ]
            },
            "where": {
              "minItems": 1,
              "maxItems": 10,
              "type": "array",
              "items": {
                "oneOf": [
                  {
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
                        ]
                      },
                      "path": {
                        "minItems": 1,
                        "maxItems": 8,
                        "type": "array",
                        "items": {
                          "type": "string",
                          "maxLength": 256
                        }
                      },
                      "op": {
                        "type": "string",
                        "const": "eq"
                      },
                      "value": {
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
                    "required": ["field", "op", "value"],
                    "additionalProperties": false
                  },
                  {
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
                        ]
                      },
                      "path": {
                        "minItems": 1,
                        "maxItems": 8,
                        "type": "array",
                        "items": {
                          "type": "string",
                          "maxLength": 256
                        }
                      },
                      "op": {
                        "type": "string",
                        "const": "contains"
                      },
                      "value": {
                        "type": "string",
                        "maxLength": 4096
                      }
                    },
                    "required": ["field", "op", "value"],
                    "additionalProperties": false
                  },
                  {
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
                        ]
                      },
                      "path": {
                        "minItems": 1,
                        "maxItems": 8,
                        "type": "array",
                        "items": {
                          "type": "string",
                          "maxLength": 256
                        }
                      },
                      "op": {
                        "type": "string",
                        "const": "starts_with"
                      },
                      "value": {
                        "type": "string",
                        "maxLength": 4096
                      }
                    },
                    "required": ["field", "op", "value"],
                    "additionalProperties": false
                  },
                  {
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
                        ]
                      },
                      "path": {
                        "minItems": 1,
                        "maxItems": 8,
                        "type": "array",
                        "items": {
                          "type": "string",
                          "maxLength": 256
                        }
                      },
                      "op": {
                        "type": "string",
                        "const": "exists"
                      }
                    },
                    "required": ["field", "op"],
                    "additionalProperties": false
                  }
                ]
              }
            }
          },
          "additionalProperties": false
        },
        "context": {
          "default": 1,
          "type": "integer",
          "minimum": 0,
          "maximum": 3
        },
        "limit": {
          "default": 5,
          "type": "integer",
          "minimum": 1,
          "maximum": 50
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
        }
      },
      "required": ["query"],
      "$schema": "https://json-schema.org/draft/2020-12/schema",
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
    "description": "Only use this when the user asks about previous sessions or prior work; where possible run multi-step investigation in a subagent that returns only findings with session ids. Read a session header and messages by session_id. Bound a range with from/to; use next and content_cursor to continue.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "from": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "to": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "cursor": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "seq": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991
                },
                "offset": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991
                }
              },
              "required": ["seq", "offset"],
              "additionalProperties": false
            },
            {
              "type": "null"
            }
          ]
        },
        "session_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": ["session_id"],
      "$schema": "https://json-schema.org/draft/2020-12/schema",
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
    "description": "Only use this when the user asks about previous sessions or prior work; where possible run multi-step investigation in a subagent that returns only findings with session ids. Run one read-only ClickHouse SELECT over api_ro. Views: sessions (session metadata); messages (normalized messages); session_files (observed files); session_observed_commits (commit observations); session_tools (tool counts); users (visible contributors); installations (visible devices); repos (visible repository counts); schema_columns (column descriptions); schema_functions (function descriptions). search_messages(q='words') returns uncapped session_id,seq,rank. Discover columns with SELECT * FROM schema_columns WHERE view_name = 'sessions'. Limits: 500 rows, 5 seconds.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sql": {
          "type": "string"
        }
      },
      "required": ["sql"],
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "name": "set_visibility",
    "description": "Only use this when the user asks about previous sessions or prior work; where possible run multi-step investigation in a subagent that returns only findings with session ids. Change session visibility between PUBLIC and PRIVATE with a reason. Private sessions are visible to organization admins only.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "session_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
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
      "$schema": "https://json-schema.org/draft/2020-12/schema",
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
    "description": "Only use this when the user asks about previous sessions or prior work; where possible run multi-step investigation in a subagent that returns only findings with session ids. Permanently remove session contents and retain its tombstone. Supply a reason.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "session_id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "reason": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": ["session_id", "reason"],
      "$schema": "https://json-schema.org/draft/2020-12/schema",
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
    "description": "Only use this when the user asks about previous sessions or prior work; where possible run multi-step investigation in a subagent that returns only findings with session ids. Read this organization's audit events using exact identifiers and UTC time bounds.",
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
              "format": "date-time",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
            },
            "until": {
              "type": "string",
              "format": "date-time",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
            }
          },
          "additionalProperties": false
        }
      },
      "$schema": "https://json-schema.org/draft/2020-12/schema",
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
    "description": "Only use this when the user asks about previous sessions or prior work; where possible run multi-step investigation in a subagent that returns only findings with session ids. Read this organization's ingestion, redaction, and background job status.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  }
]
```

`search` text rendering; structuredContent contains the corresponding schema-validated fixture value.

```text
1 session

session_id: 00000000-0000-4000-8000-000000000001 | Investigate the transport session index
repo_name: github.com/rek7/agentcommons | branch: main | user_email: transport-primary@example.com
harness: CLAUDE_CODE | model: null | started_at: 2026-09-07T01:00:00.000Z
seq 0 USER TEXT [hit]
Investigate the transport session index
```

`get` text rendering; structuredContent contains the corresponding schema-validated fixture value.

```text
session_id: 00000000-0000-4000-8000-000000000001 | organization_id: fixture-organization | title: Investigate the transport session index
harness: CLAUDE_CODE | harness_version: null | entrypoint: null
model: null | models_used: [] | user_email: transport-primary@example.com
installation_hostname: transport-fixture | installation_id: 00000000-0000-4000-8000-000000000002 | repo_name: github.com/rek7/agentcommons
repo_url: github.com/rek7/agentcommons | branch: main | cwd_relative:
start_commit: abc123 | end_commit: null | started_at: 2026-09-07T01:00:00.000Z
ended_at: null | status: ACTIVE | visibility: PUBLIC
end_reason: null | message_count: 1 | tool_call_count: 0
input_tokens: 0 | output_tokens: 0 | tools_used: []
file_count: 0 | observed_commit_count: 0 | reuse_count: 0
agent_type: null | parent_session_id: null | parent_relation: null
parent: null | children: [] | child_count: 0
children_truncated: false | truncated_fields: [] | root_session_id: 00000000-0000-4000-8000-000000000001

seq 0 USER TEXT timestamp=2026-09-07T01:00:00.000Z model=null
Investigate the transport session index
message_id: 00000000-0000-4000-8000-000000000003 | raw_record_id: 00000000-0000-4000-8000-000000000004 | ingest_batch_id: null
input_tokens: null | output_tokens: null
```

`sql` text rendering; structuredContent contains the corresponding schema-validated fixture value.

```text
1 row
session_id (UUID) | title (Nullable(String))
00000000-0000-4000-8000-000000000001 | Investigate the transport session index
```

Tool failures return `isError: true` and a text JSON error. They omit structuredContent
because it would otherwise be validated against the tool's success output schema.
