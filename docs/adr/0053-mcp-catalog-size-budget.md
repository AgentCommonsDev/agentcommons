# ADR 0053: The MCP catalog is budgeted so Claude Code does not defer it

Date: 2026-09-08
Status: Accepted. Refines §8.2 and the §10 statement that the dashboard definition schema
is the MCP tool input.

## Context

`tools/list` shipped every tool's `inputSchema` and `outputSchema` generated verbatim from
the shared zod schemas. Measured live for a read key that was about 211 KB of JSON Schema:
the allowlisted ECharts style type is inlined once per series field, so the dashboard tools
alone carried four copies of a 37 KB tree, and the output schemas roughly doubled the rest.

Claude Code 2.1.x defers every MCP tool behind its `ToolSearch` step once deferrable tool
definitions reach about 10% of the context window (about 20k tokens) across all configured
servers. With our catalog every Claude Code user had to search for `search` before it
existed in context. That removes the spontaneous "have we done this before?" lookup the
product exists for; the governing sentence in every description is worthless if the model
never sees it.

## Decision

1. `tools/list` stays under 20 KB for a read key and under 25 KB for an effective admin
   key, leaving headroom for future tools. A contract test measures both catalogs through the official SDK client (R-MCP-09).
   Measured on 2026-09-09: 14,989 and 18,309 bytes, down from about 221 KB and 231 KB.
2. No `outputSchema` is shipped. MCP marks it optional; results still carry
   `structuredContent` and the formatted text, both validated server-side.
3. The catalog rendering omits the draft `$schema` URL and regex `pattern`s that restate a
   `format` (uuid, email, date-time). Server validation is unchanged.
4. Dashboard tools advertise `dashboardDefinitionToolSchema`: variables and tiles as
   described JSON objects. The description text is derived from the strict schema's own
   keys (series types, encode fields, style blocks, tile fields, presets, units), names the
   allowlisted ECharts keys, and points at `dashboard_list` for the complete
   `definition_schema` and templates and at `dashboard_render` for inline validation.
5. Every handler parses the strict shared schema. A `Definition` carries `input` (parsed)
   and an optional `toolInput` (advertised); the compact form is a rendering, not a second
   validator, and a core unit test asserts it accepts everything the strict schema accepts.
6. Advertised schemas contain no `$ref`, `$defs` or recursion, which the Gemini API rejects.

## Consequences

Agents see the shape of every call and the allowlisted keys in prose; the complete chart
grammar is one `dashboard_list` call away and `dashboard_render` reports the failing path.
Appendix C now shows every input contract in full instead of abbreviating the large ones.
Adding description text to `search` or `get` costs catalog bytes; the budget test fails
when the catalog grows past the limit, which is the point.
