# Working in this repo (for humans and agents)

This file is `AGENTS.md`. `CLAUDE.md` and `GEMINI.md` are symlinks to it, so Claude Code,
Codex, Gemini CLI, and pi read the same instructions. Edit `AGENTS.md` only. The
`no-ai-slop` skill lives in `.agents/skills/` and is linked into `.claude/skills/` and
`.codex/skills/` for the same reason.

AgentCommons is a central, append-only index of coding-agent sessions with search for
people (dashboard) and agents (MCP). This file tells you where things are, what the
rules are, and how to make a change that will be accepted.

## This repository is public

AgentCommons is open source. Every tracked file, and everything in git history, is
world-readable and permanent — a secret that lands in one commit is compromised even if a
later commit removes it. Before you commit, assume the diff will be published forever.

- Never commit real secrets: API keys, tokens, passwords, private keys, connection
  strings with real credentials, cloud keys, or `.env` files with real values. Config
  goes through env vars or Pulumi-encrypted config (`secure:` in `infra/Pulumi.*.yaml`),
  never plaintext. `.env` is gitignored; keep it that way and never force-add it.
- Never commit real user PII or unredacted transcripts. Fixtures MUST pass through the
  redactor (CI enforces this); use `@example.com`/`@example.test` addresses and generic
  paths, never a real person's email, name, or home directory. Screenshots mask keys and
  use example hostnames.
- Keep internal infrastructure identifiers out of tracked files where avoidable
  (prod hostnames, account IDs, ARNs, instance/cluster IDs, private endpoints). Where a
  real deployment must be documented (e.g. `docs/customer-deployment.md`), keep it to
  non-sensitive topology and prefer placeholders.
- If you ever commit a real secret, treat it as leaked: rotate it immediately, then fix
  history — removing it from the working tree is not enough.

## Start here if you are implementing

1. Read `docs/SPEC.md` §0 through §3 in full. Then read the section for the step you are
   on, in the order given by §17. Do not skim; the spec is the contract.
2. Run `node scripts/spec-check.mjs --report`. Every uncovered ID in `docs/REQUIREMENTS.md`
   is work to do. Your job is to drive that number to zero.
3. For each §17 step: implement, write tests that cite `@req R-AREA-NN`, run the checker,
   and update the spec section and requirement row if you learned something the spec got
   wrong. Spec and code move together in the same PR.
4. Before writing the Gemini CLI or pi adapter, capture its hook contract live using the
   method in Appendix A (a scripted session with every hook dumping stdin), commit the
   payloads under `fixtures/hooks/`, and record them in Appendix A. Never build against a
   guessed contract.
5. Verified facts about Claude Code and Codex are in Appendix A and `fixtures/hooks/`;
   build against those, not against documentation.
6. Done means spec §16.1 item 8: all verification green, `spec-check` at zero uncovered,
   and a real session from each supported harness visible in the dashboard and found by
   an agent through MCP.

## Source of truth

- `docs/SPEC.md` is v5. `docs/reviews/` holds the external review, v2, and pre-organization v3;
  ADR 0010 lists what was dropped and why. Do not reintroduce a dropped feature without a
  new ADR.
- `docs/SPEC.md` is the specification and is implementation-ready. If code and spec
  disagree, the spec wins until an ADR says otherwise. Behavior changes start there.
- `docs/REQUIREMENTS.md` is the traceability matrix: one stable ID per testable statement.
  Tests cite IDs with `@req R-AREA-NN`. `pnpm spec:check` fails when any ID has no test.
  Changing behavior means updating the spec section, the requirement row, and the tests
  in the same PR.
- `docs/adr/` records why decisions were made. Add an ADR when you change a decision;
  do not silently diverge.
- `fixtures/hooks/` are live-captured hook payloads from Claude Code and Codex. Treat
  them as ground truth for the hook contract; re-capture rather than hand-edit.

## Layout

```
apps/api          Fastify server: REST (/api/v1), MCP (/mcp), Better Auth (/auth), worker,
                  static dashboard, install.sh + versioned hook.js hosting
  src/services/   one service per capability; adapters call these and nothing else
  src/routes/     REST routes registered explicitly with shared zod schemas; optional
                  route groups (SaaS, domain enrollment, embeddings) are registered only
                  when active, so the live OpenAPI lists active routes
  src/mcp/        tools registered explicitly with the SDK from the same schemas
  public/         install.sh, hook manifest
apps/dashboard    Vite + React + shadcn/ui; talks to the API via an OpenAPI-generated client
  src/router.tsx  public pages, account pages, and the application under /app
  src/lib/routes.ts  every in-app path (there are no legacy routes or redirects)
  src/copy.ts     composes the per-area copy modules in src/copy/*.ts
  src/pages/      one file per screen; admin screens under src/pages/admin/
packages/core/dashboards  Team overview definition, tile templates, typed variable resolution
packages/db       Native Better Auth/Prisma identity and compact control migrations
packages/traces   ClickHouse corpus, native policies, canonical views/indexes and migrations
packages/core     zod schemas, normalizers (claude-code, codex), redaction, link detection
packages/hook     zero-dependency client shim, bundled to a single dist/hook.js
packages/pi-extension  pi extension package (git-installable) emitting canonical events
infra             Pulumi (TypeScript, @pulumi/awsx): stacks dev and prod
fixtures          hook payloads and sanitized transcripts
docs              SPEC.md, adr/, reviews/
```

## Rules

- Organizations scope every caller, key, query, mutation, policy, audit, and background
  job. Membership roles, not global user roles, grant organization authority. Use Better
  Auth's organization, membership, API-key, SSO, and credential APIs; no custom identity
  or invitation system. Admins add email addresses as members; no CSV or invitation email.
  Admins allowlist Google sign-in domains on Settings without DNS verification (ADR 0049).
  SaaS mode uses native verification and welcome email, name-only organization onboarding
  (slug derived server-side) and Stripe billing (§9.6).
- Dashboards are organization-visible objects (ADR 0048): a shared Zod definition of
  stat/chart/table/text/control tiles on a 12-column grid, an allowlisted ECharts option,
  and typed `{name:Type}` variables checked by the SQL guard. Every data tile runs through
  the existing query service. Home is the organization's default dashboard; there is no
  separate Home API. The app lives under `/app`; do not add legacy routes, redirects or
  compatibility paths. This is an early project: make major changes correctly, not
  backwards compatibly.
- Core tenet: one implementation per concept. Differences between harnesses, transports,
  and feature flags are data a single implementation reads (the shim's `HARNESSES`
  table, shared zod schemas, the tool registry), never parallel code paths. `if (harness
=== …)` outside an adapter is a defect. Duplicate logic in two adapters is a defect.
- Use libraries, do not hand-roll: Better Auth (users, keys, roles, SSO), secretlint
  (redaction), pg-boss (jobs), the official ClickHouse client and parser (trace storage/SQL guard), the official MCP SDK,
  @pulumi/awsx. If you think you need custom code for one of these, write an ADR first.
- TypeScript strict everywhere. No `any`, no non-null assertions. `pnpm typecheck` and
  `pnpm lint` must pass; CI enforces them.
- Zod at every boundary: HTTP bodies, hook stdin, env, transcript records (with
  `passthrough()` so unknown harness fields are kept).
- Never hand-edit Better Auth's Prisma models; regenerate them.
- `packages/hook` has zero runtime dependencies, three modes (hook, upload, mcp), and one code
  path per mode. Hook mode never touches the network; upload mode is always a detached
  child running the durability state machine in spec §6.2 (persisted intent, one pending
  batch, lock with liveness, `ackedCursor` advanced only on `202`). Adding a harness is one
  `HARNESSES` entry plus a normalizer.
- Organization, visibility, redaction generation, purge, publication and embedding
  entitlement are enforced by native ClickHouse row policies on underlying tables and
  fresh direct PostgreSQL control dictionaries (ADR0047). A shared publication fence
  covers each bounded read callback; mutations use its exclusive counterpart. DEFINER
  views alone are not isolation. Derived fields use only caller-visible data. PostgreSQL
  holds identity/control, never a permanent trace or vector corpus.
- Every operation writes one AuditEvent: inside the transaction for mutations, before the
  response for reads. Services return `{ result, audit }`; adapters never write audit rows.
- Redaction runs on every persisted free-text path (records, git fields, titles, audit
  detail) before any write, and the server never logs request bodies.
- Redaction rules are data: shipped rules plus `RedactionPolicy` rows (regex, or a
  preinstalled secretlint rule from a fixed allowlist) composed at run time. Rescan
  re-derives everything from raw records so nothing is missed.
- Field names visible to agents are the `api_ro` column names. Keep them consistent
  across `search`, `get`, `sql`, and the dashboard.
- Every application route under `/api` declares zod schemas for params, query, response, and body when
  its HTTP method supports one
  plus a `summary`; the server refuses to boot otherwise, and OpenAPI is generated from
  them. The reserved `/api/docs` namespace is served by the native Scalar plugin
  using its own schemas. Never write OpenAPI by hand.
- Exposing a capability to agents = registering a tool explicitly in `src/mcp/` with the
  shared zod schema, a permission, the service call, and the shared formatter (or
  `toolFromRoute(route)` when a body-schema route is identical). The catalog is static and
  permission-filtered; never derive tool schemas from database contents. Admin tools
  require effective admin authority (current organization owner/admin AND `admin:*` key), checked at list time
  and again on every call.
- Adapters (REST, MCP, CLI, dashboard) translate; they do not contain logic. Logic lives
  in services; formatting lives in `packages/core/format`. If you are writing the same
  thing in two adapters, stop and move it down.
- Git hooks run on every commit and push (lint-staged, typecheck, unit tests, OpenAPI
  check). Do not bypass them with `--no-verify`; fix the failure.
- Tests are part of the change: unit for core/hook, integration on real PostgreSQL and ClickHouse via
  testcontainers for the API, e2e for shim, MCP, and dashboard flows.
- No secrets in the repo. Fixtures pass through the redactor in CI.

## Read-path performance rules

Reads run as ClickHouse reader principals with a 5 s time limit, 2 threads and 256 MiB, while
holding the organization's publication fence. Measured on the hosted instance, the failures users
saw came from a class of query shapes, not one query. Every read path follows these rules:

- Row policies and views never call a dictionary per row when the predicate can be set membership
  or a scalar map over the same live dictionary (ADR 0062).
- One scan per relation per request. Counts, totals and paging metadata come from the same scan
  (`count() OVER ()`, `WITH TOTALS`, `LIMIT n+1`); never a second query over the base view.
- No per-page recomputation of request-level data and no N+1 queries per row or page.
- A view scans each base table once; a layered view must not re-evaluate an expensive parent view.
- Every new or changed query is measured on a fixture with at least 40,000 messages as the admin
  reader and as a member reader before it ships, and stays well under the reader limit at four-way
  concurrency.
- Concurrent work (dashboard tiles, transcript pages) runs under a fixed, documented in-flight cap.
- Unexpected failures are logged with the request id and their cause; request bodies and statement
  text are never logged.

## Writing: public-facing text only

Use the vendored `no-ai-slop` skill (`.agents/skills/no-ai-slop/SKILL.md`, linked into
`.claude/skills/` and `.codex/skills/`) on text that end users read: README.md, dashboard
copy (`apps/dashboard/src/copy.ts`, which composes `apps/dashboard/src/copy/*.ts`),
emails, and error messages shown in the UI. Run
`/no-ai-slop` over the diff before committing those files. Internal documents (spec,
this file, ADRs, code comments) are exempt. Rules that matter most for public copy: lead
with the fact; no "It's not X, it's Y"; no throat-clearing; no colon reveals or dramatic
fragments; no puffery; concrete nouns and numbers; short sentences; active voice.

## Screenshots follow the UI

README.md and `docs/assets/screenshots/*.png` show the real dashboard, captured from the seeded
browser fixture (provenance and settings in `docs/assets/README.md`). Any change that alters what
those screens show (layout, components, copy, colours, new controls such as counts or export
actions) retakes every referenced screenshot in the same change: run
`apps/dashboard/scripts/readme-screenshots.mjs` against the fixture, both themes, replace the
files, and update the capture date in `docs/assets/README.md`. Never hand-edit a capture or
leave a stale one; a dashboard change that touches a screen the README shows is incomplete
until its screenshots are regenerated. When you add a screenshot anywhere (README, docs, blog),
add it to that script so it is regenerated with the rest.

## Commands

```
pnpm install
docker compose -f docker-compose.dev.yml up -d   # local PostgreSQL control + ClickHouse traces
pnpm db:migrate && pnpm db:seed --admin you@example.com
pnpm dev                       # api :3000, dashboard :5173
pnpm test | pnpm test:e2e | pnpm lint | pnpm typecheck
pnpm spec:check                # traceability: every requirement has a test (scripts/spec-check.mjs)
pnpm hook:link                 # install the local shim against http://localhost:3000
```

## Harness facts you will need (verified live, see spec Appendix A)

- Both harnesses use the same hook config shape and nearly the same stdin fields:
  `session_id`, `transcript_path`, `cwd`, `hook_event_name`, plus event-specific ones.
- Codex 0.150 loaded both user/project `hooks.json` files. Verified 0.153.4 installs use
  inline hooks in user `config.toml`; persisted user profiles work too. Duplicate
  callbacks share the owning native process PID/birth identity and are coalesced.
- Codex runs no hooks until the user trusts them once interactively.
- Codex clamps `SessionEnd` hooks to 3 s.
- Claude Code subagent transcripts live in `<session>/subagents/agent-<id>.jsonl`; the
  parent transcript does not contain them. `SubagentStop` gives the path.
- Gemini CLI uses the same hook config and stdin shape (timeouts in ms) but its
  transcript is a JSON document rewritten on every change; use the `json-document`
  reader, never byte offsets. Headless Gemini needs `GEMINI_API_KEY`.
- pi has no shell hooks. `packages/pi-extension` maps its extension events to the
  canonical six and spawns `hook.js pi`. Sessions are append-only tree JSONL with
  `id`/`parentId`; forks record `parentSession`.
- Adding a harness follows the checklist in spec §3.1. Do not add harness-specific
  code outside the reader, normalizer, `HARNESSES` entry, and install step. Capture a
  harness's contracts live before writing its adapter. Gemini CLI 0.35.3 and pi 0.73.1
  lifecycle/tool/fork contracts are now captured in `fixtures/hooks/` and Appendix A.

## Definition of done for a change

Spec updated if behavior changed · requirement rows updated and cited by tests ·
`pnpm spec:check` passes · ADR if a decision changed · tests green · lint and typecheck
clean · OpenAPI diff reviewed if routes changed.

<!-- agentcommons-hook begin -->

## AgentCommons

Past agent sessions on this repository and across its organization are indexed in
AgentCommons (MCP server `agentcommons`: search, get, sql). Sessions on machines with
the AgentCommons hook are recorded automatically. Before you change code, search it for
the test, file or error you were given: an earlier session often holds the root cause,
the library the team chose or the exact value. Use it too when the user asks about prior
work; anything beyond a quick lookup runs in a subagent that brings back only findings
and session ids. If this machine has no `agentcommons` MCP server, tell the user once
that the AgentCommons install is missing and continue without it.
<!-- agentcommons-hook end -->
