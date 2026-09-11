# ADR 0072: The administration tool group is derived from the admin route table

Date: 2026-09-11
Status: Accepted, amended the same day (below: the management server is a second
registration set up from an admin page; the Install page mints only the standard key).
Refines ADR 0068 (tool groups, catalog budgets) and §8.2, §8.4, §9.2, §10; ADR 0053's
default-catalog budget stands.

## Context

ADR 0068 made the default catalog `search`, `get` and `sql` and put the dashboard tools behind
an opt-in `dashboards` group. An effective admin key added four standing tools:
`set_visibility`, `purge`, `audit` and `status`. Everything else an administrator does
(members, keys, redaction policies and rescans, moderation lists, installations, metrics,
Google domains) existed only as 28 REST routes under `/admin`. The user asked for an install
"more broad than just search, so they can actually administer the whole platform while still
having the agent retrieval capabilities".

Two constraints shaped the answer. Every capability exists once: the REST routes already
carry the shared zod schemas, a summary and the service call, so hand-writing 24 more tool
blocks would be the duplicated adapter logic AGENTS.md forbids. And every byte of a tool
definition is a byte of the model's working set on every turn (ADR 0053, 0068), so the
larger catalog must be an explicit grant, never the default.

## Decision

1. **A second tool group, `administration`.** `keyToolGroupSchema` is `dashboards |
administration`. The shared `keyPermissionsSchema` refuses `administration` without
   `admin: ["*"]` on the same key, so the rule holds at every boundary (key creation, stored
   permissions, the caller context) and only owners and admins can mint it, through the rule
   that already guards `admin:*`. Listing and calling apply the group and effective admin
   authority the same way `dashboards` and the standing admin tools do; no adapter branches
   on the group.
2. **The admin routes are data.** `apps/api/src/routes/admin-routes.ts` declares every
   `/admin` route once: method, path, summary, params/query/body/output schemas, CSV flag,
   optional feature gate, tool name and annotations, and the service call. `registerApiRoutes`
   registers the active ones; `McpService` derives the group from the same table with one
   helper, `toolFromRoute(route, services)`: the summary is the description (after one shared
   instruction sentence), params, query and body merge into one strict input without the REST
   `format` switch (a discriminated-union body becomes one input variant per option, rendered
   as an object with `anyOf`), a call splits the arguments back into the route's parts,
   re-parses them with the route's own schemas and runs the same service, and the shared JSON
   formatter renders the result. The catalog is computed once at boot from the active routes
   and permission-filtered per request, as before.
3. **Names and coverage.** Tools are `admin_<resource>_<verb>` in route order:
   `admin_domains_list`, `admin_domain_allow` (domain enrollment only), `admin_members_list`,
   `admin_members_add`, `admin_member_password_setup`, `admin_member_set_role`,
   `admin_member_set_suspension`, `admin_member_remove`, `admin_keys_list`,
   `admin_key_revoke`, `admin_sessions_list`, `admin_installation_set_tools`,
   `admin_metrics_list`, `admin_policies_list`, `admin_policy_create`, `admin_policy_update`,
   `admin_policy_remove`, `admin_redaction_test`, `admin_redaction_summary`,
   `admin_redaction_hits_list`, `admin_rescans_list`, `admin_rescan_get`,
   `admin_rescan_sessions_list`, `admin_rescan_start`. A route whose capability a standing
   admin tool already covers names that tool (`set_visibility`, `purge`, `audit`, `status`)
   and derives nothing, so no capability is exposed under two names; the constructor checks
   that every standing tool covers a route and every derived name starts with `admin_`. Key
   creation is cookie-only (§9.2, keys cannot mint keys), so there is no `admin_key_create`.
4. **Administrator install.** The Install page shows owners and admins an "Administrator
   install" card that creates a key with `sessions: [ingest, read]`, `tools: [dashboards,
administration]` and `admin: ["*"]`, puts it in the step 3 command and states the catalog
   cost. Upgrading a machine is running that command again: the installer replaces the key
   under the single `agentcommons` server name, so the shim keeps managing it and the grant on
   the key decides the catalog. The key dialog offers `administration` only to owners and
   admins and only once Admin is checked.
5. **Budgets (R-MCP-13).** Measured on 2026-09-11 from the registry: default 9,398 bytes (3
   tools, unchanged), `dashboards` 17,074 (8), admin without a group 12,261 (7), admin with
   `dashboards` 20,434 (13), admin with `administration` 32,132 (30; 32,669 with domain
   enrollment, 31), and the administrator install's key 40,305 (36; 40,842 with domain
   enrollment, 37). The two largest derived tools are the policy create/update pair (2.4 KB
   each, two body variants); the rest are 0.4 to 1.8 KB. The administration catalog stays
   under 40 KB and the complete catalog under 48 KB; the default, `dashboards` and
   admin-with-`dashboards` budgets of ADR 0068 are unchanged and still measured.

## Consequences

- The complete catalog is about 10,000 tokens. The installer's Claude Code entry carries
  `alwaysLoad: true` (§8.4), so Claude Code keeps it in context on every turn instead of
  deferring it behind `ToolSearch`; the Install copy says so and tells administrators to use
  the key only on machines where they administer the organization.
- Adding an admin capability is one route declaration: REST, OpenAPI, the dashboard client
  and the MCP tool follow. Changing a route's schema changes its tool's input in the same
  change; the transport test asserts each derived tool's description and annotations against
  its route.
- Appendix C keeps the 13-tool catalog in full and adds a table of the derived tools (name,
  summary, fields), regenerated from the contract fixture, which now carries the
  `administration` catalog.
- `openapi.json` lists the two `/admin/domains` operations after `/me/keys/{id}/reveal`
  because the admin routes register from one loop; paths and operation ids are unchanged.

## Amendment (2026-09-11)

Decision 4 and the first consequence are replaced. The user rejected the "Administrator
install" card: the Install page should only create the standard key, and the management
server belongs on its own admin page.

- **The management server is a separate registration.** `agentcommons-admin` is a second
  MCP server next to the everyday `agentcommons` entry, never a replacement for it. Its key
  carries `sessions: [read]`, `tools: [dashboards, administration]` and `admin: ["*"]`
  (no `ingest`: it manages, it does not capture). The everyday server keeps `search`, `get`
  and `sql` with the default catalog; the management server carries the 36 tools.
- **Set up from the Management MCP page** (`/app/admin/mcp`, Organization section, owners
  and admins). The page says what the server is, creates the key through the same
  `POST /me/keys` service and audit as Keys, shows the secret once with the registration
  for each MCP-capable harness, and lists the organization's keys granting `administration`
  (`GET /admin/keys` with the new `filters.tool_group`) in the All keys table with the
  audited admin revoke. The Install page mints only the standard ingest/read key, as it did
  before the card; the key dialog still offers `administration` once Admin is checked.
- **One formatter, the installer's shapes.** `packages/core/format/mcp-registration.ts`
  renders the Claude Code `claude mcp add` command, the Codex `[mcp_servers.agentcommons-admin]`
  block plus the `export AGENTCOMMONS_ADMIN_API_KEY=…` line (a second variable, so the
  standard key's `AGENTCOMMONS_API_KEY` is untouched) and the Gemini `mcpServers` entry. The
  key is literal in the Claude Code and Gemini entries, as §8.4 requires; a hook unit test
  pins the entries to `HARNESSES[*].mcp` so the two cannot drift.
- **Not always-loaded.** The management entry never carries `alwaysLoad`; Claude Code loads
  it behind tool search, so the 36 tools cost context only when the agent looks for them.
  The installer's `agentcommons` entry keeps `alwaysLoad: true` for the default catalog
  (§6.1 step 4). The budgets of decision 5 are unchanged; the "administrator install's key"
  measurement is a management key's.
