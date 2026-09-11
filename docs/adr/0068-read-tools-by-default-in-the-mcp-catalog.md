# ADR 0068: Read tools by default in the MCP catalog

Date: 2026-09-11
Status: Accepted. Refines §8.2 (catalog composition) and §9.2 (key permissions); the byte
budget of ADR 0053 and the guidance text of ADR 0057 stand.

## Context

Every `sessions:read` key listed thirteen tools when it had admin authority and eight
otherwise: `search`, `get`, `sql` and the five organization dashboard tools of ADR 0048.
The install flow creates such a key for every machine, so every agent connected through
`install.sh` carried the dashboard tools whether or not anyone on that machine would ever
ask for a dashboard.

Measured on the hosted instance on 2026-09-10 (prod-agent-mcp probe): `tools/list` for
the admin key was 13 tools and 18,598 bytes; the eight read tools were about 13,600 bytes,
of which the five dashboard tools were 7,677 bytes (`dashboard_render` 3.2 KB and
`dashboard_save` 2.8 KB carry the compact definition schema). Agents on that instance made
916 `sql` calls and never called a dashboard tool through MCP. Claude Code defers MCP tools
behind `ToolSearch` once deferrable definitions reach about 10% of the context window
across all servers, and it treated a server's tools as deferrable regardless of size until
the installer set `alwaysLoad` (§8.4); every byte a tool adds is a byte of the model's
working set on every turn and a byte against the shared budget of every other MCP server
the person runs. The user's decision: the agent tools an install exports should be the
read tools only.

## Decision

1. The default catalog is `search`, `get` and `sql`. `schema_columns` and
   `schema_functions` via `sql` remain the discovery path, so no further tool is needed
   to write a query.
2. Key permissions gain a third group, `tools`, whose only value today is `dashboards`
   (`packages/core/schemas/common.ts`, `keyToolGroupSchema`). The five dashboard tools
   carry `group: "dashboards"` in the registry; `tools/list` lists them only when the
   key's `permissions.tools` names the group, and every call applies the same check
   before `requirePermission`, answering `403 TOOL_NOT_GRANTED` with a message that
   names the grant. The group is data on the key and on the definition; no adapter
   branches on it.
3. `dashboard_set_default` needs admin authority and the group together, so an admin
   key without the group lists the four static admin tools of §0.
4. Any member may grant the group (dashboards are member-creatable, ADR 0048). The key
   form offers it as an unchecked option with one sentence of copy; the install flow
   keeps creating `sessions: [ingest, read]` keys. REST dashboard routes keep requiring
   `sessions:read`: the group governs what an agent's catalog exposes, not what the
   organization's API permits.
5. Budgets (R-MCP-09): the default catalog stays under 12 KB, a catalog with the group
   under 20 KB, and the complete catalog under 25 KB. Measured on 2026-09-11 from the
   contract fixture: 8,414 bytes default, 16,090 with the group, 19,450 complete, against
   the roughly 80 KB (20k tokens) at which Claude Code starts deferring.

## Consequences

- Keys created before this change keep the read tools and lose the dashboard tools from
  their catalog. Permissions are immutable on a key, so a person who wants them creates a
  new key with the group; the form and §8.2 say so.
- The live canary (R-MCP-07, §16.2) renders the default dashboard through MCP with the
  installed key. Its installed key must be created with `tools: ["dashboards"]` for that
  step to keep passing; `scripts/live-canary.ts` and the compose e2e key creation are the
  places. The canary's read and admin catalog assertions (`scripts/canary/boot.ts`) hold
  unchanged because `readToolNames` and `adminToolNames` keep their meaning.
- Appendix C is regenerated from a key that holds admin authority and the group, so it
  still shows every tool; its introduction states the composition per grant.
- Adding a tool group later is one enum value, one `group` tag per tool and one line of
  key-form copy.
