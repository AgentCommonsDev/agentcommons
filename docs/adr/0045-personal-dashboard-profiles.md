# 0045. Persistent dashboard profiles over the existing query service

Status: superseded by ADR 0048 (organization dashboards). The personal-profile scope,
JSON Forms/Recharts choice and no-layout-engine decision below no longer apply; the
rule that every tile runs through the existing guarded query service remains.

The user requests a preset Home dashboard and persistent editable profiles, usable
through a form, JSON, and MCP. Perspective5 was prototyped in a real browser and
rejected for phone authoring (see implementation/dashboard-usability-review.md).
Metabase's embedded editor needs a separate paid platform and identity integration.

Use JSON Forms to render the shared Zod-generated definition schema and Recharts for
responsive charts, alongside existing number cards and table components. Do not build
a separate query language, arbitrary JavaScript evaluator, drag/drop layout engine,
or database connection mechanism. Queries use the existing SQL service, guard, limits,
visibility views and current caller permissions. Results are fetched on display and
never stored in profile definitions. Adding an API view/column needs no widget code.

Home retains the canonical built-in adoption/reuse preset. A dropdown selects it or
one of at most20 personal profiles per user per organization. Profiles store a name
and version1 JSON declaration of1–12 number/line/bar/table widgets. Each widget has
an ID, title, SELECT query, unit and optional result-column bindings (required for
charts). JSON and form use the same schema; duplicate IDs and invalid chart bindings
are rejected. The built-in preset cannot be overwritten. Profiles can be created,
edited, duplicated and deleted. A revision prevents silent concurrent overwrites.

The user's later simplification request makes the selected profile the entire Home
content area. The built-in preset contains four current-week KPIs; activity feeds,
impact and gaps are not separate fixed panels. Their existing authorized APIs and
SQL views remain available for custom profiles and other consumers. Status retains
operational health and does not duplicate these dashboard metrics. The final feature
freeze retains JSON Forms and Recharts; adopting another dashboard framework is
outside this change.

GET/POST /me/dashboards and DELETE /me/dashboards/:id and explicitly registered MCP
dashboard_list/dashboard_save/dashboard_delete share one service and schemas. A
sessions:read key may modify only its owner's personal display preferences in its
bound organization; it cannot modify organization settings or another person's
profiles. This extends mutationOperation's permission union with read, without
changing authorization semantics. Each operation has exactly one audit event.

Application-owned storage has organization/user foreign keys, immutable ownership,
no reader-role grants and repository owner+organization predicates. Redaction runs
on names and declarations in the write transaction before schema/SQL validation.
SQL is checked with the same guard before saving and again with current authority
on execution. A disabled embedding capability may invalidate a previously saved
vector query; show that query error rather than retaining stale results.
